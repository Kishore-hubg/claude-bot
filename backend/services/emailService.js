const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

/**
 * Email Service — Nodemailer + configurable SMTP providers
 * All templates use inline styles for Outlook compatibility.
 */
const getSmtpConfig = () => {
  const provider = (process.env.EMAIL_PROVIDER || 'office365').toLowerCase();
  if (provider === 'gmail') {
    return {
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    };
  }

  return {
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    }
  };
};

const transport = nodemailer.createTransport(getSmtpConfig());
const fromAddress = () => `"Claude Assistant Bot" <${process.env.EMAIL_USER || 'claude-admin@infovision.com'}>`;
const baseStyle = 'font-family:Arial,sans-serif;max-width:600px;margin:0 auto;';
const btnStyle = 'display:inline-block;padding:10px 20px;border-radius:5px;text-decoration:none;font-weight:bold;margin:5px;';

const wrap = (content) => `
<div style="${baseStyle}">
  <div style="background:#1e3a5f;padding:16px 24px;border-radius:8px 8px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Claude Assistant Bot - InfoVision</h2>
  </div>
  <div style="background:#f9fafb;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;">
    ${content}
  </div>
</div>`;

const templates = {
  approvalRequest: ({ requesterName, requestType, referenceId, title, justification, priority, approveUrl, rejectUrl }) => ({
    subject: `Action Required: Approve ${requestType} Request - ${referenceId}`,
    html: wrap(`
      <h3 style="color:#111;margin-top:0;">Approval Required</h3>
      <p><strong>${requesterName}</strong> submitted a <strong>${requestType}</strong> request.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px;color:#6b7280;width:140px;">Reference</td><td style="padding:6px;font-family:monospace;">${referenceId}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Title</td><td style="padding:6px;">${title}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Priority</td><td style="padding:6px;text-transform:capitalize;">${priority}</td></tr>
        <tr><td style="padding:6px;color:#6b7280;">Justification</td><td style="padding:6px;">${justification || 'See request details'}</td></tr>
      </table>
      <div style="text-align:center;margin:24px 0;">
        <a href="${approveUrl}" style="${btnStyle}background:#16a34a;color:#fff;">Approve</a>
        <a href="${rejectUrl}" style="${btnStyle}background:#dc2626;color:#fff;">Reject</a>
      </div>
      <p style="color:#6b7280;font-size:12px;">These links expire in 7 days and are single-use.</p>`)
  }),
  aupAcknowledgement: ({ name, licenseType, accessTier }) => ({
    subject: 'Your Claude AI Access Has Been Provisioned',
    html: wrap(`<p>Hi <strong>${name}</strong>, your access is active with <strong>${licenseType}</strong> / <strong>${accessTier}</strong>.</p>`)
  }),
  requestApproved: ({ name, referenceId, requestType }) => ({
    subject: `Request Approved: ${referenceId}`,
    html: wrap(`<p>Hi <strong>${name}</strong>, your <strong>${requestType}</strong> request (<code>${referenceId}</code>) is approved.</p>`)
  }),
  requestRejected: ({ name, referenceId, requestType }, reason) => ({
    subject: `Request Rejected: ${referenceId}`,
    html: wrap(`<p>Hi <strong>${name}</strong>, your <strong>${requestType}</strong> request (<code>${referenceId}</code>) was rejected.</p><p>Reason: ${reason || 'No reason provided.'}</p>`)
  }),
  idleWarning: ({ name, lastActiveDate, autoDeprovisionDate }) => ({
    subject: 'Action Required: Claude AI License Will Be Revoked in 8 Days',
    html: wrap(`<p>Hi <strong>${name}</strong>, last activity: <strong>${new Date(lastActiveDate).toDateString()}</strong>. Auto revocation date: <strong>${new Date(autoDeprovisionDate).toDateString()}</strong>.</p>`)
  }),
  offboardingConfirm: ({ name, email }) => ({
    subject: `Claude Access Revoked: ${name} (${email})`,
    html: wrap(`<p>All Claude access for <strong>${name}</strong> (<code>${email}</code>) has been revoked.</p>`)
  }),
  costAnomaly: ({ totalUSD, avgUSD, spikePercent, period }) => ({
    subject: `Cost Spike Detected: ${spikePercent}% above average`,
    html: wrap(`<p>Period: ${period} | Today's Spend: $${totalUSD.toFixed(2)} | 30-day avg: $${avgUSD.toFixed(2)}</p>`)
  }),
  complianceReport: ({ activeUsers, approvedUsers, flaggedUsers, scanDate }) => ({
    subject: `Weekly Compliance Scan - ${flaggedUsers} Issues`,
    html: wrap(`<p>Scan: ${new Date(scanDate).toDateString()} | Active: ${activeUsers} | Approved: ${approvedUsers} | Flagged: ${flaggedUsers}</p>`)
  }),
  quarterlyOptimization: ({ recommendations, approveUrl, rejectUrl, quarter }) => ({
    subject: `Q${quarter} Claude License Optimization`,
    html: wrap(`
      <p>${recommendations.length} recommendation(s) generated for Q${quarter}.</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${approveUrl}" style="${btnStyle}background:#16a34a;color:#fff;">Apply All Changes</a>
        <a href="${rejectUrl}" style="${btnStyle}background:#6b7280;color:#fff;">Skip This Quarter</a>
      </div>`)
  }),
  requestSubmitted: ({ name, referenceId, requestType, title }) => ({
    subject: `Submitted: ${referenceId} — ${requestType}`,
    html: wrap(`<p>Hi <strong>${name}</strong>,</p><p>Your <strong>${requestType}</strong> request <code>${referenceId}</code> was received and is pending approval.</p><p><strong>${title}</strong></p>`)
  }),
  approvalProgress: ({ name, referenceId, requestType }) => ({
    subject: `Update: ${referenceId} — pending next approver`,
    html: wrap(`<p>Hi <strong>${name}</strong>,</p><p>Your <strong>${requestType}</strong> request <code>${referenceId}</code> moved forward: a previous approver approved it; it is now waiting for the next reviewer.</p>`)
  }),
  requestDeployed: ({ name, referenceId, requestType }) => ({
    subject: `Access Active: ${referenceId}`,
    html: wrap(`<p>Hi <strong>${name}</strong>,</p><p>Your <strong>${requestType}</strong> request <code>${referenceId}</code> has been provisioned successfully and is now active.</p>`)
  }),
  systemAlert: ({ name, referenceId, message }) => ({
    subject: `System Alert${referenceId ? `: ${referenceId}` : ''}`,
    html: wrap(`<p>Hi <strong>${name}</strong>,</p><p>${message}</p>`)
  })
};

const send = async (to, template) => {
  if (!process.env.EMAIL_USER) return;
  await transport.sendMail({ from: fromAddress(), to, ...template });
};

const sendNotificationByType = async ({ recipient, request, type, message }) => {
  if (!recipient?.email || !request) return false;

  if (type === 'approval_required') {
    const actionBase = process.env.BACKEND_URL || 'http://localhost:5000';
    if (!process.env.EMAIL_ACTION_SECRET) return false;
    const approverId = request.approvalSteps?.[request.currentApprovalStep]?.approver?.toString() || recipient._id?.toString();
    if (!approverId) return false;
    const approveToken = jwt.sign(
      { requestId: request._id.toString(), approverId, decision: 'approved' },
      process.env.EMAIL_ACTION_SECRET,
      { expiresIn: '7d' }
    );
    const rejectToken = jwt.sign(
      { requestId: request._id.toString(), approverId, decision: 'rejected' },
      process.env.EMAIL_ACTION_SECRET,
      { expiresIn: '7d' }
    );
    await module.exports.approvalRequest(
      recipient,
      request,
      `${actionBase}/api/requests/${request._id}/email-action?token=${approveToken}&decision=approved`,
      `${actionBase}/api/requests/${request._id}/email-action?token=${rejectToken}&decision=rejected`
    );
    return true;
  }

  if (type === 'request_approved') {
    await module.exports.requestApproved(recipient, request);
    return true;
  }

  if (type === 'request_rejected') {
    await module.exports.requestRejected(recipient, request, message);
    return true;
  }

  if (type === 'request_submitted') {
    await send(recipient.email, templates.requestSubmitted({
      name: recipient.name,
      referenceId: request.referenceId,
      requestType: request.type,
      title: request.title
    }));
    return true;
  }

  if (type === 'approval_progress') {
    await send(recipient.email, templates.approvalProgress({
      name: recipient.name,
      referenceId: request.referenceId,
      requestType: request.type
    }));
    return true;
  }

  if (type === 'request_deployed') {
    await send(recipient.email, templates.requestDeployed({
      name: recipient.name,
      referenceId: request.referenceId,
      requestType: request.type
    }));
    return true;
  }

  if (type === 'system_alert') {
    await send(recipient.email, templates.systemAlert({
      name: recipient.name,
      referenceId: request?.referenceId,
      message: message || 'A provisioning error needs your review.'
    }));
    return true;
  }

  return false;
};

module.exports = {
  approvalRequest: (manager, request, approveUrl, rejectUrl) =>
    send(manager.email, templates.approvalRequest({
      requesterName: request.requester?.name || 'Requester',
      requestType: request.type,
      referenceId: request.referenceId,
      title: request.title,
      justification: request.details?.businessJustification,
      priority: request.priority,
      approveUrl,
      rejectUrl
    })),
  aupAcknowledgement: (user) =>
    send(user.email, templates.aupAcknowledgement({
      name: user.name,
      licenseType: user.licenseType || 'standard',
      accessTier: user.accessTier || 'T2'
    })),
  requestApproved: (user, request) =>
    send(user.email, templates.requestApproved({ name: user.name, referenceId: request.referenceId, requestType: request.type })),
  requestRejected: (user, request, reason) =>
    send(user.email, templates.requestRejected({ name: user.name, referenceId: request.referenceId, requestType: request.type }, reason)),
  idleWarning: (user) =>
    send(user.email, templates.idleWarning({
      name: user.name,
      lastActiveDate: user.lastActiveDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      autoDeprovisionDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
    })),
  offboardingConfirm: (user, toEmail) =>
    send(toEmail || user.email, templates.offboardingConfirm({ name: user.name, email: user.email })),
  costAnomaly: (data) =>
    send(process.env.EMAIL_USER, templates.costAnomaly(data)),
  complianceReport: (data) =>
    send(process.env.COE_LEAD_EMAIL || process.env.EMAIL_USER, templates.complianceReport(data)),
  quarterlyOptimization: (data, approveUrl, rejectUrl) =>
    send(process.env.COE_LEAD_EMAIL || process.env.EMAIL_USER, templates.quarterlyOptimization({ ...data, approveUrl, rejectUrl })),
  sendNotificationByType,
  requestSubmitted: (user, request) =>
    send(user.email, templates.requestSubmitted({
      name: user.name,
      referenceId: request.referenceId,
      requestType: request.type,
      title: request.title
    })),
  approvalProgress: (user, request) =>
    send(user.email, templates.approvalProgress({
      name: user.name,
      referenceId: request.referenceId,
      requestType: request.type
    }))
};
