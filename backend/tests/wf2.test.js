jest.mock('../models/User', () => ({
  find: jest.fn(),
  findByIdAndUpdate: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/provisioningService', () => ({
  revokeAccount: jest.fn().mockResolvedValue({ success: true }),
  getLastActiveDate: jest.fn().mockResolvedValue(new Date(Date.now() - 40 * 24 * 60 * 60 * 1000))
}));
jest.mock('../services/emailService', () => ({
  offboardingConfirm: jest.fn().mockResolvedValue({}),
  idleWarning: jest.fn().mockResolvedValue({})
}));

const User = require('../models/User');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');
const wf2 = require('../workflows/wf2-idleReclamation');

describe('wf2-idleReclamation', () => {
  it('warns inactive users and deprovisions warned users', async () => {
    User.find
      .mockResolvedValueOnce([
        { _id: 'u-deprovision', licenseType: 'standard', email: 'a@b.com', name: 'A' }
      ])
      .mockResolvedValueOnce([
        { _id: 'u-warn', licenseType: 'premium', email: 'c@d.com', name: 'C' }
      ]);

    const result = await wf2.run();
    expect(result.success).toBe(true);
    expect(result.deprovisioned).toBe(1);
    expect(result.warned).toBe(1);
    expect(provisioningService.revokeAccount).toHaveBeenCalledTimes(1);
    expect(emailService.idleWarning).toHaveBeenCalledTimes(1);
  });
});
