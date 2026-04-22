jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' })
  })
}));

const emailService = require('../services/emailService');

describe('emailService', () => {
  const mockUser = { name: 'Jane User', email: 'jane@infovision.com' };
  const mockRequest = { referenceId: 'REQ-2026-00001', type: 'access', title: 'Test', priority: 'high' };

  it('approvalRequest sends without throwing', async () => {
    process.env.EMAIL_USER = 'sender@test.com';
    await expect(
      emailService.approvalRequest(mockUser, mockRequest, 'approve-link', 'reject-link')
    ).resolves.not.toThrow();
  });

  it('aupAcknowledgement sends without throwing', async () => {
    process.env.EMAIL_USER = 'sender@test.com';
    await expect(
      emailService.aupAcknowledgement({ ...mockUser, licenseType: 'standard', accessTier: 'T2' })
    ).resolves.not.toThrow();
  });

  it('idleWarning sends without throwing', async () => {
    process.env.EMAIL_USER = 'sender@test.com';
    await expect(
      emailService.idleWarning({ ...mockUser, lastActiveDate: new Date() })
    ).resolves.not.toThrow();
  });
});
