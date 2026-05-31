const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const User = require('../models/User');

const uploadDir = process.env.VERCEL ? '/tmp' : 'uploads/profiles';
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    cb(null, `${req.user._id}-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Hanya file gambar yang diizinkan'), ok);
  }
});

// GET /api/profile
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -resetPasswordToken -resetPasswordExpires');
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/profile  (name, status, about, background, onlineStatus)
router.put('/', auth, async (req, res) => {
  try {
    const { name, status, about, background, onlineStatus } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (status !== undefined) updates.status = status;
    if (about !== undefined) updates.about = about;
    if (background !== undefined) updates.background = background;
    const validStatuses = ['online', 'away', 'busy', 'offline'];
    if (onlineStatus !== undefined && validStatuses.includes(onlineStatus))
      updates.onlineStatus = onlineStatus;

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json({ message: 'Profil berhasil diperbarui', user });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/profile/picture
router.post('/picture', auth, upload.single('picture'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Tidak ada file yang diunggah' });

    let pictureUrl;

    if (process.env.VERCEL) {
      // Vercel: no persistent filesystem — convert to base64 data URL, store in MongoDB
      const fs = require('fs');
      const buf = fs.readFileSync(req.file.path);
      pictureUrl = `data:${req.file.mimetype};base64,${buf.toString('base64')}`;
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    } else {
      pictureUrl = `/uploads/profiles/${req.file.filename}`;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id, { profilePicture: pictureUrl }, { new: true }
    ).select('-password');
    res.json({ message: 'Foto profil berhasil diperbarui', profilePicture: pictureUrl, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/profile/email
router.put('/email', auth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email dan password wajib diisi' });

    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Password saat ini salah' });

    if (await User.findOne({ email, _id: { $ne: user._id } }))
      return res.status(400).json({ message: 'Email sudah digunakan akun lain' });

    user.email = email.toLowerCase().trim();
    await user.save();
    res.json({ message: 'Email berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/profile/password
router.put('/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ message: 'Semua field wajib diisi' });
    if (newPassword.length < 6)
      return res.status(400).json({ message: 'Password baru minimal 6 karakter' });

    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(currentPassword)))
      return res.status(401).json({ message: 'Password saat ini salah' });

    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
