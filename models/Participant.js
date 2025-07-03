const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'VERIFIED', 'CLAIMED', 'REJECTED'],
    default: 'PENDING'
  },
  proofSubmitted: {
    type: Boolean,
    default: false
  },
  proofData: {
    screenshotUrl: String,
    transactionHash: String,
    warpcastUrl: String,
    additionalNotes: String
  },
  verificationNotes: {
    type: String,
    default: null
  },
  rewardAmount: {
    type: String, // Store as string to handle BigInt
    default: '0'
  },
  claimSignature: {
    type: String,
    default: null
  },
  claimedAt: {
    type: Date,
    default: null
  },
  transactionHash: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Ensure one participation per user per task
participantSchema.index({ user: 1, task: 1 }, { unique: true });

module.exports = mongoose.model('Participant', participantSchema);