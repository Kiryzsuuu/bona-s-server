const mongoose = require('mongoose');

const pushSubSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: { type: Object, required: true }
}, { timestamps: true });

pushSubSchema.index({ user: 1 });

module.exports = mongoose.model('PushSubscription', pushSubSchema);
