const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { applyRecommendations } = require('../workflows/wf6-quarterlyOptimization');

router.get('/apply-tier-change', async (req, res) => {
  const { token, decision } = req.query;
  if (!token || !['approve', 'reject'].includes(decision)) {
    return res.status(400).send('Invalid request');
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.EMAIL_ACTION_SECRET);
  } catch {
    return res.status(401).send('Link expired or invalid.');
  }

  if (decision === 'reject' || payload.action === 'reject') {
    return res.send('<html><body style="font-family:Arial;text-align:center;padding:60px;"><h2>Skipped</h2><p>No tier changes applied this quarter.</p></body></html>');
  }

  try {
    await applyRecommendations(payload.recommendations || []);
    return res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;">
      <h2>Tier Changes Applied</h2>
      <p>${(payload.recommendations || []).length} user(s) updated.</p>
    </body></html>`);
  } catch (err) {
    console.error('[WF6 email action]', err.message);
    return res.status(500).send('Error applying changes. Please log in to the dashboard.');
  }
});

module.exports = router;
