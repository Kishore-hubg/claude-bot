const axios = require('axios');

/**
 * Posts a summary to a Teams channel via Incoming Webhook (optional).
 * Set TEAMS_MANAGER_APPROVAL_WEBHOOK_URL in env — same flow as "notify channel".
 */
const postApprovalSummary = async ({ title, message, request }) => {
  const url = process.env.TEAMS_MANAGER_APPROVAL_WEBHOOK_URL;
  if (!url) return false;

  const facts = [
    { name: 'Reference', value: request?.referenceId || '—' },
    { name: 'Type', value: request?.type || '—' },
    { name: 'Title', value: request?.title || '—' }
  ];

  const body = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: '1E3A5F',
    summary: title,
    sections: [
      {
        activityTitle: title,
        text: message,
        facts
      }
    ]
  };

  await axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
  return true;
};

module.exports = { postApprovalSummary };
