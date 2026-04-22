const User = require('../models/User');
const Request = require('../models/Request');

const isEnabled = () => process.env.SHAREPOINT_ENABLED === 'true';

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

const checkDuplicateMongo = async (employeeId) => {
  const existingUser = await User.findOne({
    employeeId,
    licenseType: { $ne: null }
  });
  if (existingUser) {
    return { isDuplicate: true, reason: `Employee ${employeeId} already has a ${existingUser.licenseType} license` };
  }

  const inflightRequest = await Request.exists({
    employeeId,
    type: 'access',
    status: { $in: ['pending_approval', 'approved', 'in_progress', 'deployed'] }
  });
  if (inflightRequest) {
    return { isDuplicate: true, reason: `Active access request already exists for employee ${employeeId}` };
  }

  return { isDuplicate: false, reason: null };
};

const checkDuplicateSharePoint = async (employeeId) => {
  try {
    const client = await getGraphClient();
    const siteId = process.env.SHAREPOINT_SITE_ID;
    const fileId = process.env.SHAREPOINT_FILE_ID;
    const range = await client
      .api(`/sites/${siteId}/drives/${fileId}/root:/Claude_Inventory.xlsx:/workbook/tables/InventoryTable/rows`)
      .get();

    const existing = range.value?.find((row) => row.values[0][0] === employeeId);
    if (existing) {
      return { isDuplicate: true, reason: `Employee ${employeeId} found in SharePoint inventory` };
    }
    return { isDuplicate: false, reason: null };
  } catch (err) {
    console.error('[sharepointService] Graph API error, fallback MongoDB:', err.message);
    return checkDuplicateMongo(employeeId);
  }
};

const checkDuplicate = async (employeeId, licenseType) => {
  if (!employeeId || !licenseType) {
    return { isDuplicate: false, reason: null };
  }
  return isEnabled()
    ? checkDuplicateSharePoint(employeeId, licenseType)
    : checkDuplicateMongo(employeeId, licenseType);
};

const syncProvisionedUser = async (userData) => {
  if (!isEnabled()) return;
  try {
    const client = await getGraphClient();
    const siteId = process.env.SHAREPOINT_SITE_ID;
    const fileId = process.env.SHAREPOINT_FILE_ID;
    await client
      .api(`/sites/${siteId}/drives/${fileId}/root:/Claude_Inventory.xlsx:/workbook/tables/InventoryTable/rows/add`)
      .post({
        values: [[
          userData.employeeId,
          userData.name,
          userData.role || '',
          userData.department || '',
          userData.managerName || '',
          userData.costCenter || '',
          userData.dateRequiredBy || '',
          'Claude',
          userData.businessJustification || '',
          userData.clientProject ? 'Yes' : 'No',
          'Yes',
          userData.dateProvisioned?.toISOString().split('T')[0] || new Date().toISOString().split('T')[0],
          '',
          userData.licenseType || 'standard',
          userData.accessTier || 'T2'
        ]]
      });
  } catch (err) {
    console.error('[sharepointService] Failed to sync:', err.message);
  }
};

module.exports = { checkDuplicate, syncProvisionedUser };
