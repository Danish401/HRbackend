const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const config = {
  port: process.env.PORT || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor',
  nodeEnv: process.env.NODE_ENV || 'development',
  queueCheckInterval: parseInt(process.env.QUEUE_CHECK_INTERVAL) || 5000,
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '50mb',
  mongoTimeout: parseInt(process.env.MONGO_TIMEOUT) || 10000,
};

const isProduction = config.nodeEnv === 'production';

// ============================================================================
// EXPRESS APP SETUP
// ============================================================================
const app = express();
const server = http.createServer(app);

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: isProduction ? undefined : false,
  crossOriginEmbedderPolicy: isProduction,
}));

// Compression
app.use(compression());

// Trust proxy (important for production behind load balancers)
if (isProduction) {
  app.set('trust proxy', 1);
}

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = config.frontendUrl.split(',').map(url => url.trim());
    
    // Allow requests with no origin (mobile apps, Postman, etc.) in development
    if (!origin && !isProduction) {
      return callback(null, true);
    }
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 100 : 1000, // Limit each IP to 100 requests per windowMs in production
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Body parsers
app.use(express.json({ limit: config.maxRequestSize }));
app.use(express.urlencoded({ extended: true, limit: config.maxRequestSize }));

// ============================================================================
// SOCKET.IO SETUP
// ============================================================================
const io = socketIo(server, {
  cors: {
    origin: config.frontendUrl.split(',').map(url => url.trim()),
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
});

// Socket.io connection handling with error management
io.on('connection', (socket) => {
  console.log('✅ Client connected:', socket.id);
  
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error.message);
  });
  
  socket.on('disconnect', (reason) => {
    console.log('🔌 Client disconnected:', socket.id, '- Reason:', reason);
  });
});

// Make io accessible to routes and services
app.set('io', io);

// ============================================================================
// MONGODB HELPER FUNCTIONS
// ============================================================================

/**
 * Properly encode MongoDB connection string password
 * Handles special characters in passwords
 */
function encodeMongoPassword(uri) {
  if (!uri || !uri.includes('@')) {
    return uri;
  }

  if (!uri.includes('mongodb://') && !uri.includes('mongodb+srv://')) {
    return uri;
  }

  try {
    const atSignCount = (uri.match(/@/g) || []).length;
    
    if (atSignCount > 1) {
      const protocolMatch = uri.match(/^(mongodb(\+srv)?:\/\/)/);
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
      
      // Only encode if not already encoded
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

/**
 * Mask sensitive information in MongoDB URI for logging
 */
function maskMongoURI(uri) {
  if (!uri) return 'undefined';
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

// ============================================================================
// MONGODB CONNECTION
// ============================================================================
let MONGODB_URI = encodeMongoPassword(config.mongodbUri);

console.log('🔄 MongoDB Configuration:');
console.log(`   URI: ${maskMongoURI(MONGODB_URI)}`);
console.log(`   Environment: ${config.nodeEnv}`);

// Configure mongoose
mongoose.set('strictQuery', false);
mongoose.set('bufferCommands', false);

// MongoDB connection options
const mongooseOptions = {
  serverSelectionTimeoutMS: config.mongoTimeout,
  socketTimeoutMS: 45000,
  connectTimeoutMS: config.mongoTimeout,
  maxPoolSize: isProduction ? 10 : 5,
  minPoolSize: isProduction ? 2 : 1,
  retryWrites: true,
  retryReads: true,
};

// MongoDB event handlers
mongoose.connection.on('connected', () => {
  console.log('✅ MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.log('⚠️  MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// ============================================================================
// IMPORT ROUTES AND SERVICES
// ============================================================================
let emailRoutes, authRoutes, ensureDefaultAdmin, emailService, authenticate, redisService, resumeUploadRoutes;

try {
  emailRoutes = require('./routes/emailRoutes');
  const authModule = require('./routes/authRoutes');
  authRoutes = authModule.router;
  ensureDefaultAdmin = authModule.ensureDefaultAdmin;
  emailService = require('./services/emailService');
  const authMiddleware = require('./middleware/auth');
  authenticate = authMiddleware.authenticate;
  redisService = require('./services/redisService');
  resumeUploadRoutes = require('./routes/resumeUploadRoutes');
} catch (error) {
  console.error('❌ Error importing routes/services:', error.message);
  process.exit(1);
}

// ============================================================================
// REQUEST LOGGING MIDDLEWARE
// ============================================================================
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log request
  if (!isProduction || req.path.includes('/upload') || req.path.includes('/api/resumes')) {
    console.log(`📥 ${req.method} ${req.path}`);
  }
  
  // Log response
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!isProduction || duration > 1000 || res.statusCode >= 400) {
      console.log(`📤 ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  
  next();
});

// ============================================================================
// HEALTH CHECK (Before authentication)
// ============================================================================
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    memory: process.memoryUsage(),
  };
  
  // Check Redis if available
  try {
    if (redisService && redisService.isConnected && redisService.isConnected()) {
      health.redis = 'connected';
    }
  } catch (error) {
    health.redis = 'disconnected';
  }
  
  const statusCode = health.mongodb === 'connected' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Resume Extractor API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      resumes: '/api/resumes',
      emails: '/api/emails',
    }
  });
});

// ============================================================================
// ROUTES REGISTRATION
// ============================================================================

// Public routes (no authentication required)
app.use('/api/auth', authRoutes);

// Protected routes (authentication required)
app.use('/api/resumes', authenticate, resumeUploadRoutes);
app.use('/api/resumes', authenticate, emailRoutes);
app.use('/api/emails', authenticate, emailRoutes);

// Log registered routes
console.log('📋 Registered routes:');
console.log('   GET  / - Root endpoint');
console.log('   GET  /api/health - Health check');
console.log('   POST /api/auth/* - Authentication routes');
console.log('   POST /api/resumes/upload - File upload');
console.log('   GET  /api/resumes - Get all resumes');
console.log('   GET  /api/resumes/stats/count - Get count');
console.log('   GET  /api/resumes/download/:id - Download PDF');
console.log('   GET  /api/resumes/:id - Get single resume');
console.log('   DELETE /api/resumes/:id - Delete resume');
console.log('   ALL  /api/emails/* - Email routes');

// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    path: req.path,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Validation Error', message: err.message });
  }
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS Error', message: 'Origin not allowed' });
  }
  
  // Don't leak error details in production
  const message = isProduction ? 'Internal server error' : err.message;
  const stack = isProduction ? undefined : err.stack;
  
  res.status(err.status || 500).json({
    error: 'Error',
    message,
    ...(stack && { stack }),
  });
});

// ============================================================================
// REDIS QUEUE PROCESSOR
// ============================================================================
let queueProcessorInterval = null;

async function startQueueProcessor() {
  const queueName = 'pdf_processing_queue';
  
  console.log('🔄 Starting queue processor...');
  
  queueProcessorInterval = setInterval(async () => {
    try {
      if (!redisService || !redisService.isConnected || !redisService.isConnected()) {
        return; // Skip if Redis is not connected
      }
      
      const job = await redisService.getFromQueue(queueName);
      if (job) {
        console.log(`📦 Processing queued job: ${job.type} (ID: ${job.id})`);
        
        // Process the job based on type
        if (job.type === 'process_pdf') {
          try {
            // Add your PDF processing logic here
            console.log(`✅ Processed queued PDF job: ${job.id}`);
            
            // Emit socket event if needed
            if (io && job.userId) {
              io.to(job.userId).emit('job_completed', {
                jobId: job.id,
                status: 'completed',
                timestamp: new Date(),
              });
            }
          } catch (processingError) {
            console.error(`❌ Error processing PDF job ${job.id}:`, processingError.message);
            
            // Optionally re-queue or log to dead letter queue
            if (io && job.userId) {
              io.to(job.userId).emit('job_failed', {
                jobId: job.id,
                error: processingError.message,
                timestamp: new Date(),
              });
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error processing queue:', error.message);
    }
  }, config.queueCheckInterval);
  
  console.log(`✅ Queue processor started (checking every ${config.queueCheckInterval}ms)`);
}

function stopQueueProcessor() {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
    console.log('⏹️  Queue processor stopped');
  }
}

// ============================================================================
// EMAIL MONITORING
// ============================================================================
let emailMonitoringStarted = false;

async function startEmailMonitoring() {
  if (emailMonitoringStarted) {
    console.log('⚠️  Email monitoring already started');
    return;
  }
  
  try {
    if (emailService && emailService.startMonitoring) {
      await emailService.startMonitoring(io);
      emailMonitoringStarted = true;
      console.log('✅ Email monitoring started');
    } else {
      console.log('⚠️  Email service not available');
    }
  } catch (error) {
    console.error('❌ Error starting email monitoring:', error.message);
  }
}

function stopEmailMonitoring() {
  if (emailService && emailService.stopMonitoring) {
    emailService.stopMonitoring();
    emailMonitoringStarted = false;
    console.log('⏹️  Email monitoring stopped');
  }
}

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================
async function gracefulShutdown(signal) {
  console.log(`\n⚠️  ${signal} received, starting graceful shutdown...`);
  
  let exitCode = 0;
  
  try {
    // Stop accepting new connections
    console.log('🔄 Closing HTTP server...');
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error('❌ Error closing HTTP server:', err.message);
          reject(err);
        } else {
          console.log('✅ HTTP server closed');
          resolve();
        }
      });
    });
    
    // Stop queue processor
    console.log('🔄 Stopping queue processor...');
    stopQueueProcessor();
    
    // Stop email monitoring
    console.log('🔄 Stopping email monitoring...');
    stopEmailMonitoring();
    
    // Close Socket.IO connections
    console.log('🔄 Closing Socket.IO connections...');
    io.close(() => {
      console.log('✅ Socket.IO closed');
    });
    
    // Close Redis connection
    if (redisService && redisService.disconnect) {
      console.log('🔄 Closing Redis connection...');
      await redisService.disconnect();
      console.log('✅ Redis connection closed');
    }
    
    // Close MongoDB connection
    console.log('🔄 Closing MongoDB connection...');
    await mongoose.connection.close(false);
    console.log('✅ MongoDB connection closed');
    
    console.log('✅ Graceful shutdown complete');
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error.message);
    exitCode = 1;
  }
  
  process.exit(exitCode);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// ============================================================================
// SERVER STARTUP
// ============================================================================
async function startServer() {
  console.log('\n🚀 Starting Resume Extractor Server...');
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Node Version: ${process.version}\n`);
  
  try {
    // 1. Connect to MongoDB
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, mongooseOptions);
    console.log('✅ MongoDB connected successfully');
    mongoose.set('bufferCommands', true);
    
    // 2. Initialize default admin
    console.log('🔄 Ensuring default admin exists...');
    await ensureDefaultAdmin();
    console.log('✅ Default admin verified');
    
    // 3. Initialize Redis (non-blocking)
    console.log('🔄 Initializing Redis...');
    if (redisService && redisService.initializeRedis) {
      redisService.initializeRedis()
        .then(() => console.log('✅ Redis initialized'))
        .catch(err => {
          console.warn('⚠️  Redis initialization failed, continuing without Redis:', err.message);
          console.warn('   Queue processing and caching will be disabled');
        });
    } else {
      console.warn('⚠️  Redis service not available');
    }
    
    // 4. Start HTTP server
    console.log('🔄 Starting HTTP server...');
    await new Promise((resolve, reject) => {
      server.listen(config.port, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`✅ HTTP server listening on port ${config.port}`);
    
    // 5. Start email monitoring
    await startEmailMonitoring();
    
    // 6. Start queue processor
    await startQueueProcessor();
    
    console.log('\n✅ Server startup complete!');
    console.log(`🌐 API available at: http://localhost:${config.port}`);
    console.log(`📊 Health check: http://localhost:${config.port}/api/health\n`);
    
  } catch (err) {
    console.error('\n❌ Server startup failed:', err.message);
    console.error('Stack trace:', err.stack);
    console.error('\n🔴 Exiting due to startup failure...\n');
    process.exit(1);
  }
}

// ============================================================================
// START THE SERVER
// ============================================================================
startServer();

// Export for testing
module.exports = { app, server, io };
