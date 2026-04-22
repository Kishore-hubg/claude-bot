const { BotFrameworkAdapter } = require('botbuilder');

const adapter = new BotFrameworkAdapter({
  appId: process.env.TEAMS_APP_ID,
  appPassword: process.env.TEAMS_APP_PASSWORD
});

adapter.onTurnError = async (context, error) => {
  console.error('[botAdapter] Turn error:', error.message);
  await context.sendActivity('I hit an error while processing that message. Please try again.');
};

module.exports = { adapter };
