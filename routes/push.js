const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const auth = require('../middleware/auth');
const PushSubscription = require('../models/PushSubscription');

webpush.setVapidDetails(
  'mailto:' + process.env.SMTP_USER,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription) return res.status(400).json({ message: 'Subscription required' });

    // Upsert subscription for this user
    await PushSubscription.findOneAndUpdate(
      { user: req.user._id, 'subscription.endpoint': subscription.endpoint },
      { user: req.user._id, subscription },
      { upsert: true, new: true }
    );
    res.json({ message: 'Subscribed to push notifications' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', auth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteMany({ user: req.user._id, 'subscription.endpoint': endpoint });
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Helper: send push to a user
async function sendPushToUser(userId, payload) {
  const subs = await PushSubscription.find({ user: userId });
  const promises = subs.map(doc =>
    webpush.sendNotification(doc.subscription, JSON.stringify(payload))
      .catch(async (err) => {
        // Remove invalid subscriptions
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.findByIdAndDelete(doc._id);
        }
      })
  );
  await Promise.all(promises);
}

module.exports = router;
module.exports.sendPushToUser = sendPushToUser;
