jest.mock('../services/provisioningService', () => ({
  createInvitation: jest.fn().mockResolvedValue({ success: true, invitationId: 'invite-123', createdAt: new Date() })
}));
jest.mock('../services/emailService', () => ({
  aupAcknowledgement: jest.fn().mockResolvedValue({}),
  sendNotificationByType: jest.fn().mockResolvedValue(true)
}));
jest.mock('../services/sharepointService', () => ({
  syncProvisionedUser: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/teamsNotificationService', () => ({
  send: jest.fn().mockResolvedValue(true)
}));
jest.mock('../services/activityFeedService', () => ({
  send: jest.fn().mockResolvedValue(true)
}));
jest.mock('../models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn().mockResolvedValue({ _id: 'admin-id', email: 'admin@test.com' })
}));
jest.mock('../models/PoolConfig', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({ poolKey: 'claude-default', assignedSeats: 1, totalSeats: 10 })
}));
jest.mock('../models/License', () => ({
  create: jest.fn().mockResolvedValue({ licenseRef: 'LIC-2026-00001' })
}));
jest.mock('../models/Notification', () => ({
  create: jest.fn().mockResolvedValue({})
}));

const wf1 = require('../workflows/wf1-provisioning');

describe('wf1-provisioning', () => {
  const mockRequest = {
    _id: 'req-id',
    referenceId: 'REQ-2026-00001',
    type: 'access',
    title: 'Test',
    priority: 'high',
    requester: { _id: 'user-id', email: 'jane@test.com', name: 'Jane' },
    details: { employeeId: 'EMP001', licenseType: 'standard', accessTier: 'T2' },
    auditLog: [],
    save: jest.fn().mockResolvedValue({})
  };

  it('calls provisioningService.createInvitation with request reference', async () => {
    const provisioningService = require('../services/provisioningService');
    await wf1.run(mockRequest);
    expect(provisioningService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      requestRef: 'REQ-2026-00001',
      email: 'jane@test.com',
      role: 'member'
    }));
  });

  it('sends AUP acknowledgement email to requester on success', async () => {
    const emailService = require('../services/emailService');
    await wf1.run(mockRequest);
    expect(emailService.aupAcknowledgement).toHaveBeenCalled();
  });

  it('updates User document and creates license record', async () => {
    const User = require('../models/User');
    const License = require('../models/License');
    await wf1.run(mockRequest);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ aupAcknowledged: true, licenseType: 'standard' })
    );
    expect(License.create).toHaveBeenCalledWith(expect.objectContaining({
      request: 'req-id',
      user: 'user-id',
      poolKey: 'claude-default'
    }));
  });
});
