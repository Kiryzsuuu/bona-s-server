const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');

function makeToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(u) {
  return {
    id: u._id,
    name: u.name,
    email: u.email,
    profilePicture: u.profilePicture,
    status: u.status,
    about: u.about,
    background: u.background,
    onlineStatus: u.onlineStatus
  };
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Semua field wajib diisi' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password minimal 6 karakter' });
    if (await User.findOne({ email }))
      return res.status(400).json({ message: 'Email sudah terdaftar' });

    const user = await new User({ name, email, password }).save();
    res.status(201).json({ message: 'Registrasi berhasil', token: makeToken(user._id), user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email dan password wajib diisi' });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Email atau password salah' });

    user.onlineStatus = 'online';
    await user.save({ validateBeforeSave: false });

    res.json({ message: 'Login berhasil', token: makeToken(user._id), user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.json({ message: 'Jika email terdaftar, link reset telah dikirim ke email kamu' });

    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${process.env.APP_URL}/reset-password.html?token=${token}`;

    await sendMail({
      to: user.email,
      subject: 'Reset Password – Bonah Server 🌸',
      html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;background:#FDF8F5;border-radius:16px;padding:32px;border:1px solid #F0DCE2;">
        <div style="text-align:center;margin-bottom:20px;">
          <div style="display:inline-block;width:48px;height:48px;background:#C4788A;border-radius:12px;line-height:48px;font-size:24px;">🦋</div>
          <h2 style="color:#3D2535;font-family:Georgia,serif;margin:8px 0 0;">Bonah Server</h2>
        </div>
        <h3 style="color:#3D2535;">Reset Password Kamu 🌷</h3>
        <p style="color:#9B8A90;font-size:14px;line-height:1.7;">
          Hai <strong>${user.name}</strong>!<br>
          Kami menerima permintaan reset password. Klik tombol di bawah untuk membuat password baru.
        </p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${resetUrl}" style="background:#C4788A;color:#fff;padding:12px 32px;border-radius:24px;text-decoration:none;font-size:14px;font-weight:500;display:inline-block;">
            Reset Password
          </a>
        </div>
        <p style="color:#C4B3BA;font-size:12px;text-align:center;">
          Link berlaku 1 jam. Jika kamu tidak meminta ini, abaikan email ini.
        </p>
      </div>`
    });

    res.json({ message: 'Jika email terdaftar, link reset telah dikirim ke email kamu' });
  } catch (err) {
    res.status(500).json({ message: 'Gagal mengirim email: ' + err.message });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ message: 'Token dan password wajib diisi' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password minimal 6 karakter' });

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ message: 'Token tidak valid atau sudah kadaluarsa' });

    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: 'Password berhasil direset! Silakan login.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
