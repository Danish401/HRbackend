/**
 * Fix Script: Delete existing token and force re-authorization
 * 
 * This script deletes the current token so you can re-authorize
 * and hopefully get a refresh token from Microsoft.
 * 
 * Usage: node scripts/fix-missing-refresh-token.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Token = require('../models/Token');

async function fixMissingRefreshToken() {
  console.log('🔧 Fixing Missing Refresh Token Issue\n');
  
  // Connect to MongoDB
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor';
  
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
  
  const targetEmail = process.env.MS_GRAPH_USER_ID || 'danishali700@outlook.com';
  
  console.log(`📧 Target account: ${targetEmail}\n`);
  
  // Check current token
  const currentToken = await Token.findOne({ accountEmail: targetEmail.toLowerCase() });
  
  if (!currentToken) {
    console.log('ℹ️  No token found in database. You can proceed with fresh authorization.');
  } else {
    console.log('📋 Current token status:');
    console.log(`   Account: ${currentToken.accountEmail}`);
    console.log(`   Has Access Token: ${!!currentToken.accessToken}`);
    console.log(`   Has Refresh Token: ${!!currentToken.refreshToken}`);
    console.log(`   Expires At: ${currentToken.expiresAt}`);
    
    if (currentToken.refreshToken) {
      console.log('\n✅ Refresh token IS present! No fix needed.');
      console.log('   If automatic refresh is not working, check other issues.');
      await mongoose.disconnect();
      return;
    }
    
    console.log('\n⚠️  Refresh token is MISSING!');
    console.log('   This will be deleted so you can re-authorize.\n');
    
    // Delete the token
    await Token.deleteOne({ accountEmail: targetEmail.toLowerCase() });
    console.log('✅ Deleted existing token from database.\n');
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 NEXT STEPS TO GET REFRESH TOKEN:\n');
  console.log('1. Visit the OAuth login URL:');
  console.log(`   http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login\n`);
  
  console.log('2. Sign in with your Microsoft account\n');
  
  console.log('3. IMPORTANT: When prompted for permissions, make sure to:');
  console.log('   ✅ Grant ALL requested permissions');
  console.log('   ✅ Look for "Yes, I trust this app" or similar consent');
  console.log('   ✅ Don\'t skip any consent screens\n');
  
  console.log('4. After authorization completes, run this test:');
  console.log(`   node scripts/test-auto-refresh.js\n`);
  
  console.log('5. Check if refresh token is now stored:');
  console.log(`   node scripts/list-outlook-tokens.js\n`);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('💡 WHY THIS HAPPENS:');
  console.log('   - Microsoft sometimes doesn\'t return refresh token on first auth');
  console.log('   - Personal accounts (@outlook.com) may need explicit consent');
  console.log('   - The "offline_access" scope must be properly consented\n');
  
  console.log('🔍 IF STILL NO REFRESH TOKEN AFTER RE-AUTH:');
  console.log('   1. Check Azure Portal → App Registration → API Permissions');
  console.log('   2. Ensure these Delegated permissions exist:');
  console.log('      • User.Read');
  console.log('      • Mail.Read');
  console.log('      • Mail.Read.Shared');
  console.log('      • offline_access (CRITICAL!)');
  console.log('   3. Click "Grant Admin Consent" for all permissions');
  console.log('   4. Try authorization again\n');
  
  await mongoose.disconnect();
  console.log('✅ Fix script completed!\n');
}

// Run the fix
fixMissingRefreshToken().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
