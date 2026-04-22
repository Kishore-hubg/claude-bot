process.env.PROVISIONING_STUB = 'true';
const provisioningService = require('../services/provisioningService');

describe('provisioningService (PROVISIONING_STUB=true)', () => {
  it('createInvitation returns success with invitationId', async () => {
    const result = await provisioningService.createInvitation({
      requestRef: 'REQ-2026-00001',
      email: 'test@test.com',
      role: 'member',
      metadata: { employeeId: 'EMP001', licenseType: 'standard', accessTier: 'T2' }
    });
    expect(result.success).toBe(true);
    expect(result.invitationId).toBeDefined();
    expect(result.createdAt).toBeDefined();
  });

  it('revokeAccount returns success', async () => {
    const result = await provisioningService.revokeAccount({ claudeUserId: 'stub-id' });
    expect(result.success).toBe(true);
  });

  it('getLastActiveDate returns Date older than 30 days', async () => {
    const date = await provisioningService.getLastActiveDate({ claudeUserId: 'stub-id' });
    expect(date).toBeInstanceOf(Date);
    expect(Date.now() - date.getTime()).toBeGreaterThan(30 * 24 * 60 * 60 * 1000);
  });

  it('getUsageCost returns totalUSD and byUser array', async () => {
    const result = await provisioningService.getUsageCost({ startDate: new Date(), endDate: new Date() });
    expect(result).toHaveProperty('totalUSD');
    expect(Array.isArray(result.byUser)).toBe(true);
  });
});
