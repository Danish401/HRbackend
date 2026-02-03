#!/usr/bin/env node

/**
 * SMS Service Monitor
 * Run this script to check SMS service health
 */

const twilio = require('twilio');

// Load environment variables
require('dotenv').config({ path: './.env' });

async function checkSMSService() {
  console.log('🔍 SMS Service Health Check');
  console.log('==========================\n');
  
  // 1. Check environment variables
  console.log('1. Environment Variables Check:');
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN', 
    'TWILIO_PHONE_NUMBER',
    'SMS_RECIPIENT_NUMBER'
  ];
  
  let allPresent = true;
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`   ✅ ${varName}: SET`);
    } else {
      console.log(`   ❌ ${varName}: MISSING`);
      allPresent = false;
    }
  });
  
  if (!allPresent) {
    console.log('\n❌ Missing required environment variables!');
    process.exit(1);
  }
  
  // 2. Test Twilio authentication
  console.log('\n2. Twilio Authentication Check:');
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    const account = await client.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    console.log(`   ✅ Account Status: ${account.status}`);
    console.log(`   ✅ Account Type: ${account.type}`);
  } catch (error) {
    console.log(`   ❌ Authentication Failed: ${error.message}`);
    process.exit(1);
  }
  
  // 3. Test SMS sending (to yourself for verification)
  console.log('\n3. SMS Sending Test:');
  console.log('   📱 Sending test SMS to:', process.env.SMS_RECIPIENT_NUMBER);
  
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    
    const message = await client.messages.create({
      body: `✅ SMS Service Test Successful! Time: ${new Date().toLocaleString()}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.SMS_RECIPIENT_NUMBER
    });
    
    console.log(`   ✅ SMS Sent Successfully!`);
    console.log(`   📡 Message SID: ${message.sid}`);
    console.log(`   🕐 Sent at: ${new Date().toLocaleString()}`);
    
  } catch (error) {
    console.log(`   ❌ SMS Send Failed: ${error.message}`);
    if (error.code) {
      console.log(`   📋 Error Code: ${error.code}`);
    }
    process.exit(1);
  }
  
  // 4. Check cron schedule
  console.log('\n4. Cron Schedule Check:');
  const cronSchedule = process.env.SMS_CRON_SCHEDULE || '53 16 * * *';
  console.log(`   📅 Schedule: ${cronSchedule}`);
  
  try {
    const cron = require('node-cron');
    const isValid = cron.validate(cronSchedule);
    if (isValid) {
      console.log(`   ✅ Valid cron expression`);
    } else {
      console.log(`   ❌ Invalid cron expression`);
    }
  } catch (error) {
    console.log(`   ❌ Cron validation error: ${error.message}`);
  }
  
  // 5. Environment info
  console.log('\n5. Environment Info:');
  console.log(`   🌐 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   🕐 Server Time: ${new Date().toString()}`);
  console.log(`   📍 Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  
  console.log('\n✅ All checks passed! SMS service is healthy.');
}

// Run the check
checkSMSService().catch(error => {
  console.error('\n💥 Health check failed:', error.message);
  process.exit(1);
});