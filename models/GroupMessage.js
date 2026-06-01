const mongoose = require('mongoose');

const groupMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  type: {
    type: String,
    enum: ['text', 'image', 'voice', 'video', 'file', 'system'],
    default: 'text'
  },
  mediaUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  edited: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('GroupMessage', groupMessageSchema);
