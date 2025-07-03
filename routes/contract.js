
// routes/contract.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const contractService = require('../services/contractService');

const router = express.Router();

// Get contract task details
router.get('/task/:taskId', async (req, res) => {
  try {
    const taskDetails = await contractService.getTaskDetails(req.params.taskId);
    res.json(taskDetails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify claim signature
router.post('/verify-signature', [
  body('taskId').isNumeric().withMessage('Valid task ID is required'),
  body('developerAddress').isEthereumAddress().withMessage('Valid developer address is required'),
  body('rewardAmount').isNumeric().withMessage('Valid reward amount is required'),
  body('signature').notEmpty().withMessage('Signature is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { taskId, developerAddress, rewardAmount, signature } = req.body;
    
    const isValid = await contractService.verifyClaimSignature(
      taskId,
      developerAddress,
      rewardAmount,
      signature
    );
    
    res.json({ isValid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check if user has claimed
router.get('/has-claimed/:taskId/:userAddress', async (req, res) => {
  try {
    const { taskId, userAddress } = req.params;
    
    const hasClaimed = await contractService.hasUserClaimed(taskId, userAddress);
    
    res.json({ hasClaimed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

// middleware/auth.js
const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token is not valid' });
  }
};

module.exports = auth;
