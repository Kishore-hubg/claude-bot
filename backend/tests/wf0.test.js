jest.mock('../services/sharepointService', () => ({
  checkDuplicate: jest.fn().mockResolvedValue({ isDuplicate: false, reason: null })
}));
jest.mock('../services/workflowService', () => ({
  initiateWorkflow: jest.fn().mockResolvedValue({})
}));
jest.mock('../services/emailService', () => ({
  approvalRequest: jest.fn().mockResolvedValue({})
}));
jest.mock('../models/Request', () => ({
  create: jest.fn().mockResolvedValue({ _id: 'req-id', referenceId: 'REQ-2026-00001', type: 'access', requester: 'user-id' }),
  findById: jest.fn().mockResolvedValue({ _id: 'req-id', referenceId: 'REQ-2026-00001' })
}));
jest.mock('../models/User', () => ({
  findOne: jest.fn().mockResolvedValue({ _id: 'manager-id', email: 'manager@test.com' })
}));

const wf0 = require('../workflows/wf0-accountRequest');

describe('wf0-accountRequest', () => {
  const baseClassification = {
    type: 'access',
    title: 'New License',
    confidence: 0.95,
    extractedFields: { employeeId: 'EMP001', licenseType: 'standard', accessTier: 'T2', aupConfirmed: true },
    missingFields: [],
    clarificationQuestion: null,
    suggestedApprovers: ['manager']
  };
  const mockUser = { _id: 'user-id', name: 'Jane', email: 'jane@test.com' };

  it('rejects when aupConfirmed is false', async () => {
    const classification = { ...baseClassification, extractedFields: { ...baseClassification.extractedFields, aupConfirmed: false } };
    const result = await wf0.run(classification, mockUser, []);
    expect(result.success).toBe(false);
    expect(result.needsClarification).toBe(true);
  });

  it('rejects when duplicate found', async () => {
    const sharepointService = require('../services/sharepointService');
    sharepointService.checkDuplicate.mockResolvedValueOnce({ isDuplicate: true, reason: 'Already provisioned' });
    const result = await wf0.run(baseClassification, mockUser, []);
    expect(result.success).toBe(false);
    expect(result.isDuplicate).toBe(true);
  });

  it('creates request and initiates workflow when valid', async () => {
    const result = await wf0.run(baseClassification, mockUser, []);
    expect(result.success).toBe(true);
    expect(result.request).toBeDefined();
  });
});
