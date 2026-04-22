const { CardFactory } = require('botbuilder');

const createCard = (body, actions = []) => CardFactory.adaptiveCard({
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  type: 'AdaptiveCard',
  version: '1.4',
  body,
  actions
});

const summaryFacts = (request) => ([
  { title: 'Reference', value: request.referenceId || 'Pending' },
  { title: 'Type', value: request.type || 'N/A' },
  { title: 'Priority', value: request.priority || 'medium' }
]);

module.exports = {
  approvalCard: (request) => createCard([
    { type: 'TextBlock', text: 'Approval Required', weight: 'Bolder', size: 'Medium', color: 'Attention' },
    { type: 'TextBlock', text: request.title || 'A request is awaiting your review.', wrap: true },
    { type: 'FactSet', facts: summaryFacts(request) }
  ]),

  confirmationCard: (request) => createCard([
    { type: 'TextBlock', text: 'Request Submitted', weight: 'Bolder', size: 'Medium' },
    { type: 'TextBlock', text: request.title || 'Your request has been captured.', wrap: true },
    { type: 'FactSet', facts: summaryFacts(request) }
  ]),

  statusCard: (request) => createCard([
    { type: 'TextBlock', text: 'Request Status', weight: 'Bolder', size: 'Medium' },
    { type: 'FactSet', facts: [
      ...summaryFacts(request),
      { title: 'Status', value: (request.status || 'submitted').replace(/_/g, ' ') }
    ] }
  ]),

  rejectionCard: (request, reason) => createCard([
    { type: 'TextBlock', text: 'Request Rejected', weight: 'Bolder', color: 'Attention', size: 'Medium' },
    { type: 'FactSet', facts: summaryFacts(request) },
    { type: 'TextBlock', text: `Reason: ${reason || 'No reason provided.'}`, wrap: true }
  ])
};
