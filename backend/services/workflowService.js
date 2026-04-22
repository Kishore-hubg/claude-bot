const Request = require('../models/Request');
const Notification = require('../models/Notification');
const User = require('../models/User');
const wf1 = require('../workflows/wf1-provisioning');
const provisioningService = require('./provisioningService');
const emailService = require('./emailService');
const teamsNotificationService = require('./teamsNotificationService');
const activityFeedService = require('./activityFeedService');
const teamsWebhookService = require('./teamsWebhookService');

/**
 * Workflow Service
 *
 * This is the orchestration layer — it implements the approval state machine
 * described in the Implementation Plan. Each request type has its own approval
 * chain (e.g., Access goes Manager → Admin → Deploy, Plugins go CTO → Deploy).
 *
 * The service is intentionally stateless: all state lives in MongoDB, so the
 * service can be scaled horizontally without coordination problems.
 */

// Defines the approval chain for each request type.
// Each step specifies which user role must approve before moving to the next.
const APPROVAL_CHAINS = {
  access:           ['manager', 'ai_coe_lead'],
  upgrade:          ['manager', 'ai_coe_lead'],
  skills:           ['manager', 'ai_coe_lead'],
  offboarding:      ['manager', 'ai_coe_lead'],
  idle_reclamation: [],
  connectors:       ['manager', 'ai_coe_lead'],
  plugins:          ['manager', 'ai_coe_lead'],
  apis:             ['manager', 'ai_coe_lead'],
  support_qa:       ['manager', 'ai_coe_lead']
};

/**
 * Resolves the requester's manager as the L1 approver (manager mailbox / Teams DM).
 * Uses requester.managerId, then requester.managerEmail, then optional org fallback.
 */
const resolveManagerApprover = async (requester, requesterId) => {
  const rid = requesterId.toString();

  if (requester.managerId) {
    const m = await User.findOne({ _id: requester.managerId, isActive: true });
    if (m && m._id.toString() !== rid) return m;
  }

  if (requester.managerEmail) {
    const email = String(requester.managerEmail).toLowerCase().trim();
    const m = await User.findOne({ email, isActive: true });
    if (m && m._id.toString() !== rid) return m;
  }

  if (process.env.MANAGER_APPROVER_FALLBACK === 'true') {
    return User.findOne({
      role: 'manager',
      isActive: true,
      _id: { $ne: requesterId }
    });
  }

  throw new Error(
    'No manager approver: set User.managerId or User.managerEmail to an active manager account, or set MANAGER_APPROVER_FALLBACK=true for demo fallback.'
  );
};

/**
 * Builds the initial approval steps array for a new request.
 * L1 "manager" uses the requester's manager (DB relationship), not a random manager user.
 *
 * @param {string} requestType
 * @param {object} requester - populated User document
 */
const buildApprovalChain = async (requestType, requester) => {
  const requesterId = requester._id;
  const roles = APPROVAL_CHAINS[requestType] || ['ai_coe_lead'];
  const steps = [];

  for (let i = 0; i < roles.length; i++) {
    const requiredRole = roles[i];
    let approver;

    if (requiredRole === 'manager') {
      approver = await resolveManagerApprover(requester, requesterId);
    } else {
      approver = await User.findOne({
        role: requiredRole,
        isActive: true,
        _id: { $ne: requesterId }
      });
    }

    if (!approver) {
      throw new Error(`Approval chain misconfigured: no active approver available for role "${requiredRole}"`);
    }

    steps.push({
      approver: approver._id,
      approverRole: requiredRole,
      status: 'pending',
      stepOrder: i + 1
    });
  }

  return steps;
};

/**
 * Transitions a request to 'pending_approval' status and sets up its approval chain.
 * Called after Claude classifies the request and fills in required details.
 */
const initiateWorkflow = async (requestId) => {
  const request = await Request.findById(requestId).populate('requester');
  if (!request) throw new Error('Request not found');

  const approvalSteps = await buildApprovalChain(request.type, request.requester);

  request.approvalSteps = approvalSteps;
  request.status = 'pending_approval';
  request.currentApprovalStep = 0;
  request.auditLog.push({
    action: 'workflow_initiated',
    performedBy: request.requester._id,
    fromStatus: 'submitted',
    toStatus: 'pending_approval',
    details: { approvalChain: APPROVAL_CHAINS[request.type] }
  });

  await request.save();

  // Notify the first approver (manager mailbox + Teams DM + optional channel webhook via createNotification)
  if (approvalSteps[0]?.approver) {
    await createNotification({
      recipientId: approvalSteps[0].approver,
      requestId: request._id,
      type: 'approval_required',
      title: `Approval Required: ${request.title}`,
      message: `${request.requester.name} has submitted a ${request.type} request that needs your approval. Reference: ${request.referenceId}`
    });
  }

  // Notify requester: submission received (in-app + email + Teams + activity feed)
  await createNotification({
    recipientId: request.requester._id,
    requestId: request._id,
    type: 'request_submitted',
    title: `Request submitted: ${request.referenceId}`,
    message: `Your ${request.type} request "${request.title}" was received and is pending approval.`
  });

  return request;
};

/**
 * Processes an approval decision (approve or reject) from an approver.
 *
 * If approved and there are more steps in the chain, advances to the next step.
 * If approved and this was the final step, transitions to 'approved' then 'in_progress'.
 * If rejected at any step, the entire request is rejected immediately.
 */
const processApproval = async (requestId, approverId, decision, comments) => {
  const request = await Request.findById(requestId).populate('requester approvalSteps.approver');
  if (!request) throw new Error('Request not found');

  const currentStep = request.approvalSteps[request.currentApprovalStep];
  if (!currentStep) throw new Error('No pending approval step found');

  // Verify the person acting is actually the designated approver for this step
  if (currentStep.approver?._id.toString() !== approverId) {
    throw new Error('You are not authorized to approve this step');
  }

  const prevStatus = request.status;

  // Record the decision on the current step
  currentStep.status = decision;
  currentStep.comments = comments;
  currentStep.decidedAt = new Date();

  if (decision === 'rejected') {
    request.status = 'rejected';
    request.auditLog.push({
      action: 'request_rejected',
      performedBy: approverId,
      fromStatus: prevStatus,
      toStatus: 'rejected',
      details: { step: request.currentApprovalStep + 1, comments }
    });

    // Notify the requester of rejection
    await createNotification({
      recipientId: request.requester._id,
      requestId: request._id,
      type: 'request_rejected',
      title: `Request Rejected: ${request.title}`,
      message: `Your ${request.type} request (${request.referenceId}) has been rejected. Reason: ${comments || 'No reason provided.'}`
    });

  } else if (decision === 'approved') {
    const nextStepIndex = request.currentApprovalStep + 1;
    const hasMoreSteps = nextStepIndex < request.approvalSteps.length;

    if (hasMoreSteps) {
      // Advance to the next approval step
      request.currentApprovalStep = nextStepIndex;
      const nextStep = request.approvalSteps[nextStepIndex];

      request.auditLog.push({
        action: 'step_approved',
        performedBy: approverId,
        details: { step: request.currentApprovalStep, nextApprover: nextStep.approverRole }
      });

      // Notify the next approver
      if (nextStep.approver) {
        await createNotification({
          recipientId: nextStep.approver,
          requestId: request._id,
          type: 'approval_required',
          title: `Approval Required: ${request.title}`,
          message: `A ${request.type} request from ${request.requester.name} has been approved at the previous level and now requires your review. Reference: ${request.referenceId}`
        });
      }

      await createNotification({
        recipientId: request.requester._id,
        requestId: request._id,
        type: 'approval_progress',
        title: `Progress: ${request.referenceId}`,
        message: `Your request was approved at the previous step and is now with the next approver. Reference: ${request.referenceId}`
      });

    } else {
      // All approval steps complete — move to approved → in_progress
      request.status = 'approved';
      request.auditLog.push({
        action: 'fully_approved',
        performedBy: approverId,
        fromStatus: prevStatus,
        toStatus: 'approved',
        details: { comments }
      });

      // Notify requester
      await createNotification({
        recipientId: request.requester._id,
        requestId: request._id,
        type: 'request_approved',
        title: `Request Approved: ${request.title}`,
        message: `Great news! Your ${request.type} request (${request.referenceId}) has been fully approved and is now being processed.`
      });

      // Automatically kick off deployment/provisioning
      await triggerDeployment(request);
    }
  }

  await request.save();
  return request;
};

const triggerDeployment = async (request) => {
  request.status = 'in_progress';
  request.auditLog.push({
    action: 'deployment_started',
    details: { automatedAction: true, requestType: request.type }
  });
  await request.save();

  if (request.type === 'access') {
    await wf1.run(request);
  } else if (request.type === 'upgrade') {
    await provisioningService.upgradeAccount({
      claudeUserId: request.requester._id.toString(),
      newTier: request.details?.accessTier || 'T1'
    });
    await User.findByIdAndUpdate(request.requester._id, {
      licenseType: request.details?.licenseType || 'premium',
      accessTier: request.details?.accessTier || 'T1'
    });
    request.auditLog.push({
      action: 'tier_upgraded',
      details: {
        licenseType: request.details?.licenseType || 'premium',
        accessTier: request.details?.accessTier || 'T1'
      }
    });
  } else if (request.type === 'offboarding') {
    const wf3 = require('../workflows/wf3-offboarding');
    await wf3.run({
      employeeId: request.details?.employeeId,
      email: request.details?.email || request.requester.email
    });
  } else {
    request.auditLog.push({
      action: 'workflow_completed',
      details: { requestType: request.type, executionMode: 'logical_completion' }
    });
  }

  request.status = 'deployed';
  request.actualCompletionDate = new Date();
  request.auditLog.push({
    action: 'deployment_completed',
    fromStatus: 'in_progress',
    toStatus: 'deployed',
    details: { automatedAction: true }
  });
};

/**
 * Helper to create a Notification document and trigger email delivery where configured.
 */
const createNotification = async ({ recipientId, requestId, type, title, message }) => {
  const notification = await Notification.create({
    recipient: recipientId,
    request: requestId,
    type,
    title,
    message
  });

  try {
    const [recipient, request] = await Promise.all([
      User.findById(recipientId).select('name email teamsUserId teamsConversationRef'),
      Request.findById(requestId).populate('requester', 'name email')
    ]);

    const [emailResult, teamsResult, activityResult] = await Promise.allSettled([
      emailService.sendNotificationByType({ recipient, request, type, message }),
      teamsNotificationService.send({ recipient, request, type, title, message }),
      activityFeedService.send({ recipient, request, title, message })
    ]);

    notification.channels = notification.channels || {};
    notification.channels.email = {
      ...(notification.channels.email || {}),
      sent: emailResult.status === 'fulfilled' && emailResult.value === true,
      sentAt: emailResult.status === 'fulfilled' && emailResult.value === true ? new Date() : undefined,
      error: emailResult.status === 'rejected' ? emailResult.reason?.message : undefined
    };
    notification.channels.teams = {
      ...(notification.channels.teams || {}),
      sent: teamsResult.status === 'fulfilled' && teamsResult.value === true,
      sentAt: teamsResult.status === 'fulfilled' && teamsResult.value === true ? new Date() : undefined,
      error: teamsResult.status === 'rejected' ? teamsResult.reason?.message : undefined
    };
    notification.channels.activityFeed = {
      ...(notification.channels.activityFeed || {}),
      sent: activityResult.status === 'fulfilled' && activityResult.value === true,
      sentAt: activityResult.status === 'fulfilled' && activityResult.value === true ? new Date() : undefined,
      error: activityResult.status === 'rejected' ? activityResult.reason?.message : undefined
    };
    await notification.save();

    if (type === 'approval_required' && request) {
      teamsWebhookService.postApprovalSummary({ title, message, request }).catch(() => {});
    }
  } catch (err) {
    notification.channels = notification.channels || {};
    notification.channels.email = {
      ...(notification.channels.email || {}),
      sent: false,
      error: err.message
    };
    await notification.save();
  }
};

module.exports = { initiateWorkflow, processApproval, buildApprovalChain, APPROVAL_CHAINS };
