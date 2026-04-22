const isEnabled = () => process.env.ACTIVITY_FEED_ENABLED === 'true';

let graphClient = null;
const getGraphClient = async () => {
  if (graphClient) return graphClient;

  const { Client } = require('@microsoft/microsoft-graph-client');
  require('isomorphic-fetch');
  const { ClientSecretCredential } = require('@azure/identity');

  const credential = new ClientSecretCredential(
    process.env.GRAPH_TENANT_ID,
    process.env.GRAPH_CLIENT_ID,
    process.env.GRAPH_CLIENT_SECRET
  );

  graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });

  return graphClient;
};

const send = async ({ recipient, request, title, message }) => {
  if (!isEnabled()) return false;
  if (!recipient?.teamsUserId) throw new Error('Recipient teamsUserId is missing');

  const client = await getGraphClient();
  const appId = process.env.TEAMS_APP_ID;
  if (!appId) throw new Error('TEAMS_APP_ID is required for Activity Feed');

  const topicSource = appId.startsWith('http')
    ? appId
    : `https://teams.microsoft.com/l/entity/${appId}/${request?._id || 'notification'}`;

  await client.api(`/users/${recipient.teamsUserId}/teamwork/sendActivityNotification`).post({
    topic: {
      source: 'text',
      value: request?.referenceId || 'Claude Assistant Bot',
      webUrl: topicSource
    },
    activityType: 'requestStatusUpdated',
    previewText: { content: title || 'Claude Assistant Bot update' },
    templateParameters: [
      { name: 'title', value: title || 'Claude Assistant Bot' },
      { name: 'message', value: message || '' }
    ]
  });

  return true;
};

module.exports = { send };
