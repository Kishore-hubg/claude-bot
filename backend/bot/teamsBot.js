const { ActivityHandler, MessageFactory } = require('botbuilder');
const agenticOrchestratorService = require('../services/agenticOrchestratorService');
const User = require('../models/User');
const Request = require('../models/Request');
const PoolConfig = require('../models/PoolConfig');
const adaptiveCards = require('./adaptiveCards');
const { run: runOffboarding } = require('../workflows/wf3-offboarding');
const { run: runProvisioning } = require('../workflows/wf1-provisioning');

const isAdminRole = (role) => ['ai_coe_lead', 'admin'].includes(role);

const adminHelpText = `Admin commands:
- admin pool
- admin pending
- admin revoke <employeeId|email>
- admin retry <requestRef|requestId>
- admin audit [limit]
- admin report`;

const handleAdminCommand = async (requester, text) => {
  if (!isAdminRole(requester.role)) {
    return 'Access denied. Admin commands are restricted to AI Governance Admin role.';
  }

  const command = text.trim().toLowerCase();

  if (command === 'admin pool') {
    const pools = await PoolConfig.find({ isActive: true }).sort({ poolKey: 1 }).lean();
    if (!pools.length) return 'No active pool configuration found.';
    const lines = pools.map((p) => {
      const available = Math.max(0, (p.totalSeats || 0) - (p.assignedSeats || 0));
      return `- ${p.poolKey}: assigned ${p.assignedSeats}/${p.totalSeats}, available ${available}`;
    });
    return `Pool utilization:\n${lines.join('\n')}`;
  }

  if (command === 'admin pending') {
    const pending = await Request.find({ status: 'pending_approval' })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('requester', 'name');
    if (!pending.length) return 'No pending approvals right now.';
    const lines = pending.map((r) => `- ${r.referenceId} (${r.type}) by ${r.requester?.name || 'Unknown'}`);
    return `Pending requests:\n${lines.join('\n')}`;
  }

  if (command.startsWith('admin revoke ')) {
    const target = text.trim().slice('admin revoke '.length).trim();
    if (!target) return 'Usage: admin revoke <employeeId|email>';
    const result = await runOffboarding({ employeeId: target, email: target.includes('@') ? target : undefined });
    return result.success
      ? `Revoke completed. Revoked licenses: ${result.revoked}.`
      : 'Revoke failed. Check logs for details.';
  }

  if (command.startsWith('admin retry ')) {
    const ref = text.trim().slice('admin retry '.length).trim();
    if (!ref) return 'Usage: admin retry <requestRef|requestId>';
    const request = await Request.findOne({
      $or: [{ referenceId: ref }, { _id: ref }]
    });
    if (!request) return `Request not found for ${ref}.`;
    if (request.status !== 'provisioning_failed') {
      return `Retry allowed only for provisioning_failed requests. Current status: ${request.status}.`;
    }
    request.auditLog.push({
      action: 'admin_retry_provisioning',
      performedBy: requester._id,
      details: { byCommand: true }
    });
    await request.save();
    await runProvisioning(request);
    return `Provisioning retry executed for ${request.referenceId}.`;
  }

  if (command.startsWith('admin audit')) {
    const limitPart = text.trim().split(/\s+/)[2];
    const limit = Math.min(parseInt(limitPart || '10', 10) || 10, 50);
    const rows = await Request.find({})
      .sort({ updatedAt: -1 })
      .limit(limit)
      .select('referenceId type status updatedAt');
    if (!rows.length) return 'No audit rows found.';
    const lines = rows.map((r) => `- ${r.referenceId}: ${r.type} -> ${r.status}`);
    return `Latest ${rows.length} audit entries:\n${lines.join('\n')}`;
  }

  if (command === 'admin report') {
    const [pending, rejected, deployed] = await Promise.all([
      Request.countDocuments({ status: 'pending_approval' }),
      Request.countDocuments({ status: 'rejected' }),
      Request.countDocuments({ status: 'deployed' })
    ]);
    return `Report -> Pending: ${pending}, Rejected: ${rejected}, Deployed: ${deployed}.`;
  }

  if (command.startsWith('admin keep')) {
    return 'Keep command acknowledged. The selected license remains active and no reclamation action will be taken.';
  }

  return adminHelpText;
};

class TeamsBot extends ActivityHandler {
  constructor() {
    super();

    this.onMembersAdded(async (context, next) => {
      for (const member of context.activity.membersAdded || []) {
        if (member.id !== context.activity.recipient.id) {
          await context.sendActivity('Hi! I can help with Claude access, upgrades, support, and workflow requests.');
        }
      }
      await next();
    });

    this.onMessage(async (context, next) => {
      const text = (context.activity.text || '').trim();
      if (!text) {
        await context.sendActivity('Send me a request, for example: "I need Claude access for EMP123 and I agree to the AUP."');
        await next();
        return;
      }

      const teamsUserId = context.activity.from?.aadObjectId;
      if (!teamsUserId) {
        await context.sendActivity('I could not identify your Teams AAD user id. Please contact support.');
        await next();
        return;
      }

      const requester = await User.findOneAndUpdate(
        { teamsUserId },
        {
          teamsConversationId: context.activity.conversation?.id,
          teamsConversationRef: {
            conversation: context.activity.conversation,
            serviceUrl: context.activity.serviceUrl,
            channelId: context.activity.channelId,
            bot: context.activity.recipient,
            user: context.activity.from
          }
        },
        { new: true }
      );

      if (!requester) {
        await context.sendActivity('Your Teams account is not mapped in this system yet. Ask admin to set your `teamsUserId`.');
        await next();
        return;
      }

      try {
        if (text.toLowerCase().startsWith('admin')) {
          const adminResponse = await handleAdminCommand(requester, text);
          await context.sendActivity(adminResponse);
          await next();
          return;
        }

        const { classification } = await agenticOrchestratorService.classifyAndExtract({
          message: text,
          conversationHistory: [],
          user: requester
        });

        if (classification.missingFields?.length > 0 && classification.clarificationQuestion) {
          await context.sendActivity(MessageFactory.text(classification.clarificationQuestion));
          await next();
          return;
        }

        let requestDoc;
        if (classification.type === 'access') {
          const wf0 = require('../workflows/wf0-accountRequest');
          const result = await wf0.run(classification, requester, [{ role: 'user', content: text }]);
          if (!result.success) {
            await context.sendActivity(result.clarificationQuestion || `Unable to process request: ${result.reason}`);
            await next();
            return;
          }
          requestDoc = result.request;
        } else {
          const { initiateWorkflow } = require('../services/workflowService');
          const created = await Request.create({
            requester: requester._id,
            type: classification.type,
            title: classification.title,
            description: text,
            priority: classification.extractedFields?.priority || 'medium',
            details: classification.extractedFields,
            aiClassification: {
              confidence: classification.confidence,
              extractedFields: classification.extractedFields,
              suggestedApprovers: classification.suggestedApprovers,
              processedAt: new Date()
            },
            conversationHistory: [{ role: 'user', content: text }],
            auditLog: [{
              action: 'request_created',
              performedBy: requester._id,
              toStatus: 'submitted',
              details: { source: 'teams_bot', aiConfidence: classification.confidence }
            }]
          });
          await initiateWorkflow(created._id);
          requestDoc = await Request.findById(created._id);
        }

        await context.sendActivity({ attachments: [adaptiveCards.confirmationCard(requestDoc)] });
      } catch (error) {
        console.error('[teamsBot] message handling failed:', error.message);
        await context.sendActivity('I could not process your request right now. Please try again in a minute.');
      }

      await next();
    });
  }
}

const teamsBot = new TeamsBot();

module.exports = { teamsBot };
