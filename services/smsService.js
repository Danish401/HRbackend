const twilio = require('twilio');
const Email = require('../models/Resume'); // Default export is Email model
const { Resume } = require('../models/Resume'); // Named export is Resume model
const cron = require('node-cron');

// Environment check
const isProduction = process.env.NODE_ENV === 'production';

// Auto-restart configuration
const AUTO_RESTART_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
// Recipient configuration - can be overridden by environment variable
const recipientNumber = process.env.SMS_RECIPIENT_NUMBER || '+917009236647';

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

/**
 * Check for birthdays today and send an SMS summary
 */
async function checkAndSendBirthdaySMS() {
  console.log('🎂 Checking for today\'s birthdays...');
  
  try {
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1; // 1-12
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[today.getMonth()];

    // Get both Email records and direct Resume records
    const [emails, resumes] = await Promise.all([
      Email.find({ hasAttachment: true }),
      Resume.find({})
    ]);
    
    // Combine and normalize data
    const allPeople = [
      ...emails.map(e => ({
        name: e.attachmentData?.name || 'Unknown Name',
        phone: e.attachmentData?.contactNumber || 'No Phone',
        dob: e.attachmentData?.dateOfBirth,
        source: 'Email'
      })),
      ...resumes.map(r => ({
        name: r.name || 'Unknown Name',
        phone: r.contactNumber || 'No Phone',
        dob: r.dateOfBirth,
        source: 'Upload'
      }))
    ];
    
    const birthdayPeople = allPeople.filter(person => {
      const dob = person.dob;
      if (!dob) return false;
      
      // Convert to lowercase for case-insensitive comparison
      const dobLower = dob.toLowerCase();
      
      // Get today's date components
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(month).padStart(2, '0');
      
      // Check various date formats
      const datePatterns = [
        // DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD-MM-YY
        `${dayStr}/${monthStr}/`,
        `${dayStr}-${monthStr}-`,
        // MM/DD/YYYY, MM/DD/YY, MM-DD-YYYY, MM-DD-YY
        `${monthStr}/${dayStr}/`,
        `${monthStr}-${dayStr}-`,
        // DD/MM, DD-MM, MM/DD, MM-DD
        `${dayStr}/${monthStr}`,
        `${dayStr}-${monthStr}`,
        `${monthStr}/${dayStr}`,
        `${monthStr}-${dayStr}`,
        // Numeric without separators
        `${dayStr}${monthStr}`,
        `${monthStr}${dayStr}`,
        // Day and month name combinations
        `${dayStr} ${monthName.toLowerCase()}`,
        `${monthName.toLowerCase()} ${dayStr}`,
        `${day} ${monthName.toLowerCase()}`,
        `${monthName.toLowerCase()} ${day}`
      ];
      
      // Check if any pattern matches the date of birth
      for (const pattern of datePatterns) {
        if (dobLower.includes(pattern.toLowerCase())) {
          return true;
        }
      }
      
      // Additional check for spelled out dates
      const dayOrdinal = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`;
      if (dobLower.includes(dayOrdinal.toLowerCase()) && dobLower.includes(monthName.toLowerCase())) {
        return true;
      }
      
      return false;
    });

    if (birthdayPeople.length === 0) {
      console.log('ℹ️ No birthdays found for today.');
      return;
    }

    console.log(`🎉 Found ${birthdayPeople.length} people with birthdays today!`);

    // Prepare message
    let message = `🎂 Birthday Report (${new Date().toLocaleDateString()}):\n\n`;
    
    birthdayPeople.forEach((person, index) => {
      message += `${index + 1}. ${person.name}
   Ph: ${person.phone}
   DOB: ${person.dob}

`;
    });

    // Send via Twilio
    if (!client) {
      const errorMsg = '❌ Twilio client not initialized. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env';
      if (isProduction) {
        console.error(errorMsg);
        // In production, you might want to send an alert to admin
        // sendAdminAlert('SMS Service Error', errorMsg);
      } else {
        console.error(errorMsg);
      }
      return;
    }

    const response = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: recipientNumber
    });

    const successMsg = `✅ Birthday SMS sent! SID: ${response.sid}`;
    if (isProduction) {
      console.log(successMsg);
      // Log to file or external service in production
      // logToExternalService('SMS_SENT', { sid: response.sid, recipient: recipientNumber });
    } else {
      console.log(successMsg);
    }
  } catch (error) {
    const errorMsg = `❌ Error in checkAndSendBirthdaySMS: ${error.message}`;
    if (isProduction) {
      console.error(errorMsg);
      console.error('Error stack:', error.stack);
      // In production, send alert to admin or monitoring service
      // sendAdminAlert('SMS Service Critical Error', errorMsg);
    } else {
      console.error(errorMsg);
      console.error('Error details:', error);
    }
  }
}

/**
 * Initialize the birthday checker task
 */
function initBirthdayTask() {
  const envInfo = isProduction ? 'Production' : 'Development';
  const serverTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  if (isProduction) {
    // Production: Send SMS every 3 minutes but restart server every 5 minutes
    console.log(`🚀 Production mode: SMS will be sent every 3 minutes, server restarts every ${AUTO_RESTART_INTERVAL/60000} minutes`);
    console.log(`   🕐 Server Timezone: ${serverTimezone}`);
    
    // Send SMS every 3 minutes
    setInterval(() => {
      console.log(`🕒 ${new Date().toISOString()} - Triggering SMS send (3-minute interval)`);
      checkAndSendBirthdaySMS();
    }, 3 * 60 * 1000); // 3 minutes
    
    // Note: Server auto-restart is handled by production-manager.js script
    console.log(`ℹ️  Server auto-restart is handled by production-manager.js`);
    
  } else {
    // Development: Use cron schedule from environment
    const schedule = process.env.SMS_CRON_SCHEDULE || '15 17 * * *'; // 4:53 PM daily
    
    // Validate cron expression
    if (!isValidCronExpression(schedule)) {
      console.error(`❌ Invalid cron schedule: ${schedule}`);
      return;
    }
    
    cron.schedule(schedule, () => {
      checkAndSendBirthdaySMS();
    });
    
    console.log(`📅 Birthday checker task scheduled for ${schedule} (${envInfo} environment)`);
    console.log(`   🕐 Server Timezone: ${serverTimezone}`);
    console.log(`   🎯 Target Time: 4:53 PM IST (will run at ${getISTTimeFromCron(schedule)} IST)`);
    
    // In development, optionally run once on startup for testing
    console.log('🔧 Development mode: Running birthday check once on startup');
    setTimeout(() => checkAndSendBirthdaySMS(), 5000); // Run after 5 seconds
  }
}

/**
 * Validate cron expression
 */
function isValidCronExpression(expression) {
  try {
    // Simple validation - try to create a cron job
    const validateCron = require('node-cron');
    return validateCron.validate(expression);
  } catch (err) {
    return false;
  }
}

/**
 * Convert cron schedule to IST time (for logging/display)
 */
function getISTTimeFromCron(cronExpression) {
  // Parse cron expression: minute hour day month weekday
  const parts = cronExpression.split(' ');
  if (parts.length >= 2) {
    const [minute, hour] = parts;
    
    // Singapore time (server time)
    const sgtTime = new Date();
    sgtTime.setHours(parseInt(hour), parseInt(minute), 0, 0);
    
    // Convert to IST (UTC+5:30) = SGT (UTC+8) - 2.5 hours
    const istTime = new Date(sgtTime.getTime() - (2.5 * 60 * 60 * 1000));
    
    return istTime.toLocaleTimeString('en-IN', { 
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }
  return 'Unknown';
}

module.exports = {
  checkAndSendBirthdaySMS,
  initBirthdayTask
};
