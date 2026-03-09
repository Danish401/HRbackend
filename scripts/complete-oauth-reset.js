/**
 * Complete Reset Script - Fix OAuth Issues Permanently
 * 
 * This script:
 * 1. Deletes all existing tokens
 * 2. Clears MSAL cache
 * 3. Provides clear next steps
 * 
 * Usage: node scripts/complete-oauth-reset.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Token = require('../models/Token');

async function completeReset() {
  console.log('🔄 Complete OAuth Reset\n');
  console.log('This will fix the "keep verifying again and again" issue!\n');
  
  // Connect to MongoDB
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor';
  
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
  
  // Step 1: Delete ALL tokens
  console.log('🗑️  Step 1: Deleting all stored tokens...');
  const deleteResult = await Token.deleteMany({});
  console.log(`   Deleted ${deleteResult.deletedCount} token(s)\n`);
  
  // Step 2: Clear MSAL cache folders
  console.log('🗑️  Step 2: Clearing MSAL cache...');
  
  const cachePaths = [
    path.join(process.cwd(), 'node_modules', '.cache'),
    path.join(process.cwd(), '.msal-cache'),
    path.join(process.cwd(), 'msal-cache'),
  ];
  
  for (const cachePath of cachePaths) {
    if (fs.existsSync(cachePath)) {
      try {
        fs.rmSync(cachePath, { recursive: true, force: true });
        console.log(`   ✅ Cleared: ${cachePath}`);
      } catch (err) {
        console.log(`   ⚠️  Could not clear: ${cachePath}`);
      }
    }
  }
  console.log('   Cache clearing complete!\n');
  
  // Step 3: Provide clear instructions
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ RESET COMPLETE!\n');
  console.log('📝 NEXT STEPS (DO THESE IN ORDER):\n');
  
  console.log('1️⃣  RESTART YOUR BACKEND:');
  console.log('   - Press Ctrl+C to stop it');
  console.log('   - Run: npm start\n');
  
  console.log('2️⃣  OPEN BROWSER IN INCOGNITO MODE:');
  console.log('   - Chrome/Edge: Press Ctrl+Shift+N');
  console.log('   - Firefox: Press Ctrl+Shift+P');
  console.log('   - Safari: Command+Shift+N\n');
  
  console.log('3️⃣  VISIT OAUTH LOGIN:');
  console.log(`   http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login\n`);
  
  console.log('4️⃣  SIGN IN CAREFULLY:');
  console.log('   - Email: danishali700@outlook.com');
  console.log('   - You WILL see TWO screens:');
  console.log('     Screen 1: Enter password');
  console.log('     Screen 2: Permissions (IMPORTANT!)');
  console.log('   - On Screen 2, you MUST see:');
  console.log('     ✓ "Maintain access to data you have given it access to"');
  console.log('     ✓ This is the offline_access permission');
  console.log('   - Click: "Yes, I trust this app"\n');
  
  console.log('5️⃣  WATCH CONSOLE OUTPUT:');
  console.log('   You should see:');
  console.log('   ✅ REFRESH TOKEN FOUND!');
  console.log('   💾 Saving refresh token to MongoDB...');
  console.log('   📦 MongoDB Token Document: Has refreshToken: true\n');
  
  console.log('6️⃣  VERIFY IT WORKED:');
  console.log('   Run: node scripts/test-auto-refresh.js');
  console.log('   Should say: ✅ AUTOMATIC REFRESH IS WORKING CORRECTLY!\n');
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  console.log('💡 WHY THIS WORKS:');
  console.log('   • Deleted old/bad tokens from database');
  console.log('   • Cleared MSAL cache that was returning stale responses');
  console.log('   • Forced consent screen ensures Microsoft returns refresh token');
  console.log('   • Incognito mode prevents browser from caching old auth\n');
  
  console.log('🎯 ONCE THIS WORKS:');
  console.log('   • You authorize ONCE');
  console.log('   • Backend auto-refreshes every hour for 90 days');
  console.log('   • NO manual verification needed!');
  console.log('   • Set it and forget it! 🎉\n');
  
  console.log('🆘 IF STILL NOT WORKING:');
  console.log('   1. Try different browser (Chrome, Edge, Firefox)');
  console.log('   2. Authorize 2-3 times (Microsoft sometimes needs retry)');
  console.log('   3. Check Azure Portal → API permissions → Grant admin consent');
  console.log('   4. Wait 15 minutes after granting consent\n');
  
  await mongoose.disconnect();
  console.log('✅ Reset script completed!\n');
  console.log('Now restart your backend and follow the steps above! 🚀\n');
}

// Run the reset
completeReset().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
