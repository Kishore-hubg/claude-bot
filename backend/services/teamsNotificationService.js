const { adapter } = require('../bot/botAdapter');
const adaptiveCards = require('../bot/adaptiveCards');

const isEnabled = () => process.env.TEAMS_ENABLED === 'true';

const buildCard = ({ type, request, title, message }) => {
  if (type === 'approval_required') return adaptiveCards.approvalCard(request);
  if (type === 'request_rejected') return adaptiveCards.rejectionCard(request, message);
  if (type === 'request_approved') return adaptiveCards.confirmationCard(request);
  if (type === 'request_submitted') return adaptiveCards.confirmationCard(request);
  if (type === 'approval_progress') {
    return adaptiveCards.statusCard({
      ...(request || {}),
      title: title || 'Request update'
    });
  }
  return adaptiveCards.statusCard({
    ...(request || {}),
    title: title || request?.title || 'Notification'
  });
};

const send = async ({ recipient, type, request, title, message }) => {
  if (!isEnabled()) return false;
  if (!recipient?.teamsConversationRef) throw new Error('Recipient conversation reference is missing');

  const card = buildCard({ type, request, title, message });
  await adapter.continueConversation(recipient.teamsConversationRef, async (context) => {
    await context.sendActivity({ attachments: [card] });
  });

  return true;
};

module.exports = { send };
