// ─────────────────────────────────────────────────────────────────────────────
// Notification Routes  →  /api/notifications
// ─────────────────────────────────────────────────────────────────────────────
const express = require('express');
const notifRouter = express.Router();
const Notification = require('../models/Notification');
const { authenticate } = require('../middleware/auth');

notifRouter.use(authenticate);

// GET /api/notifications — paginated list for the current user
notifRouter.get('/', async (req, res) => {
  try {
    const { unreadOnly, page = 1, limit = 20 } = req.query;
    const filter = { recipient: req.user._id };
    if (unreadOnly === 'true') filter.isRead = false;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .populate('request', 'referenceId title type status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: req.user._id, isRead: false })
    ]);

    res.json({ success: true, notifications, total, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/notifications/:id/read — mark a single notification as read
notifRouter.patch('/:id/read', async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user._id },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/notifications/mark-all-read — batch mark all as read
notifRouter.patch('/mark-all-read', async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// User Routes  →  /api/users
// ─────────────────────────────────────────────────────────────────────────────
const userRouter = express.Router();
const User = require('../models/User');
const { authorize } = require('../middleware/auth');

userRouter.use(authenticate);

// GET /api/users — admin-only full user list
userRouter.get('/', authorize('admin'), async (req, res) => {
  try {
    const users = await User.find({ isActive: true }).select('-password').sort({ name: 1 });
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/approvers — returns users who can serve as approvers
//   Used by the frontend to populate dropdowns when building approval chains
userRouter.get('/approvers', authorize('admin', 'manager', 'tech_lead', 'architect', 'cto', 'support', 'ai_coe_lead', 'it_governance'), async (req, res) => {
  try {
    const approverRoles = ['manager', 'tech_lead', 'architect', 'admin', 'support', 'cto', 'ai_coe_lead', 'it_governance'];
    const approvers = await User.find({ role: { $in: approverRoles }, isActive: true })
      .select('name email role department')
      .sort({ role: 1, name: 1 });
    res.json({ success: true, approvers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/users/:id — update user profile (self or admin)
userRouter.patch('/:id', async (req, res) => {
  try {
    const isSelf = req.params.id === req.user._id.toString();
    if (!isSelf && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const allowedFields = isSelf
      ? ['name', 'department', 'notificationPreferences']   // Users can update their own profile
      : ['name', 'role', 'department', 'isActive', 'managerId', 'managerEmail', 'employeeId', 'teamsUserId'];          // Admins can also change role & manager routing

    const updates = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const user = await User.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { notifRouter, userRouter };
