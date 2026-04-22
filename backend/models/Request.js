const mongoose = require('mongoose');

/**
 * Request Model
 * This is the central entity of the Claude Assistant Bot system.
 * It tracks the full lifecycle of every request from submission to closure,
 * including all conversation history, approvals, and audit events.
 *
 * Lifecycle states (state machine):
 *   submitted → pending_approval → approved → in_progress → deployed → closed
 *                                ↓
 *                             rejected
 */
const approvalStepSchema = new mongoose.Schema({
  approver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approverRole: String,            // Role required for this step
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'skipped'],
    default: 'pending'
  },
  comments: String,
  decidedAt: Date,
  stepOrder: Number               // Which approval level this is (1 = first, 2 = second, etc.)
}, { _id: true });

const conversationMessageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true  // e.g., 'status_changed', 'approval_granted', 'comment_added'
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  fromStatus: String,
  toStatus: String,
  details: mongoose.Schema.Types.Mixed,  // Flexible field for any extra audit data
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const requestSchema = new mongoose.Schema({
  // Unique reference ID shown to users (e.g., REQ-2026-00001)
  referenceId: {
    type: String,
    unique: true
  },

  // Who submitted this request
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // One of the nine supported request categories (BRD A1-A9)
  type: {
    type: String,
    enum: ['access', 'upgrade', 'skills', 'offboarding', 'idle_reclamation',
           'connectors', 'plugins', 'apis', 'support_qa'],
    required: [true, 'Request type is required']
  },

  title: {
    type: String,
    required: [true, 'Request title is required'],
    maxlength: [200, 'Title cannot exceed 200 characters']
  },

  description: {
    type: String,
    required: [true, 'Description is required']
  },

  // Lifecycle status - drives the workflow state machine
  status: {
    type: String,
    enum: ['submitted', 'pending_approval', 'approved', 'rejected', 'in_progress', 'deployed', 'provisioning_failed', 'closed'],
    default: 'submitted'
  },

  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },

  // Flexible field for request-type-specific details extracted by Claude
  // e.g., for 'access': { resourceName, justification, duration }
  //        for 'apis':   { apiName, usageLevel, requestedQuota }
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },

  // BRD §4.2 — A1-specific extracted fields
  employeeId:       String,
  clientProject:    { type: Boolean, default: false },
  sowNumber:        String,
  dataSensitivity:  String,
  aupConfirmed:     { type: Boolean, default: false },
  licenseType:      String,
  accessTier:       String,

  // Email action single-use enforcement
  emailActionUsedAt: Date,

  // Multi-step approval chain (order matters)
  approvalSteps: [approvalStepSchema],

  // Index of the current active approval step
  currentApprovalStep: {
    type: Number,
    default: 0
  },

  // Full conversation history with the Claude bot
  conversationHistory: [conversationMessageSchema],

  // Complete audit trail for compliance and analytics
  auditLog: [auditLogSchema],

  // Claude's extracted/classified information for this request
  aiClassification: {
    confidence: Number,              // 0–1 confidence score
    extractedFields: mongoose.Schema.Types.Mixed,
    suggestedApprovers: [String],   // Suggested approver roles
    processedAt: Date
  },

  // Teams-specific metadata for sending adaptive cards
  teamsConversationId: String,
  teamsActivityId: String,

  // SLA tracking
  targetCompletionDate: Date,
  actualCompletionDate: Date,

  tags: [String],

  // Soft close with reason
  closureReason: String,
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Auto-generate a human-readable reference ID before saving a new request
requestSchema.pre('save', async function(next) {
  if (this.isNew && !this.referenceId) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('Request').countDocuments();
    this.referenceId = `REQ-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Index for fast querying by common filters
requestSchema.index({ requester: 1, status: 1 });
requestSchema.index({ type: 1, status: 1 });
requestSchema.index({ referenceId: 1 });
requestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Request', requestSchema);
