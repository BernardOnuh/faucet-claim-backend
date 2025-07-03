const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/warpcast_tasks', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

// Import routes
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');
const participantRoutes = require('./routes/participants');
const contractRoutes = require('./routes/contract');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/participants', participantRoutes);
app.use('/api/contract', contractRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Test sponsored gas endpoint
app.post('/api/test-sponsored-gas', async (req, res) => {
  try {
    const { userAddress } = req.body;
    
    if (!userAddress) {
      return res.status(400).json({ error: 'User address required' });
    }

    const sponsoredGasService = require('./services/sponsoredGasService');
    
    // Test with dummy claim data
    const testGasEstimate = await sponsoredGasService.estimateGasForClaim(
      process.env.CONTRACT_ADDRESS,
      1, // dummy task ID
      '1000000000000000', // 0.001 ETH
      '0x1234', // dummy signature
      userAddress
    );
    
    res.json({
      success: true,
      sponsoredGasEnabled: process.env.ENABLE_SPONSORED_GAS === 'true',
      gasEstimate: testGasEstimate,
      paymaster: process.env.PAYMASTER_URL,
      message: testGasEstimate.sponsored ? 
        '🎉 Sponsored gas is working! Users won\'t need ETH for gas.' :
        '⚠️ Sponsored gas not available, users will need ETH for gas.'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      sponsoredGasEnabled: false
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});