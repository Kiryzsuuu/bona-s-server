const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const Group = require('../models/Group');
const GroupMessage = require('../models/GroupMessage');
const User = require('../models/User');
const { sendPushToUser } = require('./push');

const picStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.VERCEL ? '/tmp' : 'uploads/profiles/'),
  filename: (req, file, cb) => cb(null, `grp-${Date.now()}${path.extname(file.originalname)}`)
});
const picUpload = multer({
  storage: picStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Hanya file gambar'), ok);
  }
});

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (process.env.VERCEL) return cb(null, '/tmp');
    const mt = file.mimetype;
    let folder = 'uploads/files';
    if (mt.startsWith('image/')) folder = 'uploads/images';
    else if (mt.startsWith('audio/')) folder = 'uploads/voices';
    else if (mt.startsWith('video/')) folder = 'uploads/videos';
    cb(null, folder);
  },
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 8)}${path.extname(file.originalname)}`)
});
const mediaUpload = multer({ storage: mediaStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/groups — list all groups for current user
router.get('/', auth, async (req, res) => {
  try {
    const groups = await Group.find({ 'members.user': req.user._id })
      .sort({ lastMessageAt: -1 });

    // Count unread per group
    const withUnread = await Promise.all(groups.map(async g => {
      const unread = await GroupMessage.countDocuments({
        group: g._id,
        'readBy': { $ne: req.user._id },
        sender: { $ne: req.user._id }
      });
      return { ...g.toObject(), unreadCount: unread };
    }));

    res.json(withUnread);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups — create group
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name) return res.status(400).json({ message: 'Nama grup wajib diisi' });

    const ids = Array.isArray(memberIds) ? memberIds : (memberIds ? [memberIds] : []);
    const uniqueIds = [...new Set([req.user._id.toString(), ...ids])];

    const members = uniqueIds.map(uid => ({
      user: uid,
      role: uid === req.user._id.toString() ? 'admin' : 'member'
    }));

    const group = await new Group({
      name,
      description: description || '',
      members,
      createdBy: req.user._id,
      lastMessage: `Grup "${name}" dibuat`,
      lastMessageAt: new Date()
    }).save();

    // System message
    await new GroupMessage({
      group: group._id,
      sender: req.user._id,
      content: `${req.user.name} membuat grup ini`,
      type: 'system'
    }).save();

    // Notify all members via socket
    const io = req.app.get('io');
    ids.forEach(uid => {
      const connectedUsers = req.app.get('connectedUsers');
      const s = connectedUsers.get(uid);
      if (s) {
        io.to(s).emit('group-added', group);
        io.sockets.sockets.get(s)?.join(`group:${group._id}`);
      }
    });

    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:id — get group info
router.get('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'name profilePicture onlineStatus status')
      .populate('createdBy', 'name');
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const isMember = group.members.some(m => m.user._id.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Bukan anggota grup' });
    res.json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/groups/:id — update group info
router.put('/:id', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const member = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') return res.status(403).json({ message: 'Hanya admin yang bisa edit' });

    const { name, description, background } = req.body;
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (background) group.background = background;
    await group.save();

    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('group-updated', group);
    res.json({ message: 'Grup berhasil diperbarui', group });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:id/picture — update group picture
router.post('/:id/picture', auth, picUpload.single('picture'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const member = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') return res.status(403).json({ message: 'Hanya admin' });

    let pictureUrl;
    if (process.env.VERCEL) {
      const buf = fs.readFileSync(req.file.path);
      pictureUrl = `data:${req.file.mimetype};base64,${buf.toString('base64')}`;
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    } else {
      pictureUrl = `/uploads/profiles/${req.file.filename}`;
    }

    group.picture = pictureUrl;
    await group.save();

    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('group-updated', { _id: group._id, picture: pictureUrl });
    res.json({ message: 'Foto grup berhasil diperbarui', picture: pictureUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:id/members — add member
router.post('/:id/members', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const member = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') return res.status(403).json({ message: 'Hanya admin' });

    const { userId } = req.body;
    const already = group.members.find(m => m.user.toString() === userId);
    if (already) return res.status(400).json({ message: 'Sudah menjadi anggota' });

    const newUser = await User.findById(userId).select('name');
    if (!newUser) return res.status(404).json({ message: 'Pengguna tidak ditemukan' });

    group.members.push({ user: userId, role: 'member' });
    await new GroupMessage({
      group: group._id, sender: req.user._id,
      content: `${req.user.name} menambahkan ${newUser.name}`, type: 'system'
    }).save();
    group.lastMessage = `${req.user.name} menambahkan ${newUser.name}`;
    group.lastMessageAt = new Date();
    await group.save();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const s = connectedUsers.get(userId);
    if (s) {
      io.to(s).emit('group-added', group);
      io.sockets.sockets.get(s)?.join(`group:${group._id}`);
    }
    io.to(`group:${group._id}`).emit('group-updated', group);
    res.json({ message: `${newUser.name} berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/groups/:id/members/:userId — remove member
router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const admin = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!admin || admin.role !== 'admin') return res.status(403).json({ message: 'Hanya admin' });

    const removedUser = await User.findById(req.params.userId).select('name');
    group.members = group.members.filter(m => m.user.toString() !== req.params.userId);

    await new GroupMessage({
      group: group._id, sender: req.user._id,
      content: `${req.user.name} mengeluarkan ${removedUser?.name || 'anggota'}`, type: 'system'
    }).save();
    group.lastMessage = `${req.user.name} mengeluarkan ${removedUser?.name || 'anggota'}`;
    group.lastMessageAt = new Date();
    await group.save();

    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('group-updated', group);
    io.to(`group:${group._id}`).emit('group-member-removed', { groupId: group._id, userId: req.params.userId });
    res.json({ message: 'Anggota berhasil dikeluarkan' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:id/leave — leave group
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });

    group.members = group.members.filter(m => m.user.toString() !== req.user._id.toString());
    await new GroupMessage({
      group: group._id, sender: req.user._id,
      content: `${req.user.name} keluar dari grup`, type: 'system'
    }).save();
    group.lastMessage = `${req.user.name} keluar dari grup`;
    group.lastMessageAt = new Date();
    await group.save();

    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('group-updated', group);
    res.json({ message: 'Berhasil keluar dari grup' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/groups/:id/members/:userId/role — promote/demote admin
router.put('/:id/members/:userId/role', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const admin = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!admin || admin.role !== 'admin') return res.status(403).json({ message: 'Hanya admin' });

    const { role } = req.body;
    if (!['admin','member'].includes(role)) return res.status(400).json({ message: 'Role tidak valid' });

    const target = group.members.find(m => m.user.toString() === req.params.userId);
    if (!target) return res.status(404).json({ message: 'Anggota tidak ditemukan' });

    target.role = role;
    const targetUser = await User.findById(req.params.userId).select('name');
    const action = role === 'admin' ? 'dijadikan admin' : 'diturunkan dari admin';
    await new GroupMessage({
      group: group._id, sender: req.user._id,
      content: `${req.user.name} menjadikan ${targetUser?.name} ${action}`, type: 'system'
    }).save();
    await group.save();

    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('group-updated', group);
    res.json({ message: `${targetUser?.name} berhasil ${action}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:id/invite — get or create invite link
router.get('/:id/invite', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Bukan anggota' });

    if (!group.inviteToken) {
      group.inviteToken = crypto.randomBytes(16).toString('hex');
      await group.save();
    }
    const link = `${process.env.APP_URL || 'http://localhost:3000'}/join.html?token=${group.inviteToken}`;
    res.json({ link, token: group.inviteToken });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:id/invite/reset — reset invite link (admin only)
router.post('/:id/invite/reset', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const admin = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!admin || admin.role !== 'admin') return res.status(403).json({ message: 'Hanya admin' });
    group.inviteToken = crypto.randomBytes(16).toString('hex');
    await group.save();
    const link = `${process.env.APP_URL || 'http://localhost:3000'}/join.html?token=${group.inviteToken}`;
    res.json({ link, token: group.inviteToken });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/join/:token — preview group before joining
router.get('/join/:token', auth, async (req, res) => {
  try {
    const group = await Group.findOne({ inviteToken: req.params.token })
      .select('name description picture members');
    if (!group) return res.status(404).json({ message: 'Link tidak valid atau sudah direset' });
    const already = group.members.some(m => m.user.toString() === req.user._id.toString());
    res.json({ group: { _id: group._id, name: group.name, description: group.description, picture: group.picture, memberCount: group.members.length }, already });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/join/:token — join group via invite link
router.post('/join/:token', auth, async (req, res) => {
  try {
    const group = await Group.findOne({ inviteToken: req.params.token });
    if (!group) return res.status(404).json({ message: 'Link tidak valid atau sudah direset' });
    const already = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (already) return res.json({ message: 'Kamu sudah menjadi anggota', groupId: group._id });

    group.members.push({ user: req.user._id, role: 'member' });
    await new GroupMessage({
      group: group._id, sender: req.user._id,
      content: `${req.user.name} bergabung melalui tautan undangan`, type: 'system'
    }).save();
    group.lastMessage = `${req.user.name} bergabung`;
    group.lastMessageAt = new Date();
    await group.save();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const s = connectedUsers.get(req.user._id.toString());
    if (s) {
      io.to(s).emit('group-added', group);
      io.sockets.sockets.get(s)?.join(`group:${group._id}`);
    }
    io.to(`group:${group._id}`).emit('group-updated', group);
    res.json({ message: `Berhasil bergabung ke "${group.name}"`, groupId: group._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/groups/:id/messages — get messages
router.get('/:id/messages', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Bukan anggota' });

    const messages = await GroupMessage.find({ group: req.params.id })
      .populate('sender', 'name profilePicture')
      .sort({ createdAt: 1 })
      .limit(200);

    // Mark all as read
    await GroupMessage.updateMany(
      { group: req.params.id, readBy: { $ne: req.user._id }, sender: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/groups/:id/messages — send message
router.post('/:id/messages', auth, mediaUpload.single('media'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Grup tidak ditemukan' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Bukan anggota' });

    let mediaUrl = null, fileName = null;
    if (req.file) {
      const mt = req.file.mimetype;
      if (process.env.VERCEL) {
        const buf = fs.readFileSync(req.file.path);
        mediaUrl = `data:${mt};base64,${buf.toString('base64')}`;
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      } else {
        const folder = mt.startsWith('image/') ? 'images'
          : mt.startsWith('audio/') ? 'voices'
          : mt.startsWith('video/') ? 'videos' : 'files';
        mediaUrl = `/uploads/${folder}/${req.file.filename}`;
      }
      fileName = req.file.originalname;
    }

    const { content, type } = req.body;
    const msg = await new GroupMessage({
      group: group._id,
      sender: req.user._id,
      content: content || '',
      type: type || 'text',
      mediaUrl,
      fileName,
      readBy: [req.user._id]
    }).save();

    await msg.populate('sender', 'name profilePicture');

    // Update group last message
    const preview = msg.type === 'image' ? '📷 Foto' : msg.type === 'voice' ? '🎙️ Pesan suara'
      : msg.type === 'video' ? '🎬 Video' : msg.content;
    group.lastMessage = preview;
    group.lastMessageAt = new Date();
    await group.save();

    // Emit to group room
    const io = req.app.get('io');
    io.to(`group:${group._id}`).emit('new-group-message', { ...msg.toObject(), groupId: group._id });

    // Push notification to offline members
    const connectedUsers = req.app.get('connectedUsers');
    group.members.forEach(m => {
      const uid = m.user.toString();
      if (uid !== req.user._id.toString() && !connectedUsers.has(uid)) {
        sendPushToUser(uid, {
          title: `${group.name} • ${req.user.name}`,
          body: preview,
          icon: group.picture || req.user.profilePicture || '/image%20(7).png',
          tag: `group:${group._id}`,
          data: { url: `/?group=${group._id}` }
        }).catch(() => {});
      }
    });

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
