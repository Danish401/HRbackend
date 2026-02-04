const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // For form data

// Helper function to properly encode MongoDB connection string password
function encodeMongoPassword(uri) {
  if (!uri.includes('@') || (!uri.includes('mongodb://') && !uri.includes('mongodb+srv://'))) {
    return uri;
  }

  try {
    const atSignCount = (uri.match(/@/g) || []).length;
    
    if (atSignCount > 1) {
      const protocolMatch = uri.match(/^(mongodb\+?srv?:\/\/)/);
      if (!protocolMatch) return uri;
      
      const protocol = protocolMatch[1];
      const afterProtocol = uri.substring(protocol.length);
      const lastAtIndex = afterProtocol.lastIndexOf('@');
      
      if (lastAtIndex === -1) return uri;
      
      const credentials = afterProtocol.substring(0, lastAtIndex);
      const hostAndPath = afterProtocol.substring(lastAtIndex + 1);
      const colonIndex = credentials.indexOf(':');
      
      if (colonIndex === -1) return uri;
      
      const username = credentials.substring(0, colonIndex);
      const password = credentials.substring(colonIndex + 1);
      
      if (!password.includes('%')) {
        const encodedPassword = encodeURIComponent(password);
        return `${protocol}${username}:${encodedPassword}@${hostAndPath}`;
      }
    }
  } catch (e) {
    console.warn('⚠️  Could not parse MongoDB connection string:', e.message);
  }
  
  return uri;
}

// MongoDB Connection
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor';

// Try to fix common connection string issues
MONGODB_URI = encodeMongoPassword(MONGODB_URI);

console.log('🔄 Attempting to connect to MongoDB...');
const maskedURI = MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
console.log(`   URI: ${maskedURI}`);

const connectWithRetry = () => {
  console.log('🔄 MongoDB connection attempt...');
  
  // Shorter timeouts for production to fail fast if DB is unavailable
  const isProduction = process.env.NODE_ENV === 'production';
  const timeoutMs = isProduction ? 5000 : 10000;
  
  mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: timeoutMs,
    socketTimeoutMS: 45000,
    connectTimeoutMS: timeoutMs,
    maxPoolSize: 10,
    minPoolSize: 1,
  })
  .then(() => {
    console.log('✅ MongoDB Connected successfully');
    console.log(`   Database: ${mongoose.connection.name}`);
    console.log(`   Host: ${mongoose.connection.host}:${mongoose.connection.port}`);

    // Ensure a default admin exists after successful DB connection
    try {
      ensureDefaultAdmin().catch(err => console.error('Error ensuring default admin:', err));
    } catch (e) {
      console.error('Error invoking ensureDefaultAdmin:', e);
    }

    // Start background services ASYNCHRONOUSLY (don't block)
    console.log('🚀 Starting background services (non-blocking)...');
    
    // Start email monitoring (async, don't await)
    setImmediate(() => {
      emailService.startMonitoring(io).catch(err => {
        console.error('⚠️ Email monitoring failed to start:', err.message);
      });
    });

    // Initialize birthday checker task (lightweight)
    try {
      smsService.initBirthdayTask();
    } catch (err) {
      console.error('⚠️ Birthday task failed to start:', err.message);
    }

    
    console.log('✅ Background services initiated (running in background)');
  })
  .catch(err => {
    console.error('\n❌ MongoDB connection FAILED!');
    console.error(`   Error: ${err.message}`);
    
    if (err.message.includes('authentication failed')) {
      console.error('   🛑 AUTHENTICATION ERROR: Please check your MONGODB_URI username and password.');
    }
    
    console.log('🔄 Retrying MongoDB connection in 5 seconds...');
    setTimeout(connectWithRetry, 5000);
  });
};

connectWithRetry();

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('connecting', () => {
  console.log('🔄 Connecting to MongoDB...');
});

// Import routes and services
const emailRoutes = require('./routes/emailRoutes');
const { router: authRoutes, ensureDefaultAdmin } = require('./routes/authRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const emailService = require('./services/emailService');
const smsService = require('./services/smsService');
const { authenticate } = require('./middleware/auth');
const redisService = require('./services/redisService');

// Public routes (no authentication required)
app.use('/api/auth', authRoutes);

// Public Outlook OAuth routes
app.use('/api/outlook-auth', emailRoutes);

// Protected routes (authentication required)
const resumeUploadRoutes = require('./routes/resumeUploadRoutes');

// Protected routes
app.use('/api/resumes', authenticate, resumeUploadRoutes);
app.use('/api/resumes', authenticate, emailRoutes);
app.use('/api/emails', authenticate, emailRoutes);
app.use('/api/notifications', authenticate, notificationRoutes);

// Debug: Log route registration
console.log('📋 Registered routes:');
console.log('   POST /api/resumes/upload - File upload');
console.log('   GET  /api/resumes - Get all resumes');
console.log('   GET  /api/resumes/stats/count - Get count');
console.log('   GET  /api/resumes/test-upload-route - Test route');
console.log('   GET  /api/resumes/download/:id - Download PDF');
console.log('   GET  /api/resumes/:id - Get single resume');
console.log('   DELETE /api/resumes/:id - Delete resume');

// Socket.io connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Make io accessible to email service
app.set('io', io);

// Debug middleware to log all requests (before routes)
app.use((req, res, next) => {
  if (req.path.includes('/upload') || req.path.includes('/api/resumes') || req.path.includes('/download')) {
    console.log(`🔍 Incoming Request: ${req.method} ${req.path} | Original: ${req.originalUrl}`);
  }
  next();
});

// Initialize Redis (non-blocking, with timeout)
const initRedisWithTimeout = async () => {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Redis initialization timeout')), 5000)
  );
  
  try {
    await Promise.race([
      redisService.initializeRedis(),
      timeout
    ]);
    console.log('✅ Redis initialized');
  } catch (err) {
    console.warn('⚠️ Redis initialization failed, continuing without Redis:', err.message);
  }
};

initRedisWithTimeout();

// NOTE: Removed unused queue processor since no actual job processing logic was implemented

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Server is running', 
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// SMS Test endpoint (protected with basic auth)
app.get('/api/test-sms', async (req, res) => {
  // Check for basic auth header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authorization header required'
    });
  }
  
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const expectedToken = process.env.SMS_TEST_TOKEN || process.env.JWT_SECRET;
  
  if (!expectedToken || token !== expectedToken) {
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid authorization token'
    });
  }
  
  try {
    console.log('🧪 SMS test endpoint called');
    const smsService = require('./services/smsService');
    await smsService.checkAndSendBirthdaySMS();
    res.json({ 
      success: true, 
      message: 'SMS test completed successfully',
      timestamp: new Date()
    });
  } catch (error) {
    console.error('❌ SMS test failed:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date()
    });
  }
});

// Quick ping endpoint for load balancers
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

const PORT = process.env.PORT || 5000;

// Start server IMMEDIATELY (don't wait for MongoDB or other services)
server.listen(PORT, () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  
  if (isProduction) {
    console.log(`   🚀 Production mode: SMS every 3 minutes, auto-restart every 5 minutes`);
    console.log(`   📊 Monitoring: Check logs/production.log for restart information`);
  } else {
    console.log(`   🔧 Development mode: Using cron schedule for SMS`);
  }
  
  console.log(`\n📋 Available API endpoints:`);
  console.log(`   POST http://localhost:${PORT}/api/resumes/upload`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes/stats/count`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes/test-upload-route`);
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   GET  http://localhost:${PORT}/api/test-sms (testing only - requires auth token)\n`);
  console.log(`✅ Server is ready to accept requests (background services loading...)\n`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is already in use!`);
    console.error(`Another server instance is already running on port ${PORT}.`);
    console.error(`\nTo fix this:`);
    console.error(`1. Find the process using: netstat -ano | findstr :${PORT}`);
    console.error(`2. Kill it using: taskkill /PID <process_id> /F`);
    console.error(`3. Or use a different port by setting PORT in .env file\n`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
