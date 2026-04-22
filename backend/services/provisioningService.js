const axios = require('axios');

const useStub = () => process.env.PROVISIONING_STUB !== 'false';

const randomId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const createInvitation = async ({ requestRef, email, role = 'member', metadata = {} }) => {
  if (useStub()) {
    return {
      success: true,
      invitationId: randomId('invite'),
      requestRef,
      email,
      role,
      metadata,
      createdAt: new Date()
    };
  }

  const { data } = await axios.post(
    `${process.env.PROVISIONING_API_BASE_URL}/invitations`,
    { requestRef, email, role, metadata },
    {
      headers: {
        Authorization: `Bearer ${process.env.PROVISIONING_API_KEY}`,
        ...(requestRef ? { 'Idempotency-Key': requestRef } : {})
      }
    }
  );
  return {
    success: true,
    invitationId: data.invitationId || data.id,
    requestRef,
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date()
  };
};

// Backward compatible helper for existing callers/tests.
const createAccount = async ({ employeeId, email, licenseType, accessTier, requestRef }) => createInvitation({
  requestRef,
  email,
  role: 'member',
  metadata: { employeeId, licenseType, accessTier }
});

const revokeAccount = async ({ claudeUserId }) => {
  if (useStub()) {
    return { success: true, revokedAt: new Date(), claudeUserId };
  }
  await axios.post(
    `${process.env.PROVISIONING_API_BASE_URL}/accounts/${claudeUserId}/revoke`,
    {},
    { headers: { Authorization: `Bearer ${process.env.PROVISIONING_API_KEY}` } }
  );
  return { success: true, revokedAt: new Date(), claudeUserId };
};

const upgradeAccount = async ({ claudeUserId, newTier }) => {
  if (useStub()) {
    return { success: true, claudeUserId, newTier, updatedAt: new Date() };
  }
  await axios.post(
    `${process.env.PROVISIONING_API_BASE_URL}/accounts/${claudeUserId}/upgrade`,
    { newTier },
    { headers: { Authorization: `Bearer ${process.env.PROVISIONING_API_KEY}` } }
  );
  return { success: true, claudeUserId, newTier, updatedAt: new Date() };
};

const getLastActiveDate = async ({ claudeUserId }) => {
  if (useStub()) {
    return new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
  }
  const { data } = await axios.get(
    `${process.env.PROVISIONING_API_BASE_URL}/accounts/${claudeUserId}/last-active`,
    { headers: { Authorization: `Bearer ${process.env.PROVISIONING_API_KEY}` } }
  );
  return new Date(data.lastActiveDate);
};

const getUsageCost = async ({ startDate, endDate }) => {
  if (useStub()) {
    return {
      totalUSD: 120.5,
      byUser: [
        { name: 'User One', email: 'user.one@infovision.com', claudeUserId: 'stub-1', tokensUsed: 180000, accessTier: 'T2', currentTier: 'T2' },
        { name: 'User Two', email: 'user.two@infovision.com', claudeUserId: 'stub-2', tokensUsed: 18000, accessTier: 'T2', currentTier: 'T2' }
      ]
    };
  }
  const { data } = await axios.get(`${process.env.PROVISIONING_API_BASE_URL}/usage`, {
    params: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    headers: { Authorization: `Bearer ${process.env.PROVISIONING_API_KEY}` }
  });
  return data;
};

module.exports = {
  createInvitation,
  createAccount,
  revokeAccount,
  upgradeAccount,
  getLastActiveDate,
  getUsageCost
};
