const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Request = require('../models/Request');
const llmService = require('../services/llmService');
const agenticOrchestratorService = require('../services/agenticOrchestratorService');
const { initiateWorkflow, processApproval } = require('../services/workflowService');
const { authenticate, authorize } = require('../middleware/auth');

// Public email-link action endpoint (JWT token is sole auth mechanism)
router.get('/:id/email-action', async (req, res) => {
  try {
    const { token, decision } = req.query;
    if (!token || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).send('Invalid request');
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.EMAIL_ACTION_SECRET);
    } catch {
      return res.status(401).send('Link expired or invalid. Please request a new approval email.');
    }

    if (payload.requestId !== req.params.id || payload.decision !== decision) {
      return res.status(403).send('Token mismatch');
    }

    const request = await Request.findOneAndUpdate(
      { _id: req.params.id, emailActionUsedAt: { $exists: false } },
      { emailActionUsedAt: new Date() },
      { new: true }
    );
    if (!request) {
      return res.status(409).send('This approval link has already been used.');
    }

    const currentStep = request.approvalSteps[request.currentApprovalStep];
    if (!currentStep || currentStep.approver?.toString() !== payload.approverId) {
      return res.status(403).send('You are not authorized to approve this request at this stage.');
    }

    await processApproval(request._id.toString(), payload.approverId, decision, 'Via email link');
    res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;">
      <h2>${decision === 'approved' ? 'Approved' : 'Rejected'}</h2>
      <p>Request <strong>${request.referenceId}</strong> has been ${decision}.</p>
    </body></html>`);
  } catch (err) {
    console.error('Email action error:', err);
    res.status(500).send('An error occurred. Please log in to the dashboard.');
  }
});

// HR webhook triggers WF3 offboarding (token-protected with internal secret)
router.post('/webhooks/offboard', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_CRON_SECRET}`) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const { employeeId, email, name } = req.body;
    if (!employeeId && !email) {
      return res.status(400).json({ success: false, message: 'employeeId or email required' });
    }

    const wf3 = require('../workflows/wf3-offboarding');
    const result = await wf3.run({ employeeId, email, name });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// All remaining request routes require authentication
router.use(authenticate);

// ── POST /api/requests/chat ────────────────────────────────────────────────
// The bot's primary entry point: classify, validate, and create workflow requests.
router.post('/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const { classification, orchestration } = await agenticOrchestratorService.classifyAndExtract({
      message,
      conversationHistory,
      user: req.user
    });

    if (classification.missingFields?.length > 0 && classification.clarificationQuestion) {
      const botReply = await llmService.generateUserResponse(classification, {});
      return res.json({
        success: true,
        needsClarification: true,
        classification,
        orchestration,
        botMessage: botReply
      });
    }

    let result;
    if (classification.type === 'access') {
      const wf0 = require('../workflows/wf0-accountRequest');
      result = await wf0.run(classification, req.user, [
        ...conversationHistory,
        { role: 'user', content: message }
      ]);

      if (!result.success) {
        const botMessage = result.needsClarification
          ? result.clarificationQuestion
          : `Request rejected: ${result.reason}`;
        return res.json({ success: false, needsClarification: result.needsClarification, botMessage });
      }
    } else {
      const request = await Request.create({
        requester: req.user._id,
        type: classification.type,
        title: classification.title,
        description: message,
        priority: classification.extractedFields?.priority || 'medium',
        details: classification.extractedFields,
        aiClassification: {
          confidence: classification.confidence,
          extractedFields: classification.extractedFields,
          suggestedApprovers: classification.suggestedApprovers,
          processedAt: new Date()
        },
        conversationHistory: [...conversationHistory, { role: 'user', content: message }],
        auditLog: [{
          action: 'request_created',
          performedBy: req.user._id,
          toStatus: 'submitted',
          details: { source: 'bot_chat', aiConfidence: classification.confidence }
        }]
      });
      await initiateWorkflow(request._id);
      result = { success: true, request: await Request.findById(request._id) };
    }

    const botMessage = await llmService.generateUserResponse(classification, {
      referenceId: result.request?.referenceId,
      status: 'submitted'
    });

    if (result.request) {
      await Request.findByIdAndUpdate(result.request._id, {
        $push: { conversationHistory: { role: 'assistant', content: botMessage } }
      });
    }

    res.status(201).json({ success: true, request: result.request, orchestration, botMessage });
  } catch (err) {
    console.error('Chat error:', err);
    if (err.message?.includes('Approval chain misconfigured')) {
      return res.json({
        success: false,
        needsClarification: true,
        botMessage: 'I captured your request, but I cannot submit it yet because an approval role is not configured in the system. Please ask admin to configure active manager and AI Governance approvers, then try again.'
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/requests ──────────────────────────────────────────────────────
// Returns requests visible to the current user:
//   - Admins see everything
//   - Approvers see requests assigned to them for approval
//   - Regular users see only their own requests
router.get('/', async (req, res) => {
  try {
    const { status, type, priority, page = 1, limit = 20 } = req.query;
    const filter = {};

    // Build filter based on role
    if (!['admin', 'manager', 'tech_lead', 'architect', 'cto', 'support', 'ai_coe_lead', 'it_governance'].includes(req.user.role)) {
      filter.requester = req.user._id;  // Requesters only see their own
    } else if (req.user.role !== 'admin') {
      // Approvers see requests where they have an approval step
      filter['approvalSteps.approver'] = req.user._id;
    }

    if (status) filter.status = status;
    if (type) filter.type = type;
    if (priority) filter.priority = priority;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [requests, total] = await Promise.all([
      Request.find(filter)
        .populate('requester', 'name email role department')
        .populate('approvalSteps.approver', 'name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Request.countDocuments(filter)
    ]);

    res.json({
      success: true,
      requests,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/requests/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('requester', 'name email role department')
      .populate('approvalSteps.approver', 'name email role')
      .populate('closedBy', 'name email');

    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    // Ensure non-admin users can only view their own requests or ones they need to approve
    const isOwnRequest = request.requester._id.toString() === req.user._id.toString();
    const isApprover = request.approvalSteps.some(s => s.approver?._id.toString() === req.user._id.toString());
    const isAdmin = req.user.role === 'admin';

    if (!isOwnRequest && !isApprover && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/requests/:id/approve ────────────────────────────────────────
// Processes an approve/reject decision from an approver
router.post('/:id/approve', async (req, res) => {
  try {
    const { decision, comments } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Decision must be "approved" or "rejected"' });
    }

    const request = await processApproval(req.params.id, req.user._id.toString(), decision, comments);
    res.json({ success: true, message: `Request ${decision} successfully`, request });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── POST /api/requests/:id/close ──────────────────────────────────────────
// Manually close a request (admin or the requester can do this)
router.post('/:id/close', async (req, res) => {
  try {
    const { reason } = req.body;
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

    const canClose = req.user.role === 'admin' || request.requester.toString() === req.user._id.toString();
    if (!canClose) return res.status(403).json({ success: false, message: 'Not authorized to close this request' });

    request.status = 'closed';
    request.closureReason = reason;
    request.closedBy = req.user._id;
    request.actualCompletionDate = new Date();
    request.auditLog.push({
      action: 'request_closed',
      performedBy: req.user._id,
      toStatus: 'closed',
      details: { reason }
    });

    await request.save();
    res.json({ success: true, message: 'Request closed', request });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/requests/stats/overview ──────────────────────────────────────
// Dashboard summary stats — count by status and type
router.get('/stats/overview', authorize('admin', 'manager', 'tech_lead', 'architect', 'cto', 'support', 'ai_coe_lead', 'it_governance'), async (req, res) => {
  try {
    const [byStatus, byType, recentRequests] = await Promise.all([
      Request.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Request.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Request.find().sort({ createdAt: -1 }).limit(5).populate('requester', 'name')
    ]);

    // Transform aggregation results into convenient objects
    const statusMap = byStatus.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {});
    const typeMap = byType.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {});

    res.json({ success: true, stats: { byStatus: statusMap, byType: typeMap }, recentRequests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
