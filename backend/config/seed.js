const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Request = require('../models/Request');

/**
 * Database Seed Script
 *
 * Creates demo users and sample requests so you can explore the full
 * UI immediately after setup without having to manually submit anything.
 *
 * Run: cd backend && node config/seed.js
 */

const USERS = [
  { name: 'Alice Admin', email: 'admin@infovision.com', password: 'password123', role: 'admin', department: 'IT' },
  { name: 'Mark Manager', email: 'manager@infovision.com', password: 'password123', role: 'manager', department: 'Engineering' },
  { name: 'Grace Gov', email: 'ai.coe@infovision.com', password: 'password123', role: 'ai_coe_lead', department: 'AI Governance' },
  { name: 'Tom TechLead', email: 'techlead@infovision.com', password: 'password123', role: 'tech_lead', department: 'Platform' },
  { name: 'Anna Architect', email: 'architect@infovision.com', password: 'password123', role: 'architect', department: 'Architecture' },
  { name: 'Sam Support', email: 'support@infovision.com', password: 'password123', role: 'support', department: 'Support' },
  { name: 'Carl CTO', email: 'cto@infovision.com', password: 'password123', role: 'cto', department: 'Leadership' },
  { name: 'Jane User', email: 'user@infovision.com', password: 'password123', role: 'requester', department: 'Sales' },
  { name: 'Bob Builder', email: 'bob@infovision.com', password: 'password123', role: 'requester', department: 'Engineering' }
];

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/claude_assistant_bot');
  console.log('Connected to MongoDB');

  // Clear existing data
  await User.deleteMany({});
  await Request.deleteMany({});
  console.log('Cleared existing data');

  // Create users
  const users = await User.create(USERS);
  console.log(`✅ Created ${users.length} users`);

  const jane = users.find(u => u.email === 'user@infovision.com');
  const bob = users.find(u => u.email === 'bob@infovision.com');
  const manager = users.find(u => u.role === 'manager');
  const aiGov = users.find(u => u.role === 'ai_coe_lead');
  const admin = users.find(u => u.role === 'admin');
  const techLead = users.find(u => u.role === 'tech_lead');
  const cto = users.find(u => u.role === 'cto');

  await User.updateOne(
    { _id: jane._id },
    { $set: { managerId: manager._id, managerEmail: manager.email } }
  );
  await User.updateOne(
    { _id: bob._id },
    { $set: { managerId: manager._id, managerEmail: manager.email } }
  );

  // Create sample requests across all six types
  const sampleRequests = [
    {
      requester: jane._id,
      type: 'access',
      title: 'Access to Production Database',
      description: 'I need read-only access to the production PostgreSQL database to run analytics queries for the Q2 report.',
      status: 'pending_approval',
      priority: 'high',
      details: { resourceName: 'Production PostgreSQL', justification: 'Q2 analytics report', duration: '30 days', accessLevel: 'read-only' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'pending', stepOrder: 1 },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'pending', stepOrder: 2 }
      ],
      currentApprovalStep: 0,
      aiClassification: { confidence: 0.96, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: jane._id, toStatus: 'submitted' }, { action: 'workflow_initiated', performedBy: jane._id, toStatus: 'pending_approval' }]
    },
    {
      requester: bob._id,
      type: 'plugins',
      title: 'Deploy VS Code IntelliSense Plugin v2.1',
      description: 'Deploy the updated IntelliSense plugin for the entire engineering team to improve code completion quality.',
      status: 'approved',
      priority: 'medium',
      details: { pluginName: 'VS Code IntelliSense', version: '2.1.0', scope: 'engineering-team' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'approved', stepOrder: 1, comments: 'Approved. Standard upgrade.', decidedAt: new Date() },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'pending', stepOrder: 2 }
      ],
      currentApprovalStep: 1,
      aiClassification: { confidence: 0.93, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: bob._id, toStatus: 'submitted' }, { action: 'step_approved', performedBy: cto._id }]
    },
    {
      requester: jane._id,
      type: 'apis',
      title: 'Anthropic Claude API Access — Sales Analytics',
      description: 'Need API access to Claude for building a sales call summarization tool. Estimated 50,000 tokens/day.',
      status: 'deployed',
      priority: 'high',
      details: { apiName: 'Anthropic Claude API', usageLevel: '50k tokens/day', purpose: 'Sales call summarization', duration: '12 months' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'approved', stepOrder: 1, decidedAt: new Date() },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'approved', stepOrder: 2, decidedAt: new Date() }
      ],
      currentApprovalStep: 1,
      actualCompletionDate: new Date(),
      aiClassification: { confidence: 0.98, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: jane._id }, { action: 'fully_approved', performedBy: admin._id }, { action: 'deployment_completed', toStatus: 'deployed' }]
    },
    {
      requester: bob._id,
      type: 'support_qa',
      title: 'How to configure SSO for Slack?',
      description: 'Our team is trying to set up SSO integration between our Azure AD and Slack workspace. Need step-by-step guidance.',
      status: 'closed',
      priority: 'low',
      details: { issueType: 'how-to', system: 'Slack SSO', platform: 'Azure AD' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'approved', stepOrder: 1, decidedAt: new Date() },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'approved', stepOrder: 2, decidedAt: new Date() }
      ],
      currentApprovalStep: 1,
      actualCompletionDate: new Date(),
      aiClassification: { confidence: 0.89, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: bob._id }, { action: 'request_closed', toStatus: 'closed' }]
    },
    {
      requester: jane._id,
      type: 'connectors',
      title: 'Salesforce ↔ Jira Bi-directional Connector',
      description: 'Set up a connector to sync Salesforce opportunities with Jira tickets for the sales-engineering handoff workflow.',
      status: 'pending_approval',
      priority: 'medium',
      details: { integrationType: 'Salesforce-Jira sync', businessCase: 'Sales-engineering handoff', syncDirection: 'bi-directional' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'pending', stepOrder: 1 },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'pending', stepOrder: 2 }
      ],
      currentApprovalStep: 0,
      aiClassification: { confidence: 0.91, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: jane._id }, { action: 'workflow_initiated', toStatus: 'pending_approval' }]
    },
    {
      requester: bob._id,
      type: 'skills',
      title: 'Add AWS Solutions Architect Professional Certification',
      description: 'Successfully completed AWS Solutions Architect Professional exam. Please update my profile with this certification.',
      status: 'approved',
      priority: 'low',
      details: { skillName: 'AWS Solutions Architect Professional', proficiencyLevel: 'certified', certificationDate: '2026-04-01' },
      approvalSteps: [
        { approver: manager._id, approverRole: 'manager', status: 'approved', stepOrder: 1, comments: 'Congratulations! Profile updated.', decidedAt: new Date() },
        { approver: aiGov._id, approverRole: 'ai_coe_lead', status: 'approved', stepOrder: 2, decidedAt: new Date() }
      ],
      currentApprovalStep: 1,
      aiClassification: { confidence: 0.95, processedAt: new Date() },
      auditLog: [{ action: 'request_created', performedBy: bob._id }, { action: 'fully_approved', performedBy: manager._id, toStatus: 'approved' }]
    }
  ];

  await Request.create(sampleRequests);
  console.log(`✅ Created ${sampleRequests.length} sample requests`);

  console.log('\n🚀 Seed complete! You can log in with:');
  USERS.forEach(u => console.log(`   ${u.role.padEnd(10)} → ${u.email} / ${u.password}`));

  await mongoose.disconnect();
};

seed().catch(err => { console.error(err); process.exit(1); });
