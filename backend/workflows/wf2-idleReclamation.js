const User = require('../models/User');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

const run = async () => {
  const now = Date.now();
  const thirtyDaysAgo = new Date(now - THIRTY_DAYS_MS);
  const eightDaysAgo = new Date(now - EIGHT_DAYS_MS);

  const toDeprovision = await User.find({
    idleWarningSentAt: { $lte: eightDaysAgo },
    licenseType: { $ne: null }
  });

  let deprovisioned = 0;
  for (const user of toDeprovision) {
    await provisioningService.revokeAccount({ claudeUserId: user._id.toString() }).catch(() => {});
    await User.findByIdAndUpdate(user._id, {
      licenseType: null,
      accessTier: null,
      idleWarningSentAt: null,
      lastActiveDate: new Date()
    });
    await emailService.offboardingConfirm(user, user.email).catch(() => {});
    deprovisioned += 1;
  }

  const activeUsers = await User.find({ licenseType: { $ne: null }, idleWarningSentAt: null });
  let warned = 0;
  for (const user of activeUsers) {
    const lastActive = await provisioningService.getLastActiveDate({ claudeUserId: user._id.toString() });
    await User.findByIdAndUpdate(user._id, { lastActiveDate: lastActive });
    if (lastActive < thirtyDaysAgo) {
      await emailService.idleWarning(user).catch(() => {});
      await User.findByIdAndUpdate(user._id, { idleWarningSentAt: new Date() });
      warned += 1;
    }
  }

  return { success: true, warned, deprovisioned };
};

module.exports = { run };
