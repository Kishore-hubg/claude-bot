const mongoose = require('mongoose');

const poolConfigSchema = new mongoose.Schema({
  poolKey: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  totalSeats: {
    type: Number,
    required: true,
    min: 0
  },
  assignedSeats: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

poolConfigSchema.virtual('availableSeats').get(function getAvailableSeats() {
  return Math.max(0, (this.totalSeats || 0) - (this.assignedSeats || 0));
});

module.exports = mongoose.model('PoolConfig', poolConfigSchema);
