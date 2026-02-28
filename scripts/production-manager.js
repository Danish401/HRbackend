#!/usr/bin/env node

/**
 * Production Server Manager
 * Handles automatic restarts and monitoring for production environment
 */

const fs = require('fs');
const path = require('path');

// Configuration
const RESTART_INTERVAL = 5 * 60 * 1000; // 5 minutes
const LOG_FILE = path.join(__dirname, '../logs/production.log');
const RESTART_COUNT_FILE = path.join(__dirname, '../logs/restart-count.txt');

// Ensure logs directory exists
const logsDir = path.dirname(LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Read restart count
function getRestartCount() {
  try {
    if (fs.existsSync(RESTART_COUNT_FILE)) {
      return parseInt(fs.readFileSync(RESTART_COUNT_FILE, 'utf8')) || 0;
    }
  } catch (err) {
    console.error('Error reading restart count:', err.message);
  }
  return 0;
}

// Write restart count
function updateRestartCount(count) {
  try {
    fs.writeFileSync(RESTART_COUNT_FILE, count.toString());
  } catch (err) {
    console.error('Error writing restart count:', err.message);
  }
}

// Log message with timestamp
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (err) {
    console.error('Error writing to log file:', err.message);
  }
}

// Check if running in production
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  console.log('⚠️  Production manager only runs in production environment');
  console.log('   Current NODE_ENV:', process.env.NODE_ENV || 'not set');
  process.exit(0);
}

// Get current restart count
let restartCount = getRestartCount();
restartCount++;
updateRestartCount(restartCount);

log(`🚀 Production Server Manager Started (Restart #${restartCount})`);
log(`   PID: ${process.pid}`);
log(`   Environment: ${process.env.NODE_ENV}`);
log(`   Auto-restart interval: ${RESTART_INTERVAL / 1000 / 60} minutes`);

// Schedule next restart
setTimeout(() => {
  log('🔄 Scheduled auto-restart triggered');
  log('   Server will exit now - process manager should restart it');
  
  // Exit gracefully - PM2 or process manager should restart the process
  process.exit(0);
}, RESTART_INTERVAL);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log('🛑 Received SIGTERM - shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('🛑 Received SIGINT - shutting down gracefully');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`💥 Uncaught Exception: ${err.message}`);
  log(`   Stack: ${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`💥 Unhandled Rejection at: ${promise}`);
  log(`   Reason: ${reason}`);
  process.exit(1);
});

log('✅ Production manager initialized and monitoring...');