const User = require('../models/User');
const Request = require('../models/Request');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

const run = async ({ employeeId, email }) => {
  const user = await User.findOne({ $or: [{ employeeId }, { email }] });
  if (!user) {
    return { success: true, revoked: 0, reason: 'User not found in system' };
  }

  let revokedCount = 0;
  if (user.licenseType) {
    await provisioningService.revokeAccount({ claudeUserId: user._id.toString() })
      .catch((err) => console.error('[wf3] revokeAccount failed:', err.message));
    revokedCount += 1;
  }

  user.isActive = false;
  user.licenseType = null;
  user.accessTier = null;
  user.idleWarningSentAt = null;
  await user.save();

  await Request.updateMany(
    { requester: user._id, status: { $in: ['submitted', 'pending_approval'] } },
    { status: 'closed', closureReason: 'User offboarded', actualCompletionDate: new Date() }
  );

  const hrEmail = process.env.HR_EMAIL || process.env.EMAIL_USER;
  await emailService.offboardingConfirm(user, hrEmail)
    .catch((err) => console.error('[wf3] Email failed:', err.message));

  return { success: true, revoked: revokedCount, userId: user._id };
};

module.exports = { run };
