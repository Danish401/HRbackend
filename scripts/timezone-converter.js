#!/usr/bin/env node

/**
 * Timezone Converter for SMS Scheduling
 * Helps you calculate the correct cron time for different server locations
 */

function getTimezoneInfo() {
  const now = new Date();
  
  console.log('⏰ Timezone Conversion Helper');
  console.log('============================\n');
  
  // Current times in different timezones
  console.log('Current Times:');
  console.log(`  🇸🇬 Singapore (Server): ${now.toLocaleString('en-US', { timeZone: 'Asia/Singapore' })}`);
  console.log(`  🇮🇳 India (Target):     ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
  console.log(`  🌍 UTC:                ${now.toISOString()}\n`);
  
  // Time difference
  const singaporeTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Singapore', hour12: false });
  const indiaTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
  
  console.log('Time Difference:');
  console.log('  Singapore is 2.5 hours ahead of India');
  console.log('  To run at 4:53 PM IST, schedule for 7:23 PM SGT\n');
  
  // Calculate common schedules
  console.log('Cron Schedule Converter:');
  console.log('========================\n');
  
  const targetTimes = [
    { ist: '04:53 PM', description: 'Birthday check time' },
    { ist: '09:00 AM', description: 'Morning report' },
    { ist: '06:00 PM', description: 'Evening summary' }
  ];
  
  console.log('IST Time     →  SGT Time      →  Cron Schedule');
  console.log('----------------------------------------------');
  
  targetTimes.forEach(time => {
    const istHours = parseInt(time.ist.split(':')[0]);
    const istMinutes = parseInt(time.ist.split(':')[1]);
    const period = time.ist.includes('PM') && istHours !== 12 ? istHours + 12 : 
                  time.ist.includes('AM') && istHours === 12 ? 0 : istHours;
    
    // Convert IST to SGT (add 2.5 hours)
    let sgtHours = period + 2.5; // IST to SGT conversion
    if (sgtHours >= 24) sgtHours -= 24;
    
    const sgtHoursDisplay = Math.floor(sgtHours);
    const sgtMinutes = sgtHours % 1 === 0.5 ? 30 : 0; // 0.5 hours = 30 minutes
    
    // Format times for display
    const sgtTimeFormatted = sgtHours >= 12 
      ? `${sgtHoursDisplay > 12 ? sgtHoursDisplay - 12 : sgtHoursDisplay}:${sgtMinutes.toString().padStart(2, '0')} PM`
      : `${sgtHoursDisplay}:${sgtMinutes.toString().padStart(2, '0')} AM`;
    
    const cronMinutes = sgtMinutes.toString().padStart(2, '0');
    const cronHours = sgtHoursDisplay.toString().padStart(2, '0');
    const cronSchedule = `${cronMinutes} ${cronHours} * * *`;
    
    console.log(`${time.ist.padEnd(10)} →  ${sgtTimeFormatted.padEnd(10)}  →  ${cronSchedule.padEnd(12)} (${time.description})`);
  });
  
  console.log('\n📋 Your Current Configuration:');
  console.log('==============================');
  console.log(`SMS_CRON_SCHEDULE=${process.env.SMS_CRON_SCHEDULE || '23 19 * * *'}`);
  console.log(`This runs at: ${getCronTimeInfo(process.env.SMS_CRON_SCHEDULE || '23 19 * * *')}\n`);
  
  // Verify the current setting
  if (process.env.SMS_CRON_SCHEDULE === '23 19 * * *') {
    console.log('✅ Your current setting (23 19 * * *) is CORRECT');
    console.log('   → Runs at 7:23 PM SGT = 4:53 PM IST ✓');
  } else {
    console.log('⚠️  Please update your SMS_CRON_SCHEDULE in .env file');
    console.log('   Recommended: 23 19 * * * (for 4:53 PM IST)');
  }
}

function getCronTimeInfo(cronExpression) {
  const parts = cronExpression.split(' ');
  if (parts.length >= 2) {
    const [minute, hour] = parts;
    
    // Singapore time
    const sgtTime = new Date();
    sgtTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
    
    // Convert to IST (SGT - 2.5 hours)
    const istTime = new Date(sgtTime.getTime() - (2.5 * 60 * 60 * 1000));
    
    const sgtDisplay = sgtTime.toLocaleTimeString('en-US', { 
      timeZone: 'Asia/Singapore',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    const istDisplay = istTime.toLocaleTimeString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    return `${sgtDisplay} SGT = ${istDisplay} IST`;
  }
  return 'Invalid cron expression';
}

// Load environment variables
require('dotenv').config({ path: './.env' });

// Run the converter
getTimezoneInfo();