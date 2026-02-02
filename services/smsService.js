const twilio = require('twilio');
const Email = require('../models/Resume'); // Default export is Email model
const { Resume } = require('../models/Resume'); // Named export is Resume model
const cron = require('node-cron');

// Twilio configuration
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const recipientNumber = '+917009236647'; // Added country code for Twilio

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

      const dobLower = dob.toLowerCase();
      
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(month).padStart(2, '0');
      
      const numericPatterns = [
        `${dayStr}/${monthStr}`,
        `${monthStr}/${dayStr}`,
        `${dayStr}-${monthStr}`,
        `${monthStr}-${dayStr}`,
        `${day}/${month}`,
        `${month}/${day}`
      ];

      if (numericPatterns.some(p => dob.includes(p))) return true;

      if (dobLower.includes(monthName.toLowerCase()) && dobLower.includes(String(day))) {
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
      console.error('❌ Twilio client not initialized. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env');
      return;
    }

    const response = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: recipientNumber
    });

    console.log(`✅ Birthday SMS sent! SID: ${response.sid}`);
  } catch (error) {
    console.error('❌ Error in checkAndSendBirthdaySMS:', error.message);
  }
}

/**
 * Initialize the birthday checker task (Runs at 9:00 AM every day)
 */
function initBirthdayTask() {
  // Schedule to run at 4:11 PM (16:11) daily
  cron.schedule('11 16 * * *', () => {
    checkAndSendBirthdaySMS();
  });
  
  console.log('📅 Birthday checker task scheduled for 04:11 PM daily');
  
  // Optional: Run once on startup for testing if needed
  // checkAndSendBirthdaySMS(); 
}

module.exports = {
  checkAndSendBirthdaySMS,
  initBirthdayTask
};
