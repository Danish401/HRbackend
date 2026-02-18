#!/usr/bin/env node

/**
 * Test Script for Production SMS and Auto-Restart Configuration
 */

const https = require('https');
const http = require('http');

async function testEndpoint(url, description) {
  console.log(`\n🔍 Testing: ${description}`);
  console.log(`   URL: ${url}`);
  
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const req = protocol.get(url, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`   Status: ${res.statusCode} ${res.statusMessage}`);
        console.log(`   Response: ${data.substring(0, 200)}${data.length > 200 ? '...' : ''}`);
        resolve({ success: true, status: res.statusCode, data });
      });
    });
    
    req.on('error', (err) => {
      console.log(`   ❌ Error: ${err.message}`);
      resolve({ success: false, error: err.message });
    });
    
    req.setTimeout(10000, () => {
      console.log(`   ❌ Timeout after 10 seconds`);
      req.destroy();
      resolve({ success: false, error: 'Timeout' });
    });
  });
}

async function runTests() {
  console.log('🧪 Production SMS & Auto-Restart Test Suite');
  console.log('===========================================');
  
  const baseUrl = process.argv[2] || 'http://localhost:5000';
  
  console.log(`🎯 Testing server: ${baseUrl}`);
  console.log(`🕐 Start time: ${new Date().toISOString()}\n`);
  
  // Test 1: Basic health check
  await testEndpoint(`${baseUrl}/ping`, 'Basic Ping Test');
  
  // Test 2: Health endpoint
  const healthResult = await testEndpoint(`${baseUrl}/api/health`, 'Health Check Endpoint');
  
  // Test 3: SMS test (this will trigger actual SMS in production)
  console.log('\n⚠️  WARNING: This will send a real SMS in production!');
  const proceed = process.env.NODE_ENV === 'production' ? 
    (await question('Continue with SMS test? (y/N): ')).toLowerCase() === 'y' : true;
    
  if (proceed) {
    await testEndpoint(`${baseUrl}/api/test-sms`, 'SMS Test Endpoint');
  } else {
    console.log('   🚫 SMS test skipped');
  }
  
  // Test 4: Environment check
  if (healthResult.success && healthResult.data) {
    try {
      const healthData = JSON.parse(healthResult.data);
      console.log(`\n📋 Environment Information:`);
      console.log(`   Environment: ${healthData.environment}`);
      console.log(`   MongoDB Status: ${healthData.mongodb}`);
      console.log(`   Uptime: ${Math.round(healthData.uptime)} seconds`);
      console.log(`   Memory Usage: ${(healthData.memory.rss / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
      console.log('   ❌ Could not parse health data');
    }
  }
  
  console.log(`\n🏁 Test completed at: ${new Date().toISOString()}`);
}

// Simple question helper for interactive mode
function question(query) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Run tests
runTests().catch(err => {
  console.error('❌ Test suite failed:', err.message);
  process.exit(1);
});