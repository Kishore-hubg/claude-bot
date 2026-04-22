const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');

const run = async () => {
  const today = new Date();
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [todayUsage, historyUsage] = await Promise.all([
    provisioningService.getUsageCost({ startDate: today, endDate: today }),
    provisioningService.getUsageCost({ startDate: thirtyDaysAgo, endDate: today })
  ]);

  const avgUSD = (historyUsage.totalUSD || 0) / 30;
  const spikePercent = avgUSD > 0 ? Math.round((todayUsage.totalUSD / avgUSD - 1) * 100) : 0;
  const alertSent = spikePercent > 150;

  if (alertSent) {
    await emailService.costAnomaly({
      totalUSD: todayUsage.totalUSD || 0,
      avgUSD,
      spikePercent,
      period: today.toDateString()
    }).catch(() => {});
  }

  return { success: true, totalUSD: todayUsage.totalUSD || 0, avgUSD, spikePercent, alertSent };
};

module.exports = { run };
