const mongoose = require('mongoose');

/**
 * Analytics Model
 * Stores aggregated daily KPI snapshots for dashboard reporting.
 * Rather than re-computing metrics from raw Request documents every time,
 * a nightly job (or triggered computation) writes snapshots here.
 * This keeps dashboard queries fast regardless of how many requests exist.
 */
const analyticsSchema = new mongoose.Schema({
  // The date this snapshot covers (normalized to midnight UTC)
  date: {
    type: Date,
    required: true,
    unique: true
  },

  // Volume metrics
  requestsSubmitted: { type: Number, default: 0 },
  requestsApproved: { type: Number, default: 0 },
  requestsRejected: { type: Number, default: 0 },
  requestsDeployed: { type: Number, default: 0 },
  requestsClosed: { type: Number, default: 0 },

  // Breakdown by request type
  byType: {
    access: { type: Number, default: 0 },
    skills: { type: Number, default: 0 },
    connectors: { type: Number, default: 0 },
    plugins: { type: Number, default: 0 },
    apis: { type: Number, default: 0 },
    support_qa: { type: Number, default: 0 }
  },

  // Performance SLAs
  avgProcessingTimeHours: Number,  // Average hours from submitted → closed
  automationRate: Number,          // % of requests closed without manual intervention (0–100)
  slaBreachCount: Number,          // Requests that exceeded target completion date

  // User satisfaction (from periodic surveys)
  satisfactionScore: Number,       // Average score 1–5
  surveyResponses: Number,         // How many responses contributed to the score

  // System health
  apiErrorCount: Number,           // Claude API errors
  avgApiResponseMs: Number         // Average Claude API response time in ms
}, {
  timestamps: true
});

module.exports = mongoose.model('Analytics', analyticsSchema);
