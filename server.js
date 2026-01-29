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

mongoose.set('bufferCommands', false);

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
  maxPoolSize: 10,
  minPoolSize: 1,
})
.then(() => {
  console.log('✅ MongoDB Connected successfully');
  console.log(`   Database: ${mongoose.connection.name}`);
  console.log(`   Host: ${mongoose.connection.host}:${mongoose.connection.port}`);
  mongoose.set('bufferCommands', true);

  // Ensure a default admin exists after successful DB connection
  try {
    ensureDefaultAdmin().catch(err => console.error('Error ensuring default admin:', err));
  } catch (e) {
    console.error('Error invoking ensureDefaultAdmin:', e);
  }
})
.catch(err => {
  console.error('\n❌ MongoDB connection FAILED!');
  console.error(`   Error: ${err.message}`);
  console.error(`   Error Name: ${err.name}`);
  
  if (err.name === 'MongoAPIError' && err.message.includes('URI must include hostname')) {
    console.error('\n   This error means your MongoDB connection string is malformed.');
    console.error('   Common issues:');
    console.error('   - Password contains special characters that need URL encoding');
    console.error('   - Multiple @ signs in the connection string');
    console.error('   - Invalid connection string format');
    console.error('\n   Fix:');
    console.error('   1. Check your MONGODB_URI in .env file');
    console.error('   2. Encode special characters in password:');
    console.error('      - @ becomes %40');
    console.error('      - : becomes %3A');
    console.error('      - / becomes %2F');
    console.error('   3. Example: If password is "pass@123", use "pass%40123"');
  }
  
  console.error('\n   Server will start but database operations will fail until MongoDB is connected.\n');
});

// Handle MongoDB connection events
mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️  MongoDB disconnected. Attempting to reconnect...');
  mongoose.set('bufferCommands', false);
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
  mongoose.set('bufferCommands', true);
});

mongoose.connection.on('connecting', () => {
  console.log('🔄 Connecting to MongoDB...');
});

// Import routes and services
const emailRoutes = require('./routes/emailRoutes');
const { router: authRoutes, ensureDefaultAdmin } = require('./routes/authRoutes');
const emailService = require('./services/emailService');
const { authenticate } = require('./middleware/auth');
const redisService = require('./services/redisService');
// Server startup log updated
// Public routes (no authentication required)
app.use('/api/auth', authRoutes);

// Protected routes (authentication required)
const resumeUploadRoutes = require('./routes/resumeUploadRoutes');

// Protected routes
app.use('/api/resumes', authenticate, resumeUploadRoutes);
app.use('/api/resumes', authenticate, emailRoutes);
app.use('/api/emails', authenticate, emailRoutes);

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

// Initialize Redis
redisService.initializeRedis().then(() => {
  console.log('✅ Redis initialized');
}).catch(err => {
  console.warn('⚠️  Redis initialization failed, continuing without Redis:', err.message);
});

// Start email monitoring
emailService.startMonitoring(io);

// Start Redis queue processor (processes jobs from queue)
async function startQueueProcessor() {
  const queueName = 'pdf_processing_queue';
  
  setInterval(async () => {
    try {
      const job = await redisService.getFromQueue(queueName);
      if (job) {
        console.log(`📦 Processing queued job: ${job.type}`);
        // Process the job based on type
        // This can be extended to handle different job types
        if (job.type === 'process_pdf') {
          // Job processing logic can be added here
          console.log(`✅ Processed queued PDF job: ${job.id}`);
        }
      }
    } catch (error) {
      console.error('❌ Error processing queue:', error.message);
    }
  }, 5000); // Check queue every 5 seconds
}

// Start queue processor
startQueueProcessor();

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'Server is running', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n✅ Server running on port ${PORT}`);
  console.log(`\n📋 Available API endpoints:`);
  console.log(`   POST http://localhost:${PORT}/api/resumes/upload`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes/stats/count`);
  console.log(`   GET  http://localhost:${PORT}/api/resumes/test-upload-route`);
  console.log(`   GET  http://localhost:${PORT}/api/health\n`);
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
