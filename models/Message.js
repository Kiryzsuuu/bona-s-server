const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  type: {
    type: String,
    enum: ['text', 'image', 'voice', 'video', 'file'],
    default: 'text'
  },
  mediaUrl: { type: String, default: null },
  fileName: { type: String, default: null },
  isRead: { type: Boolean, default: false },
  edited: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
