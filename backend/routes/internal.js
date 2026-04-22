const express = require('express');
const router = express.Router();
const wf2 = require('../workflows/wf2-idleReclamation');
const wf4 = require('../workflows/wf4-costAnomaly');
const wf5 = require('../workflows/wf5-complianceScan');
const wf6 = require('../workflows/wf6-quarterlyOptimization');

const cronAuth = (req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

router.use(cronAuth);

router.post('/wf2', async (req, res) => {
  try {
    const result = await wf2.run();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/wf4', async (req, res) => {
  try {
    const result = await wf4.run();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/wf5', async (req, res) => {
  try {
    const result = await wf5.run();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/wf6', async (req, res) => {
  try {
    const result = await wf6.run();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
