const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const { sendPushToUser } = require('./push');

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
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.random().toString(36).substr(2, 8)}${path.extname(file.originalname)}`);
  }
});

const mediaUpload = multer({ storage: mediaStorage, limits: { fileSize: 50 * 1024 * 1024 } });

function convId(a, b) {
  return [a.toString(), b.toString()].sort().join('_');
}

// GET /api/messages/conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const uid = req.user._id;

    const pipeline = [
      { $match: { $or: [{ sender: uid }, { receiver: uid }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$conversationId', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: { from: 'users', localField: 'sender', foreignField: '_id', as: 'senderInfo' }
      },
      {
        $lookup: { from: 'users', localField: 'receiver', foreignField: '_id', as: 'receiverInfo' }
      }
    ];

    const msgs = await Message.aggregate(pipeline);

    const unreadAgg = await Message.aggregate([
      { $match: { receiver: uid, isRead: false } },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } }
    ]);
    const unreadMap = new Map(unreadAgg.map(u => [u._id, u.count]));

    const uidStr = uid.toString();
    const conversations = msgs.map(msg => {
      const senderInfo = msg.senderInfo[0];
      const receiverInfo = msg.receiverInfo[0];
      const other = senderInfo._id.toString() === uidStr ? receiverInfo : senderInfo;
      if (!other) return null;

      let preview = msg.content || '';
      if (!preview) {
        if (msg.type === 'image') preview = '📷 Foto';
        else if (msg.type === 'voice') preview = '🎙️ Pesan suara';
        else if (msg.type === 'video') preview = '🎬 Video';
        else preview = '📎 File';
      }

      return {
        conversationId: msg.conversationId,
        userId: other._id,
        name: other.name,
        profilePicture: other.profilePicture,
        onlineStatus: other.onlineStatus,
        status: other.status,
        lastMessage: preview,
        lastMessageTime: msg.createdAt,
        unread: unreadMap.get(msg.conversationId) || 0,
        isMine: msg.sender.toString() === uidStr
      };
    }).filter(Boolean);

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// GET /api/messages/:userId  — load chat history
router.get('/:userId', auth, async (req, res) => {
  try {
    const cid = convId(req.user._id, req.params.userId);
    const messages = await Message.find({ conversationId: cid })
      .populate('sender', 'name profilePicture')
      .sort({ createdAt: 1 })
      .limit(200);

    await Message.updateMany(
      { conversationId: cid, receiver: req.user._id, isRead: false },
      { isRead: true }
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/messages/send
router.post('/send', auth, mediaUpload.single('media'), async (req, res) => {
  try {
    const { receiverId, content, type } = req.body;
    if (!receiverId) return res.status(400).json({ message: 'receiverId wajib diisi' });

    let mediaUrl = null, fileName = null;
    if (req.file) {
      const mt = req.file.mimetype;
      if (process.env.VERCEL) {
        // Vercel: no persistent filesystem — encode to base64 data URL
        const fs = require('fs');
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

    const cid = convId(req.user._id, receiverId);
    const msg = await new Message({
      conversationId: cid,
      sender: req.user._id,
      receiver: receiverId,
      content: content || '',
      type: type || 'text',
      mediaUrl,
      fileName
    }).save();

    await msg.populate('sender', 'name profilePicture');

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const rSock = connectedUsers.get(receiverId);
    if (rSock) io.to(rSock).emit('new-message', msg);

    // Send push notification if receiver is offline or in another tab
    const preview = msg.type === 'image' ? '📷 Mengirim foto'
      : msg.type === 'voice' ? '🎙️ Pesan suara'
      : msg.type === 'video' ? '🎬 Mengirim video'
      : (msg.content || '').slice(0, 80);

    sendPushToUser(receiverId, {
      title: req.user.name,
      body: preview,
      icon: req.user.profilePicture || '/image%20(7).png',
      tag: msg.conversationId,
      data: { url: '/?chat=' + req.user._id }
    }).catch(() => {});

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// PUT /api/messages/:id — edit message
router.put('/:id', auth, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });
    if (msg.sender.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Bukan pesanmu' });
    if (msg.type !== 'text') return res.status(400).json({ message: 'Hanya pesan teks yang bisa diedit' });

    msg.content = req.body.content || msg.content;
    msg.edited = true;
    await msg.save();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const rSock = connectedUsers.get(msg.receiver.toString());
    if (rSock) io.to(rSock).emit('message-edited', { _id: msg._id, content: msg.content, conversationId: msg.conversationId });

    res.json({ message: 'Pesan berhasil diedit', msg });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/messages/:id — delete message
router.delete('/:id', auth, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });
    if (msg.sender.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Bukan pesanmu' });

    await msg.deleteOne();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const rSock = connectedUsers.get(msg.receiver.toString());
    if (rSock) io.to(rSock).emit('message-deleted', { _id: msg._id, conversationId: msg.conversationId });

    res.json({ message: 'Pesan berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/messages/location — kirim lokasi (sekali atau live)
router.post('/location', auth, async (req, res) => {
  try {
    const { receiverId, lat, lng, live } = req.body;
    if (!receiverId || lat == null || lng == null)
      return res.status(400).json({ message: 'receiverId, lat, lng wajib' });

    const expiresAt = live ? new Date(Date.now() + 15 * 60 * 1000) : null; // live = 15 menit
    const cid = convId(req.user._id, receiverId);
    const msg = await new Message({
      conversationId: cid,
      sender: req.user._id,
      receiver: receiverId,
      content: live ? 'Lokasi live' : 'Lokasi',
      type: 'location',
      location: { lat, lng, live: !!live, expiresAt }
    }).save();

    await msg.populate('sender', 'name profilePicture');

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const rSock = connectedUsers.get(receiverId.toString());
    if (rSock) io.to(rSock).emit('new-message', msg);

    sendPushToUser(receiverId, {
      title: req.user.name,
      body: live ? '📍 Berbagi lokasi live' : '📍 Mengirim lokasi',
      icon: req.user.profilePicture || '/image%20(7).png',
      tag: msg.conversationId,
      data: { url: '/?chat=' + req.user._id }
    }).catch(() => {});

    res.status(201).json(msg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /api/messages/:id/location — update koordinat live location
router.patch('/:id/location', auth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    const msg = await Message.findById(req.params.id);
    if (!msg) return res.status(404).json({ message: 'Pesan tidak ditemukan' });
    if (msg.sender.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Bukan pesanmu' });
    if (msg.type !== 'location' || !msg.location?.live)
      return res.status(400).json({ message: 'Bukan pesan live location' });
    if (msg.location.expiresAt && new Date() > msg.location.expiresAt)
      return res.status(410).json({ message: 'Live location sudah berakhir' });

    msg.location.lat = lat;
    msg.location.lng = lng;
    await msg.save();

    const io = req.app.get('io');
    const connectedUsers = req.app.get('connectedUsers');
    const rSock = connectedUsers.get(msg.receiver.toString());
    if (rSock) io.to(rSock).emit('location-update', { msgId: msg._id, lat, lng });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
