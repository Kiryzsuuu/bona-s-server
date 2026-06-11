const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  type: {
    type: String,
    enum: ['text', 'image', 'voice', 'video', 'file', 'system', 'location'],
    default: 'text'
  },
  mediaUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  edited: { type: Boolean, default: false },
  location: {
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    live: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
