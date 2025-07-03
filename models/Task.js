const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  taskType: {
    type: String,
    enum: ['FOLLOW_USER', 'LIKE_CAST', 'RECAST_CAST', 'JOIN_CHANNEL'],
    required: true
  },
  targetData: {
    userToFollow: String,      // Farcaster username to follow
    castHashToLike: String,    // Cast hash to like
    castHashToRecast: String,  // Cast hash to recast
    channelToJoin: String      // Channel ID to join
  },
  rewardPerParticipant: {
    type: String, // Store as string to handle BigInt (in wei)
    required: true,
    default: '1000000000000000' // 0.001 ETH in wei
  },
  maxParticipants: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  currentParticipants: {
    type: Number,
    default: 0
  },
  totalFunding: {
    type: String, // Store as string to handle BigInt
    required: true
  },
  contractTaskId: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'],
    default: 'DRAFT'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  tags: [{
    type: String,
    trim: true
  }],
  requirements: {
    minimumFollowers: {
      type: Number,
      default: 0
    },
    mustBeVerified: {
      type: Boolean,
      default: false
    }
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'CLAIMED', 'REJECTED'],
      default: 'PENDING'
    },
    verificationData: {
      proofUrl: String,
      verifiedAt: Date
    }
  }],
  transactionHash: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Task', taskSchema);