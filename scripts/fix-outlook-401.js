#!/usr/bin/env node

/**
 * Diagnostic script to identify and fix Outlook Graph API 401 Unauthorized errors
 */

require('dotenv').config();
const Token = require('../models/Token');
const { checkTokenStatus, getValidToken } = require('../services/graphService');

async function diagnoseAndFixTokens() {
  console.log('🔍 Starting Outlook Graph API 401 error diagnosis...\n');

  try {
    // Get all token records
    const tokens = await Token.find({});
    
    if (tokens.length === 0) {
      console.log('❌ No token records found. User needs to authorize their Outlook account first.');
      console.log('👉 Visit: http://localhost:5000/api/outlook-auth/login to authorize');
      return;
    }

    console.log(`📋 Found ${tokens.length} token record(s):\n`);

    for (const token of tokens) {
      console.log(`📧 Account: ${token.accountEmail}`);
      
      // Check token status
      const status = await checkTokenStatus(token.accountEmail);
      console.log(`   Status: ${status.status}`);
      console.log(`   Message: ${status.message}`);
      
      if (status.isExpired || status.status === 'invalid' || status.status === 'missing') {
        console.log(`   ❌ Token needs attention. Attempting to clean up...`);
        
        // Remove the problematic token
        await Token.deleteOne({ accountEmail: token.accountEmail });
        console.log(`   ✅ Token for ${token.accountEmail} has been removed.`);
      } else if (status.expiresIn < 300) { // Less than 5 minutes
        console.log(`   ⚠️  Token expires soon (${Math.floor(status.expiresIn/60)} mins). Attempting refresh...`);
        
        try {
          await getValidToken(token.accountEmail);
          console.log(`   ✅ Token for ${token.accountEmail} has been refreshed.`);
        } catch (refreshErr) {
          console.log(`   ❌ Failed to refresh token: ${refreshErr.message}`);
          console.log(`   ✅ Removing invalid token...`);
          await Token.deleteOne({ accountEmail: token.accountEmail });
        }
      } else {
        console.log(`   ✅ Token is valid for ${Math.floor(status.expiresIn/60)} minutes.`);
      }
      
      console.log('');
    }

    // Final check
    const remainingTokens = await Token.find({});
    console.log(`📊 Remaining token records: ${remainingTokens.length}`);
    
    if (remainingTokens.length > 0) {
      console.log('\n✅ Token cleanup completed. Try running your application again.');
    } else {
      console.log('\n❌ No valid tokens remain. Please re-authorize your Outlook account.');
      console.log('👉 Visit: http://localhost:5000/api/outlook-auth/login to authorize');
    }

  } catch (error) {
    console.error('❌ Error during diagnosis:', error.message);
    console.error(error.stack);
  }
}

// Run the diagnostic if called directly
if (require.main === module) {
  diagnoseAndFixTokens().then(() => {
    console.log('\n🎯 Diagnosis complete!');
    process.exit(0);
  }).catch((error) => {
    console.error('\n💥 Error running diagnosis:', error);
    process.exit(1);
  });
}

module.exports = { diagnoseAndFixTokens };