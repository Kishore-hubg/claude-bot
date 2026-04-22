const mongoose = require('mongoose');

const licenseSchema = new mongoose.Schema({
  licenseRef: {
    type: String,
    unique: true
  },
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  poolKey: {
    type: String,
    required: true,
    trim: true
  },
  anthropicInvitationId: {
    type: String
  },
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active'
  },
  provisionedAt: {
    type: Date,
    default: Date.now
  },
  revokedAt: Date
}, {
  timestamps: true
});

licenseSchema.pre('save', async function setReference(next) {
  if (this.isNew && !this.licenseRef) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('License').countDocuments();
    this.licenseRef = `LIC-${year}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

licenseSchema.index({ user: 1, status: 1 });
licenseSchema.index({ request: 1 });
licenseSchema.index({ poolKey: 1, status: 1 });

module.exports = mongoose.model('License', licenseSchema);
