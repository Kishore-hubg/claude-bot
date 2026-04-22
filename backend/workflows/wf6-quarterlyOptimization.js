const jwt = require('jsonwebtoken');
const User = require('../models/User');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

const buildRecommendations = (usageByUser = []) => {
  return usageByUser.map((u) => {
    const score = (u.tokensUsed || 0) / 200000;
    if (score > 0.8 && u.currentTier !== 'T1') {
      return { ...u, currentTier: u.accessTier || 'T2', recommendedTier: 'T1', action: 'upgrade' };
    }
    if (score < 0.2 && u.currentTier !== 'T3') {
      return { ...u, currentTier: u.accessTier || 'T2', recommendedTier: 'T3', action: 'downgrade' };
    }
    return null;
  }).filter(Boolean);
};

const applyRecommendations = async (recommendations = []) => {
  let updated = 0;
  for (const rec of recommendations) {
    await provisioningService.upgradeAccount({
      claudeUserId: rec.claudeUserId,
      newTier: rec.recommendedTier
    });
    await User.findOneAndUpdate(
      { email: rec.email },
      {
        licenseType: rec.recommendedTier === 'T1' ? 'premium' : 'standard',
        accessTier: rec.recommendedTier
      }
    );
    updated += 1;
  }
  return { success: true, updated };
};

const run = async () => {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const usage = await provisioningService.getUsageCost({ startDate: ninetyDaysAgo, endDate: new Date() });
  const recommendations = buildRecommendations(usage.byUser || []);

  if (recommendations.length > 0 && process.env.EMAIL_ACTION_SECRET) {
    const baseUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    const quarter = Math.ceil((new Date().getMonth() + 1) / 3);
    const approveToken = jwt.sign({ recommendations, action: 'approve' }, process.env.EMAIL_ACTION_SECRET, { expiresIn: '30d' });
    const rejectToken = jwt.sign({ recommendations, action: 'reject' }, process.env.EMAIL_ACTION_SECRET, { expiresIn: '30d' });

    await emailService.quarterlyOptimization(
      { recommendations, quarter },
      `${baseUrl}/api/wf6/apply-tier-change?token=${approveToken}&decision=approve`,
      `${baseUrl}/api/wf6/apply-tier-change?token=${rejectToken}&decision=reject`
    ).catch(() => {});
  }

  return { success: true, recommendations };
};

module.exports = { run, buildRecommendations, applyRecommendations };
