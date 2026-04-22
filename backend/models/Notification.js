const mongoose = require('mongoose');

/**
 * Notification Model
 * Tracks all notifications sent to users — both in-app and via Teams.
 * Allows us to show unread counts, re-send failed notifications, and
 * audit communication for compliance purposes.
 */
const notificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Which request triggered this notification (optional for system-wide notices)
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request'
  },
  type: {
    type: String,
    enum: [
      'request_submitted',
      'approval_required',
      'request_approved',
      'request_rejected',
      'request_deployed',
      'request_closed',
      'comment_added',
      'sla_warning',    // Approaching deadline
      'system_alert',
      'approval_progress' // e.g. L1 approved, pending L2
    ],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  // Delivery channel tracking
  channels: {
    inApp: {
      sent: { type: Boolean, default: true },
      sentAt: { type: Date, default: Date.now }
    },
    teams: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String    // Store error message if Teams delivery failed
    },
    activityFeed: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String
    },
    email: {
      sent: { type: Boolean, default: false },
      sentAt: Date,
      error: String
    }
  }
}, {
  timestamps: true
});

notificationSchema.index({ recipient: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
