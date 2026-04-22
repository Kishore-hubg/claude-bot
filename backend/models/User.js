const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/**
 * User Model
 * Represents organizational users who interact with the Claude Assistant Bot.
 * Roles determine what actions a user can perform (requester, manager, admin, etc.)
 */
const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Never return password in queries
  },
  role: {
    type: String,
    enum: ['requester', 'manager', 'tech_lead', 'architect', 'admin',
           'support', 'cto', 'ai_coe_lead', 'it_governance'],
    default: 'requester'
  },
  department: {
    type: String,
    trim: true
  },
  teamsUserId: {
    type: String, // Microsoft Teams user ID for bot integration
    unique: true,
    sparse: true
  },
  avatar: String,
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: Date,
  notificationPreferences: {
    email: { type: Boolean, default: true },
    teams: { type: Boolean, default: true }
  },

  // BRD §4.1 — required inventory fields
  employeeId:          { type: String, unique: true, sparse: true, index: true },
  licenseType:         { type: String, enum: ['standard', 'premium'], default: null },
  accessTier:          { type: String, enum: ['T1', 'T2', 'T3'], default: null },
  costCenter:          { type: String, trim: true },
  managerId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  managerEmail:        { type: String, lowercase: true },
  aupAcknowledged:     { type: Boolean, default: false },
  aupAcknowledgedAt:   Date,
  dateProvisioned:     Date,
  lastActiveDate:      Date,
  idleWarningSentAt:   Date,
  teamsConversationId: String,
  teamsConversationRef: mongoose.Schema.Types.Mixed
}, {
  timestamps: true // Auto-adds createdAt and updatedAt
});

// Hash password before saving to DB
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare plain password with hashed password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
