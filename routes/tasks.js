// routes/tasks.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const User = require('../models/User');
const auth = require('../middleware/auth');
const contractService = require('../services/contractService');
const snapchainService = require('../services/snapchainService');

const router = express.Router();

// Create task
router.post('/', auth, [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('taskType').isIn(['FOLLOW_USER', 'LIKE_CAST', 'RECAST_CAST', 'JOIN_CHANNEL']).withMessage('Invalid task type'),
  body('maxParticipants').isInt({ min: 1, max: 1000 }).withMessage('Max participants must be between 1 and 1000'),
  body('expiresAt').isISO8601().withMessage('Valid expiration date is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      title, 
      description, 
      taskType, 
      targetData, 
      maxParticipants, 
      expiresAt,
      tags,
      requirements 
    } = req.body;

    // Validate target data based on task type
    let validationError = null;
    switch (taskType) {
      case 'FOLLOW_USER':
        if (!targetData.userToFollow) {
          validationError = 'User to follow is required';
        } else {
          // Verify user exists
          const targetUser = await snapchainService.getUserByUsername(targetData.userToFollow);
          if (!targetUser) {
            validationError = 'Target user not found on Farcaster';
          }
        }
        break;
      case 'LIKE_CAST':
        if (!targetData.castHashToLike) {
          validationError = 'Cast hash to like is required';
        } else {
          // Verify cast exists
          const cast = await snapchainService.getCast(targetData.castHashToLike);
          if (!cast) {
            validationError = 'Cast not found';
          }
        }
        break;
      case 'RECAST_CAST':
        if (!targetData.castHashToRecast) {
          validationError = 'Cast hash to recast is required';
        } else {
          // Verify cast exists
          const cast = await snapchainService.getCast(targetData.castHashToRecast);
          if (!cast) {
            validationError = 'Cast not found';
          }
        }
        break;
      case 'JOIN_CHANNEL':
        if (!targetData.channelToJoin) {
          validationError = 'Channel to join is required';
        }
        break;
    }

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Calculate total funding (0.001 ETH per participant)
    const rewardPerParticipant = '1000000000000000'; // 0.001 ETH in wei
    const totalFunding = (BigInt(rewardPerParticipant) * BigInt(maxParticipants)).toString();
    const totalFundingEth = parseFloat(totalFunding) / 1e18;

    console.log(`💰 Task funding: ${totalFundingEth} ETH for ${maxParticipants} participants on Base Sepolia`);

    // Create task in database
    const task = new Task({
      creator: req.user.userId,
      title,
      description,
      taskType,
      targetData,
      rewardPerParticipant,
      maxParticipants,
      totalFunding,
      expiresAt: new Date(expiresAt),
      tags: tags || [],
      requirements: requirements || {}
    });

    await task.save();

    // Create task on smart contract
    try {
      const contractResult = await contractService.createTaskOnChain(
        maxParticipants,
        totalFundingEth
      );

      task.contractTaskId = parseInt(contractResult.taskId);
      task.transactionHash = contractResult.transactionHash;
      task.status = 'ACTIVE';
      await task.save();

      // Update user stats
      await User.findByIdAndUpdate(req.user.userId, {
        $inc: { totalTasksCreated: 1 }
      });

      res.status(201).json({
        message: 'Task created successfully on Base Sepolia',
        task: await Task.findById(task._id).populate('creator', 'warpcastUsername walletAddress fid'),
        blockchain: {
          network: 'Base Sepolia',
          chainId: 84532,
          transactionHash: contractResult.transactionHash,
          explorerUrl: contractResult.explorerUrl,
          gasUsed: contractResult.gasUsed
        }
      });
    } catch (contractError) {
      console.error('Contract error:', contractError);
      // Delete task from database if contract creation fails
      await Task.findByIdAndDelete(task._id);
      res.status(500).json({ error: 'Failed to create task on blockchain' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tasks
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, status, taskType, creator } = req.query;
    const query = {};
    
    if (status) query.status = status;
    if (taskType) query.taskType = taskType;
    if (creator) query.creator = creator;

    const tasks = await Task.find(query)
      .populate('creator', 'warpcastUsername walletAddress profileImage fid')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Task.countDocuments(query);

    res.json({
      tasks,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task by ID
router.get('/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .populate('creator', 'warpcastUsername walletAddress profileImage fid')
      .populate('participants.user', 'warpcastUsername walletAddress profileImage fid');

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update task
router.put('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user is the creator
    if (task.creator.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Only allow updates if task is in DRAFT status
    if (task.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Cannot update active task' });
    }

    const { title, description, expiresAt, tags, requirements } = req.body;

    if (title) task.title = title;
    if (description) task.description = description;
    if (expiresAt) task.expiresAt = new Date(expiresAt);
    if (tags) task.tags = tags;
    if (requirements) task.requirements = requirements;

    await task.save();

    res.json(await Task.findById(task._id).populate('creator', 'warpcastUsername walletAddress fid'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel task
router.delete('/:id', auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user is the creator
    if (task.creator.toString() !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Only allow cancellation if no participants have claimed
    if (task.participants.some(p => p.status === 'CLAIMED')) {
      return res.status(400).json({ error: 'Cannot cancel task with claimed rewards' });
    }

    task.status = 'CANCELLED';
    await task.save();

    res.json({ message: 'Task cancelled successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate task target (utility endpoint)
router.post('/validate-target', [
  body('taskType').isIn(['FOLLOW_USER', 'LIKE_CAST', 'RECAST_CAST', 'JOIN_CHANNEL']).withMessage('Invalid task type'),
  body('targetData').isObject().withMessage('Target data is required')
], async (req, res) => {
  try {
    const { taskType, targetData } = req.body;
    let result = { valid: false, data: null };

    switch (taskType) {
      case 'FOLLOW_USER':
        if (targetData.userToFollow) {
          const user = await snapchainService.getUserByUsername(targetData.userToFollow);
          if (user) {
            result = {
              valid: true,
              data: {
                fid: user.fid,
                displayName: user.display_name,
                pfpUrl: user.pfp_url,
                followerCount: user.follower_count
              }
            };
          }
        }
        break;
      case 'LIKE_CAST':
      case 'RECAST_CAST':
        const castHash = targetData.castHashToLike || targetData.castHashToRecast;
        if (castHash) {
          const cast = await snapchainService.getCast(castHash);
          if (cast) {
            result = {
              valid: true,
              data: {
                hash: cast.hash,
                text: cast.text,
                author: cast.author,
                timestamp: cast.timestamp
              }
            };
          }
        }
        break;
      case 'JOIN_CHANNEL':
        // For now, just validate that channel ID is provided
        // You could add channel validation here if Snapchain API supports it
        if (targetData.channelToJoin) {
          result = { valid: true, data: { channelId: targetData.channelToJoin } };
        }
        break;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;