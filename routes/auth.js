// routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const snapchainService = require('../services/snapchainService');

const router = express.Router();

// Register
router.post('/register', [
  body('warpcastUsername').notEmpty().withMessage('Warpcast username is required'),
  body('walletAddress').isEthereumAddress().withMessage('Valid wallet address is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { warpcastUsername, walletAddress, email, password, profileImage, bio } = req.body;

    // Get FID from Snapchain API
    const farcasterUser = await snapchainService.getUserByUsername(warpcastUsername);
    if (!farcasterUser) {
      return res.status(400).json({ error: 'Warpcast username not found' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { warpcastUsername }, { walletAddress }, { fid: farcasterUser.fid }] 
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create new user
    const user = new User({
      warpcastUsername,
      fid: farcasterUser.fid,
      walletAddress,
      email,
      password,
      profileImage: profileImage || farcasterUser.pfp_url,
      bio: bio || farcasterUser.profile?.bio?.text
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        warpcastUsername: user.warpcastUsername,
        fid: user.fid,
        walletAddress: user.walletAddress,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        warpcastUsername: user.warpcastUsername,
        fid: user.fid,
        walletAddress: user.walletAddress,
        email: user.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify Warpcast username
router.post('/verify-username', [
  body('username').notEmpty().withMessage('Username is required')
], async (req, res) => {
  try {
    const { username } = req.body;
    const user = await snapchainService.getUserByUsername(username);
    
    if (user) {
      res.json({
        valid: true,
        fid: user.fid,
        displayName: user.display_name,
        pfpUrl: user.pfp_url,
        followerCount: user.follower_count
      });
    } else {
      res.json({ valid: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;