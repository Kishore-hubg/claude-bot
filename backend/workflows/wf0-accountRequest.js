const Request = require('../models/Request');
const sharepointService = require('../services/sharepointService');
const { initiateWorkflow } = require('../services/workflowService');

const run = async (classification, requester, conversationHistory) => {
  const { extractedFields, type, title, confidence, suggestedApprovers } = classification;

  if (!extractedFields?.aupConfirmed) {
    return {
      success: false,
      needsClarification: true,
      clarificationQuestion: 'Before I can process your request, please confirm you have read and agree to InfoVision\'s Claude Acceptable Use Policy (AI-001). Type "I agree to the AUP" to confirm.'
    };
  }

  const duplicate = await sharepointService.checkDuplicate(
    extractedFields.employeeId,
    extractedFields.licenseType
  );
  if (duplicate.isDuplicate) {
    return { success: false, isDuplicate: true, reason: duplicate.reason };
  }

  const request = await Request.create({
    requester: requester._id,
    type,
    title,
    description: conversationHistory[conversationHistory.length - 1]?.content || title,
    priority: extractedFields.priority || 'medium',
    details: extractedFields,
    employeeId: extractedFields.employeeId,
    clientProject: extractedFields.clientProject || false,
    sowNumber: extractedFields.sowNumber,
    dataSensitivity: extractedFields.dataSensitivity,
    aupConfirmed: true,
    licenseType: extractedFields.licenseType,
    accessTier: extractedFields.accessTier,
    aiClassification: {
      confidence,
      extractedFields,
      suggestedApprovers,
      processedAt: new Date()
    },
    conversationHistory: conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    auditLog: [{
      action: 'request_created',
      performedBy: requester._id,
      toStatus: 'submitted',
      details: { source: 'bot_chat', aiConfidence: confidence }
    }]
  });

  await initiateWorkflow(request._id);

  return { success: true, request: await Request.findById(request._id) };
};

module.exports = { run };
