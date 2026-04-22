process.env.SHAREPOINT_ENABLED = 'false';

jest.mock('../models/User', () => ({ findOne: jest.fn() }));
jest.mock('../models/Request', () => ({ exists: jest.fn() }));

const sharepointService = require('../services/sharepointService');
const User = require('../models/User');
const Request = require('../models/Request');

describe('sharepointService (SHAREPOINT_ENABLED=false)', () => {
  it('returns no duplicate when no existing user or request', async () => {
    User.findOne.mockResolvedValue(null);
    Request.exists.mockResolvedValue(false);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result).toEqual({ isDuplicate: false, reason: null });
  });

  it('returns duplicate when user already provisioned', async () => {
    User.findOne.mockResolvedValue({ employeeId: 'EMP001', licenseType: 'standard' });
    Request.exists.mockResolvedValue(false);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result.isDuplicate).toBe(true);
  });

  it('returns duplicate when inflight request exists', async () => {
    User.findOne.mockResolvedValue(null);
    Request.exists.mockResolvedValue(true);
    const result = await sharepointService.checkDuplicate('EMP001', 'standard');
    expect(result.isDuplicate).toBe(true);
  });

  it('syncProvisionedUser is no-op when disabled', async () => {
    await expect(sharepointService.syncProvisionedUser({ employeeId: 'EMP001' })).resolves.toBeUndefined();
  });
});
