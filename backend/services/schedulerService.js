const cron = require('node-cron');
const wf2 = require('../workflows/wf2-idleReclamation');
const wf4 = require('../workflows/wf4-costAnomaly');
const wf5 = require('../workflows/wf5-complianceScan');
const wf6 = require('../workflows/wf6-quarterlyOptimization');

const timezone = process.env.CRON_TIMEZONE || 'Asia/Kolkata';
const jobs = [];

const schedule = (expression, name, task) => {
  const job = cron.schedule(expression, async () => {
    try {
      await task();
      console.log(`[scheduler] ${name} completed`);
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err.message);
    }
  }, { timezone });
  jobs.push(job);
};

const start = () => {
  if (process.env.SCHEDULER_ENABLED === 'false') {
    console.log('[scheduler] disabled by SCHEDULER_ENABLED=false');
    return;
  }

  // WF2: Daily 06:00 IST.
  schedule('0 6 * * *', 'WF2 idle reclamation', () => wf2.run());
  // WF4: Daily 07:00 IST (cost anomaly checks).
  schedule('0 7 * * *', 'WF4 cost anomaly', () => wf4.run());
  // WF5: Weekly Monday 02:00 IST.
  schedule('0 2 * * 1', 'WF5 compliance scan', () => wf5.run());
  // WF6: Quarterly approximation (1st day of Jan/Apr/Jul/Oct at 08:00 IST).
  schedule('0 8 1 1,4,7,10 *', 'WF6 quarterly optimization', () => wf6.run());

  console.log(`[scheduler] started with timezone ${timezone}`);
};

const stop = () => {
  for (const job of jobs) {
    job.stop();
  }
};

module.exports = { start, stop };
