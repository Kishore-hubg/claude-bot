jest.mock('../services/provisioningService', () => ({
  getUsageCost: jest.fn().mockResolvedValue({
    byUser: [
      { email: 'heavy@infovision.com', claudeUserId: 'u1', tokensUsed: 250000, accessTier: 'T2', currentTier: 'T2' },
      { email: 'light@infovision.com', claudeUserId: 'u2', tokensUsed: 10000, accessTier: 'T2', currentTier: 'T2' }
    ]
  }),
  upgradeAccount: jest.fn().mockResolvedValue({ success: true })
}));
jest.mock('../services/emailService', () => ({
  quarterlyOptimization: jest.fn().mockResolvedValue({})
}));
jest.mock('../models/User', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({})
}));

const provisioningService = require('../services/provisioningService');
const User = require('../models/User');
const wf6 = require('../workflows/wf6-quarterlyOptimization');

describe('wf6-quarterlyOptimization', () => {
  it('builds upgrade and downgrade recommendations', () => {
    const recommendations = wf6.buildRecommendations([
      { email: 'a', tokensUsed: 250000, accessTier: 'T2', currentTier: 'T2' },
      { email: 'b', tokensUsed: 1000, accessTier: 'T2', currentTier: 'T2' }
    ]);
    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].recommendedTier).toBe('T1');
    expect(recommendations[1].recommendedTier).toBe('T3');
  });

  it('applies recommendations to provisioning and user records', async () => {
    const recommendations = [
      { email: 'heavy@infovision.com', claudeUserId: 'u1', recommendedTier: 'T1' },
      { email: 'light@infovision.com', claudeUserId: 'u2', recommendedTier: 'T3' }
    ];
    const result = await wf6.applyRecommendations(recommendations);
    expect(result.updated).toBe(2);
    expect(provisioningService.upgradeAccount).toHaveBeenCalledTimes(2);
    expect(User.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});
