// routes/participants.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const User = require('../models/User');
const Participant = require('../models/Participant');
const auth = require('../middleware/auth');
const snapchainService = require('../services/snapchainService');
const contractService = require('../services/contractService');

const router = express.Router();

// Join task
router.post('/join/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (task.status !== 'ACTIVE') {
      return res.status(400).json({ error: 'Task is not active' });
    }

    if (task.currentParticipants >= task.maxParticipants) {
      return res.status(400).json({ error: 'Task is full' });
    }

    if (new Date() > task.expiresAt) {
      return res.status(400).json({ error: 'Task has expired' });
    }

    // Check if user already joined
    const existingParticipant = await Participant.findOne({
      user: req.user.userId,
      task: req.params.taskId
    });

    if (existingParticipant) {
      return res.status(400).json({ error: 'Already joined this task' });
    }

    // Check requirements
    const user = await User.findById(req.user.userId);
    
    if (task.requirements.mustBeVerified && !user.isVerified) {
      return res.status(400).json({ error: 'Must be verified to join this task' });
    }

    // Check minimum followers requirement using Snapchain API
    if (task.requirements.minimumFollowers > 0) {
      const farcasterUser = await snapchainService.getUserByFid(user.fid);
      if (!farcasterUser || farcasterUser.follower_count < task.requirements.minimumFollowers) {
        return res.status(400).json({ 
          error: `Must have at least ${task.requirements.minimumFollowers} followers` 
        });
      }
    }

    // Create participant
    const participant = new Participant({
      user: req.user.userId,
      task: req.params.taskId,
      status: 'PENDING'
    });

    await participant.save();

    // Update task
    task.currentParticipants += 1;
    await task.save();

    res.status(201).json({
      message: 'Successfully joined task',
      participant: await Participant.findById(participant._id).populate('user', 'warpcastUsername walletAddress fid')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit proof for task completion
router.post('/submit-proof/:taskId', auth, [
  body('proofData').notEmpty().withMessage('Proof data is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const participant = await Participant.findOne({
      user: req.user.userId,
      task: req.params.taskId
    }).populate('task');

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (participant.status !== 'PENDING') {
      return res.status(400).json({ error: 'Cannot submit proof for this participant status' });
    }

    const { proofData } = req.body;

    // Update participant with proof
    participant.proofSubmitted = true;
    participant.proofData = proofData;
    
    await participant.save();

    // Auto-verify based on task type
    const verificationResult = await autoVerifyTask(participant);
    
    if (verificationResult.verified) {
      participant.status = 'VERIFIED';
      participant.verificationNotes = 'Auto-verified via Snapchain API';
      await participant.save();
    }

    res.json({
      message: 'Proof submitted successfully',
      participant,
      autoVerified: verificationResult.verified
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auto-verification function using Snapchain API
async function autoVerifyTask(participant) {
  try {
    const task = participant.task;
    const user = await User.findById(participant.user);
    
    let verified = false;
    
    switch (task.taskType) {
      case 'FOLLOW_USER':
        if (task.targetData.userToFollow) {
          verified = await snapchainService.verifyUserFollowsUser(
            user.fid,
            task.targetData.userToFollow
          );
        }
        break;
        
      case 'LIKE_CAST':
        if (task.targetData.castHashToLike) {
          verified = await snapchainService.verifyCastLike(
            user.fid,
            task.targetData.castHashToLike
          );
        }
        break;
        
      case 'RECAST_CAST':
        if (task.targetData.castHashToRecast) {
          verified = await snapchainService.verifyCastRecast(
            user.fid,
            task.targetData.castHashToRecast
          );
        }
        break;
        
      case 'JOIN_CHANNEL':
        if (task.targetData.channelToJoin) {
          verified = await snapchainService.verifyChannelMembership(
            user.fid,
            task.targetData.channelToJoin
          );
        }
        break;
        
      default:
        verified = false;
    }
    
    return { verified };
  } catch (error) {
    console.error('Auto-verification error:', error);
    return { verified: false };
  }
}

// Request reward claim with sponsored gas support
router.post('/claim/:taskId', auth, async (req, res) => {
  try {
    const participant = await Participant.findOne({
      user: req.user.userId,
      task: req.params.taskId
    }).populate('task');

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    if (participant.status !== 'VERIFIED') {
      return res.status(400).json({ error: 'Task not verified yet' });
    }

    if (participant.claimedAt) {
      return res.status(400).json({ error: 'Reward already claimed' });
    }

    const task = participant.task;
    const user = await User.findById(participant.user);

    // Check if user already claimed on blockchain
    const hasClaimed = await contractService.hasUserClaimed(
      task.contractTaskId, 
      user.walletAddress
    );

    if (hasClaimed) {
      return res.status(400).json({ error: 'Reward already claimed on blockchain' });
    }

    // Generate claim signature
    const signature = await contractService.generateClaimSignature(
      task.contractTaskId,
      user.walletAddress,
      task.rewardPerParticipant
    );

    // Try to prepare sponsored transaction
    const sponsoredGasService = require('../services/sponsoredGasService');
    const sponsoredData = await sponsoredGasService.prepareSponsoredClaim(
      process.env.CONTRACT_ADDRESS,
      task.contractTaskId,
      task.rewardPerParticipant,
      signature,
      user.walletAddress
    );

    // Update participant
    participant.claimSignature = signature;
    participant.rewardAmount = task.rewardPerParticipant;
    await participant.save();

    const response = {
      message: 'Claim signature generated',
      signature,
      taskId: task.contractTaskId,
      rewardAmount: task.rewardPerParticipant,
      contractAddress: process.env.CONTRACT_ADDRESS,
      network: {
        name: 'Base Sepolia',
        chainId: 84532,
        rpcUrl: 'https://sepolia.base.org',
        blockExplorer: 'https://sepolia.basescan.org'
      }
    };

    // Add sponsored gas data if available
    if (sponsoredData.sponsored) {
      response.sponsoredGas = {
        enabled: true,
        userOperation: sponsoredData.userOperation,
        entryPoint: sponsoredData.entryPoint,
        message: '🎉 Gas fees sponsored! No ETH needed for this transaction.'
      };
    } else {
      response.sponsoredGas = {
        enabled: false,
        message: sponsoredData.message || 'Regular gas payment required',
        fallback: 'You will need ETH for gas fees'
      };
    }

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirm claim (called after user claims on blockchain)
router.post('/confirm-claim/:taskId', auth, [
  body('transactionHash').notEmpty().withMessage('Transaction hash is required')
], async (req, res) => {
  try {
    const { transactionHash } = req.body;
    
    const participant = await Participant.findOne({
      user: req.user.userId,
      task: req.params.taskId
    });

    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const user = await User.findById(req.user.userId);

    // Update participant status
    participant.status = 'CLAIMED';
    participant.claimedAt = new Date();
    participant.transactionHash = transactionHash;
    await participant.save();

    // Update user stats
    await User.findByIdAndUpdate(req.user.userId, {
      $inc: { 
        totalTasksCompleted: 1,
        reputation: 10 
      },
      $set: {
        totalRewardsEarned: (BigInt(user.totalRewardsEarned || '0') + BigInt(participant.rewardAmount)).toString()
      }
    });

    res.json({
      message: 'Claim confirmed successfully',
      participant
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's participations
router.get('/my-tasks', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const query = { user: req.user.userId };
    
    if (status) query.status = status;

    const participants = await Participant.find(query)
      .populate('task', 'title description taskType rewardPerParticipant status expiresAt')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Participant.countDocuments(query);

    res.json({
      participants,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task participants (for task creators)
router.get('/task/:taskId', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.taskId);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user is the creator
    if (task.creator.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const participants = await Participant.find({ task: req.params.taskId })
      .populate('user', 'warpcastUsername walletAddress profileImage reputation fid')
      .sort({ createdAt: -1 });

    res.json(participants);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify participant (manual verification for task creators)
router.post('/verify/:participantId', auth, [
  body('approved').isBoolean().withMessage('Approved status is required'),
  body('notes').optional().isString()
], async (req, res) => {
  try {
    const { approved, notes } = req.body;
    
    const participant = await Participant.findById(req.params.participantId).populate('task');
    
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const task = participant.task;

    // Check if user is the task creator
    if (task.creator.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (participant.status !== 'PENDING') {
      return res.status(400).json({ error: 'Participant not in pending status' });
    }

    // Update participant status
    participant.status = approved ? 'VERIFIED' : 'REJECTED';
    participant.verificationNotes = notes || '';
    
    await participant.save();

    res.json({
      message: `Participant ${approved ? 'approved' : 'rejected'} successfully`,
      participant
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Re-verify participant using Snapchain API
router.post('/re-verify/:participantId', auth, async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.participantId)
      .populate('task')
      .populate('user');
    
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const task = participant.task;

    // Check if user is the task creator
    if (task.creator.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Re-verify using Snapchain API
    const verificationResult = await autoVerifyTask(participant);
    
    if (verificationResult.verified) {
      participant.status = 'VERIFIED';
      participant.verificationNotes = 'Re-verified via Snapchain API';
      await participant.save();
    }

    res.json({
      message: 'Re-verification completed',
      verified: verificationResult.verified,
      participant
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

