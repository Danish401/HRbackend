let redis = null;
try {
  redis = require('redis');
} catch (e) {
  console.warn('⚠️  Redis module not installed. Redis features will be disabled.');
  console.warn('   To enable Redis, run: npm install redis');
}

require('dotenv').config();

let redisClient = null;
let isConnected = false;
let redisDisabled = false; // Flag to disable Redis after too many failures

// Initialize Redis connection
async function initializeRedis() {
  if (!redis || redisDisabled) {
    return null;
  }
  
  // Don't try to reconnect if we've already given up
  if (redisClient && !isConnected) {
    return null;
  }
  
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    // If client exists but disconnected, close it first
    if (redisClient && !isConnected) {
      try {
        await redisClient.quit();
      } catch (e) {
        // Ignore errors when closing
      }
      redisClient = null;
    }
    
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            // Give up after 3 attempts, not 10
            redisDisabled = true;
            console.warn('⚠️  Redis: Disabled after connection failures. System will continue without Redis.');
            return false; // Stop reconnecting
          }
          return false; // Don't reconnect automatically
        },
        connectTimeout: 5000 // 5 second timeout
      }
    });

    redisClient.on('error', (err) => {
      // Only log errors if we're still trying to connect
      if (!redisDisabled) {
        isConnected = false;
      }
    });

    redisClient.on('connect', () => {
      if (!redisDisabled) {
        console.log('🔄 Redis: Connecting...');
      }
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis: Connected and ready');
      isConnected = true;
      redisDisabled = false; // Reset flag on successful connection
    });

    redisClient.on('end', () => {
      isConnected = false;
    });

    // Add timeout to connection attempt
    const connectPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), 10000)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);
    return redisClient;
  } catch (error) {
    console.error('❌ Redis connection error:', error.message);
    redisDisabled = true;
    isConnected = false;
    redisClient = null;
    return null;
  }
}

// Get Redis client (initialize if needed)
async function getRedisClient() {
  if (!redis) {
    return null;
  }
  if (!redisClient || !isConnected) {
    await initializeRedis();
  }
  return redisClient;
}

// Queue operations
async function addToQueue(queueName, data) {
  try {
    const client = await getRedisClient();
    if (!client) {
      console.warn('⚠️  Redis not available, skipping queue operation');
      return false;
    }
    
    await client.lPush(queueName, JSON.stringify(data));
    console.log(`✅ Added job to queue: ${queueName}`);
    return true;
  } catch (error) {
    console.error(`❌ Error adding to queue ${queueName}:`, error.message);
    return false;
  }
}

async function getFromQueue(queueName) {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    
    const result = await client.rPop(queueName);
    if (result) {
      return JSON.parse(result);
    }
    return null;
  } catch (error) {
    console.error(`❌ Error getting from queue ${queueName}:`, error.message);
    return null;
  }
}

async function getQueueLength(queueName) {
  try {
    const client = await getRedisClient();
    if (!client) return 0;
    
    return await client.lLen(queueName);
  } catch (error) {
    console.error(`❌ Error getting queue length ${queueName}:`, error.message);
    return 0;
  }
}

// Cache operations
async function setCache(key, value, expirationSeconds = 3600) {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    
    await client.setEx(key, expirationSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`❌ Error setting cache ${key}:`, error.message);
    return false;
  }
}

async function getCache(key) {
  try {
    const client = await getRedisClient();
    if (!client) return null;
    
    const result = await client.get(key);
    if (result) {
      return JSON.parse(result);
    }
    return null;
  } catch (error) {
    console.error(`❌ Error getting cache ${key}:`, error.message);
    return null;
  }
}

async function deleteCache(key) {
  try {
    const client = await getRedisClient();
    if (!client) return false;
    
    await client.del(key);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting cache ${key}:`, error.message);
    return false;
  }
}

// Check if email UID was processed (using Redis for faster lookups)
async function isEmailProcessed(uid) {
  // If Redis is disabled, always return false so emails can be processed
  if (!redis || redisDisabled) {
    return false;
  }
  
  try {
    const client = await getRedisClient();
    if (!client || !isConnected) {
      return false; // If Redis unavailable, return false so email can be processed
    }
    
    const key = `processed_email:${uid}`;
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    // On error, return false so email can still be processed
    return false;
  }
}

async function markEmailProcessed(uid, expirationSeconds = 86400) {
  // If Redis is disabled, just return true (success) without trying
  if (!redis || redisDisabled) {
    return true;
  }
  
  try {
    const client = await getRedisClient();
    if (!client || !isConnected) {
      return true; // Return true even if Redis unavailable
    }
    
    const key = `processed_email:${uid}`;
    await client.setEx(key, expirationSeconds, '1');
    return true;
  } catch (error) {
    // On error, return true so processing continues
    return true;
  }
}

// Close Redis connection
async function closeRedis() {
  if (!redis) {
    return;
  }
  try {
    if (redisClient && isConnected) {
      await redisClient.quit();
      console.log('✅ Redis connection closed');
    }
  } catch (error) {
    console.error('❌ Error closing Redis connection:', error.message);
  }
}

module.exports = {
  initializeRedis,
  getRedisClient,
  addToQueue,
  getFromQueue,
  getQueueLength,
  setCache,
  getCache,
  deleteCache,
  isEmailProcessed,
  markEmailProcessed,
  closeRedis
};
