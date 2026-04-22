const User = require('../models/User');
const PoolConfig = require('../models/PoolConfig');
const License = require('../models/License');
const Notification = require('../models/Notification');
const provisioningService = require('../services/provisioningService');
const emailService = require('../services/emailService');
const sharepointService = require('../services/sharepointService');
const teamsNotificationService = require('../services/teamsNotificationService');
const activityFeedService = require('../services/activityFeedService');

const run = async (request) => {
  const { requester, details } = request;
  const poolKey = details?.poolKey || process.env.DEFAULT_LICENSE_POOL_KEY || 'claude-default';
  const aiAdmin = await User.findOne({ role: 'ai_coe_lead', isActive: true });
  let seatReserved = false;

  try {
    const reservedPool = await PoolConfig.findOneAndUpdate(
      {
        poolKey,
        isActive: true,
        $expr: { $lt: ['$assignedSeats', '$totalSeats'] }
      },
      { $inc: { assignedSeats: 1 } },
      { new: true }
    );
    if (!reservedPool) {
      request.status = 'provisioning_failed';
      request.auditLog.push({
        action: 'seat_reserve_failed',
        details: { poolKey, reason: 'No seats available or pool not configured' }
      });
      throw new Error(`No available seats in pool ${poolKey}`);
    }
    seatReserved = true;
    request.auditLog.push({
      action: 'seat_reserved',
      details: { poolKey, assignedSeats: reservedPool.assignedSeats, totalSeats: reservedPool.totalSeats }
    });

    const { invitationId, createdAt } = await provisioningService.createInvitation({
      requestRef: request.referenceId,
      email: requester.email,
      role: 'member',
      metadata: {
        employeeId: details.employeeId,
        licenseType: details.licenseType,
        accessTier: details.accessTier,
        requestReferenceId: request.referenceId
      }
    });
    request.auditLog.push({
      action: 'anthropic_invitation_created',
      details: { invitationId, poolKey }
    });

    const license = await License.create({
      request: request._id,
      user: requester._id,
      poolKey,
      anthropicInvitationId: invitationId,
      status: 'active',
      provisionedAt: createdAt || new Date()
    });
    request.auditLog.push({
      action: 'license_created',
      details: { licenseRef: license.licenseRef, invitationId, poolKey }
    });

    await User.findByIdAndUpdate(requester._id, {
      dateProvisioned: createdAt || new Date(),
      licenseType: details.licenseType,
      accessTier: details.accessTier,
      aupAcknowledged: true,
      aupAcknowledgedAt: new Date()
    });

    await sharepointService.syncProvisionedUser({
      employeeId: details.employeeId,
      name: requester.name,
      email: requester.email,
      licenseType: details.licenseType,
      accessTier: details.accessTier,
      costCenter: details.costCenter,
      businessJustification: details.businessJustification,
      clientProject: details.clientProject,
      dateProvisioned: createdAt || new Date()
    }).catch((err) => console.error('[wf1] SharePoint sync failed:', err.message));

    await Promise.allSettled([
      emailService.aupAcknowledgement({
        name: requester.name,
        email: requester.email,
        licenseType: details.licenseType,
        accessTier: details.accessTier
      }),
      teamsNotificationService.send({
        recipient: requester,
        type: 'request_deployed',
        request,
        title: `Access Active: ${request.referenceId}`,
        message: `Your access is active. License ${license.licenseRef} was provisioned from pool ${poolKey}.`
      }),
      activityFeedService.send({
        recipient: requester,
        request,
        title: `Access Active: ${request.referenceId}`,
        message: `License ${license.licenseRef} provisioned successfully from pool ${poolKey}.`
      }),
      Notification.create({
        recipient: requester._id,
        request: request._id,
        type: 'request_deployed',
        title: `Access Active: ${request.referenceId}`,
        message: `Provisioning complete. License ${license.licenseRef} is active.`,
        channels: {
          inApp: { sent: true, sentAt: new Date() },
          email: { sent: true, sentAt: new Date() },
          teams: { sent: true, sentAt: new Date() },
          activityFeed: { sent: true, sentAt: new Date() }
        }
      })
    ]);

    request.auditLog.push({
      action: 'account_provisioned',
      details: { invitationId, licenseRef: license.licenseRef, poolKey, licenseType: details.licenseType, accessTier: details.accessTier }
    });
    await request.save();
  } catch (err) {
    if (seatReserved) {
      await PoolConfig.findOneAndUpdate({ poolKey }, { $inc: { assignedSeats: -1 } }).catch(() => {});
      request.auditLog.push({
        action: 'seat_reservation_rollback',
        details: { poolKey, reason: err.message }
      });
    }
    request.status = 'provisioning_failed';
    request.auditLog.push({ action: 'provisioning_failed', details: { error: err.message, poolKey } });
    await request.save().catch(() => {});
    if (aiAdmin) {
      await Promise.allSettled([
        emailService.sendNotificationByType({
          recipient: aiAdmin,
          request,
          type: 'system_alert',
          message: `Provisioning failed for ${request.referenceId} (${poolKey}): ${err.message}. Use admin retry ${request.referenceId}.`
        }),
        teamsNotificationService.send({
          recipient: aiAdmin,
          type: 'system_alert',
          request,
          title: `Provisioning Failed: ${request.referenceId}`,
          message: `Pool ${poolKey}. Error: ${err.message}. Run admin retry ${request.referenceId}.`
        }),
        activityFeedService.send({
          recipient: aiAdmin,
          request,
          title: `Provisioning Failed: ${request.referenceId}`,
          message: `Pool ${poolKey}. Error: ${err.message}.`
        }),
        Notification.create({
          recipient: aiAdmin._id,
          request: request._id,
          type: 'system_alert',
          title: `Provisioning Failed: ${request.referenceId}`,
          message: `Provisioning failed for pool ${poolKey}. ${err.message}.`,
          channels: {
            inApp: { sent: true, sentAt: new Date() },
            email: { sent: true, sentAt: new Date() },
            teams: { sent: true, sentAt: new Date() },
            activityFeed: { sent: true, sentAt: new Date() }
          }
        })
      ]);
    }
    throw err;
  }
};

module.exports = { run };
