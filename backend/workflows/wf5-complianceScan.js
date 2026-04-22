const User = require('../models/User');
const emailService = require('../services/emailService');

const run = async () => {
  const activeUsers = await User.countDocuments({ isActive: true });
  const approvedUsers = await User.countDocuments({ isActive: true, dateProvisioned: { $ne: null } });
  const flaggedUsers = Math.max(0, activeUsers - approvedUsers);

  await emailService.complianceReport({
    activeUsers,
    approvedUsers,
    flaggedUsers,
    scanDate: new Date()
  }).catch(() => {});

  return { success: true, activeUsers, approvedUsers, flaggedUsers };
};

module.exports = { run };
