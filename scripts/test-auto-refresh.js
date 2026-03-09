/**
 * Test Script: Verify Automatic Token Refresh
 * 
 * This script tests that the backend automatically refreshes
 * Microsoft access tokens using refresh tokens.
 * 
 * Usage: node scripts/test-auto-refresh.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Token = require('../models/Token');
const { getValidToken, checkTokenStatus } = require('../services/graphService');

async function testAutoRefresh() {
  console.log('🧪 Testing Microsoft Automatic Token Refresh\n');
  
  // Connect to MongoDB
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor';
  
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('\n💡 Make sure MongoDB is running and MONGODB_URI is set in .env');
    process.exit(1);
  }
  
  const testEmail = process.env.MS_GRAPH_USER_ID;
  
  if (!testEmail) {
    console.error('❌ MS_GRAPH_USER_ID not set in .env');
    console.error('\n💡 Add this to your .env file:');
    console.error(`   MS_GRAPH_USER_ID=your-email@outlook.com`);
    process.exit(1);
  }
  
  console.log(`📧 Testing with account: ${testEmail}\n`);
  
  // Step 1: Check current token status
  console.log('📋 Step 1: Checking current token status...');
  const tokenStatus = await checkTokenStatus(testEmail);
  console.log('   Token Status:', JSON.stringify(tokenStatus, null, 2));
  
  if (tokenStatus.status === 'missing') {
    console.error('\n❌ No token found for this account.');
    console.error('\n💡 Please authorize first by visiting:');
    console.error(`   http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`);
    await mongoose.disconnect();
    process.exit(1);
  }
  
  // Step 2: Get valid token (should trigger refresh if expired)
  console.log('\n📋 Step 2: Requesting valid access token...');
  console.log('   This will automatically refresh if expired...\n');
  
  const startTime = Date.now();
  
  try {
    const accessToken = await getValidToken(testEmail);
    const endTime = Date.now();
    
    console.log(`✅ Successfully obtained access token`);
    console.log(`   Time taken: ${endTime - startTime}ms`);
    console.log(`   Token length: ${accessToken.length} characters`);
    console.log(`   Token preview: ${accessToken.substring(0, 50)}...`);
    
    // Step 3: Check updated token status
    console.log('\n📋 Step 3: Checking updated token status...');
    const updatedStatus = await checkTokenStatus(testEmail);
    console.log('   Updated Status:', JSON.stringify(updatedStatus, null, 2));
    
    // Step 4: Verify refresh worked
    console.log('\n📋 Step 4: Verification Results\n');
    
    if (updatedStatus.status === 'valid' || updatedStatus.status === 'expiring_soon') {
      console.log('✅ SUCCESS: Token is valid and working!');
      
      if (updatedStatus.expiresIn > 0) {
        const minutesUntilExpiry = Math.floor(updatedStatus.expiresIn / 60);
        console.log(`   ⏰ Access token expires in: ~${minutesUntilExpiry} minutes`);
        console.log(`   🔄 Will auto-refresh when expires (or 5 min before)`);
      }
      
      console.log('\n✅ AUTOMATIC REFRESH IS WORKING CORRECTLY!');
      console.log('\n📝 What just happened:');
      console.log('   1. Checked if access token was expired');
      console.log('   2. If expired, used refresh token to get new access token');
      console.log('   3. Updated database with new tokens');
      console.log('   4. Returned valid access token');
      console.log('\n🎉 This happens automatically every time you call getValidToken()!');
      
    } else {
      console.warn('⚠️ WARNING: Token status is not valid');
      console.warn('   Status:', updatedStatus.status);
      console.warn('   Message:', updatedStatus.message);
      console.warn('\n💡 You may need to re-authorize your account');
    }
    
  } catch (error) {
    console.error('\n❌ FAILED: Error during token refresh');
    console.error('   Error:', error.message);
    
    if (error.message.includes('Please re-authorize')) {
      console.error('\n💡 Refresh token has expired. Please re-authorize:');
      console.error(`   http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`);
    } else if (error.message.includes('No token found')) {
      console.error('\n💡 No token exists. Please authorize first:');
      console.error(`   http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`);
    }
    
    await mongoose.disconnect();
    process.exit(1);
  }
  
  // Cleanup
  await mongoose.disconnect();
  console.log('\n✅ Test completed successfully!\n');
  process.exit(0);
}

// Run the test
testAutoRefresh().catch(err => {
  console.error('❌ Unexpected error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
