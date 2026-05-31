// Fix DNS resolver for MongoDB Atlas SRV on some Windows networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const messageRoutes = require('./routes/messages');
const userRoutes = require('./routes/users');
const pushRoutes = require('./routes/push');
const groupRoutes = require('./routes/groups');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Support both polling and websocket (polling works on Vercel)
  transports: ['polling', 'websocket'],
  allowEIO3: true
});

// Create upload directories (only works locally, not on Vercel serverless)
const uploadDirs = ['uploads/profiles', 'uploads/images', 'uploads/voices', 'uploads/videos', 'uploads/files'];
uploadDirs.forEach(d => {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/users', userRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/groups', groupRoutes);

// Socket.IO real-time
const connectedUsers = new Map();
app.set('io', io);
app.set('connectedUsers', connectedUsers);

io.on('connection', async (socket) => {
  const userId = socket.handshake.auth.userId;
  if (!userId) return;

  connectedUsers.set(userId, socket.id);
  io.emit('user-status', { userId, status: 'online' });

  try {
    const User = require('./models/User');
    await User.findByIdAndUpdate(userId, { onlineStatus: 'online', lastSeen: new Date() });

    // Auto-join all group rooms this user belongs to
    const Group = require('./models/Group');
    const groups = await Group.find({ 'members.user': userId }, '_id');
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
      const Message = require('./models/Message');
      await Message.updateMany(
        { conversationId, receiver: userId, isRead: false },
        { isRead: true }
      );
      const s = connectedUsers.get(senderId);
      if (s) io.to(s).emit('messages-read', { conversationId });
    } catch (_) {}
  });

  socket.on('disconnect', async () => {
    connectedUsers.delete(userId);
    io.emit('user-status', { userId, status: 'offline' });
    try {
      const User = require('./models/User');
      await User.findByIdAndUpdate(userId, { onlineStatus: 'offline', lastSeen: new Date() });
    } catch (_) {}
  });
});

// Connect to MongoDB then start server
let dbReady = false;
const dbConnect = mongoose.connect(process.env.MONGODB_URI)
  .then(() => { dbReady = true; console.log('✓ Terhubung ke MongoDB'); })
  .catch(err => { console.error('✗ MongoDB gagal:', err.message); });

// For local development: start listening
if (process.env.VERCEL !== '1') {
  dbConnect.then(() => {
    server.listen(process.env.PORT || 3000, () => {
      console.log(`✓ Bonah Server berjalan di http://localhost:${process.env.PORT || 3000}`);
    });
  }).catch(() => process.exit(1));
}

// Export for Vercel serverless
module.exports = server;
