// DNS fix hanya untuk Windows lokal — TIDAK di Vercel
if (!process.env.VERCEL && process.platform === 'win32') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

// ── Pre-load semua model ──
require('./models/User');
require('./models/Message');
require('./models/Group');
require('./models/GroupMessage');
require('./models/PushSubscription');

const authRoutes    = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const messageRoutes = require('./routes/messages');
const userRoutes    = require('./routes/users');
const pushRoutes    = require('./routes/push');
const groupRoutes   = require('./routes/groups');

// ── MongoDB cached connection ──
// Dipanggil SEKALI saat module dimuat — Vercel Fluid Compute meng-cache ini
let _dbPromise = null;
function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();
  if (_dbPromise) return _dbPromise;
  _dbPromise = mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10
  }).then(() => {
    console.log('✓ MongoDB terhubung');
  }).catch(err => {
    _dbPromise = null;
    console.error('✗ MongoDB error:', err.message);
    throw err;
  });
  return _dbPromise;
}

// Mulai connect SEGERA saat module di-load (sebelum request apapun)
const _initialConnect = connectDB();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

// Buat folder uploads hanya di lokal
if (!process.env.VERCEL) {
  ['uploads/profiles','uploads/images','uploads/voices','uploads/videos','uploads/files'].forEach(d => {
    try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
  });
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Middleware: tunggu DB sebelum semua /api request ──
// Harus SEBELUM route handlers
app.use('/api', async (req, res, next) => {
  try {
    await _initialConnect;
    next();
  } catch (e) {
    res.status(503).json({ message: 'Database tidak tersedia, coba beberapa saat lagi.' });
  }
});

// ── API Routes ──
app.use('/api/auth',     authRoutes);
app.use('/api/profile',  profileRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users',    userRoutes);
app.use('/api/push',     pushRoutes);
app.use('/api/groups',   groupRoutes);

// ── Socket.IO ──
const connectedUsers = new Map();
app.set('io', io);
app.set('connectedUsers', connectedUsers);

io.on('connection', async (socket) => {
  const userId = socket.handshake.auth.userId;
  if (!userId) return;

  connectedUsers.set(userId, socket.id);
  io.emit('user-status', { userId, status: 'online' });

  try {
    await mongoose.models.User?.findByIdAndUpdate(userId, { onlineStatus: 'online', lastSeen: new Date() });
    const groups = await mongoose.models.Group?.find({ 'members.user': userId }, '_id') || [];
    groups.forEach(g => socket.join(`group:${g._id}`));
  } catch (_) {}

  socket.on('typing', ({ receiverId }) => {
    const s = connectedUsers.get(receiverId);
    if (s) io.to(s).emit('user-typing', { senderId: userId });
  });
  socket.on('stop-typing', ({ receiverId }) => {
    const s = connectedUsers.get(receiverId);
    if (s) io.to(s).emit('user-stop-typing', { senderId: userId });
  });
  socket.on('mark-read', async ({ conversationId, senderId }) => {
    try {
      await mongoose.models.Message?.updateMany(
        { conversationId, receiver: userId, isRead: false }, { isRead: true }
      );
      const s = connectedUsers.get(senderId);
      if (s) io.to(s).emit('messages-read', { conversationId });
    } catch (_) {}
  });
  socket.on('disconnect', async () => {
    connectedUsers.delete(userId);
    io.emit('user-status', { userId, status: 'offline' });
    try {
      await mongoose.models.User?.findByIdAndUpdate(userId, { onlineStatus: 'offline', lastSeen: new Date() });
    } catch (_) {}
  });
});

// ── Lokal: start listen langsung ──
if (!process.env.VERCEL) {
  _initialConnect.then(() => {
    server.listen(process.env.PORT || 3000, () => {
      console.log(`✓ Bonah Server: http://localhost:${process.env.PORT || 3000}`);
    });
  }).catch(() => process.exit(1));
}

// Export untuk Vercel serverless
module.exports = server;
