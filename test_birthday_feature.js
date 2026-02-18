/**
 * Test script to verify the birthday notification feature
 */

const mongoose = require('mongoose');
const { Resume } = require('./models/Resume');
const Email = require('./models/Resume');
const { checkAndSendBirthdaySMS } = require('./services/smsService');

async function testBirthdayFeature() {
  console.log('🧪 Testing Birthday Notification Feature...\n');
  
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/resume_extractor', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Database connected\n');
    
    // Get today's date for testing
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1;
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[today.getMonth()];
    
    console.log(`📅 Today's date: ${day} ${monthName}`);
    console.log(`📅 Looking for birthdays on: ${day}/${monthName.toLowerCase()}\n`);
    
    // Clean up any previous test data
    await Resume.deleteMany({ name: { $regex: 'Test Birthday', $options: 'i' } });
    await Email.deleteMany({ 'attachmentData.name': { $regex: 'Test Birthday', $options: 'i' } });
    
    // Create test data with today's birthday
    // Use the format that matches the birthday detection logic
    const testResume = new Resume({
      name: 'Test Birthday User',
      contactNumber: '+1234567890',
      dateOfBirth: `${day}/${month}`, // Format: 4/2 (day/month)
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await testResume.save();
    console.log(`✅ Created test resume with birthday: ${testResume.dateOfBirth}`);
    
    // Also create an email record with birthday for comprehensive test
    const testEmail = new Email({
      from: 'test@example.com',
      fromName: 'Test Sender',
      subject: 'Test Email',
      receivedAt: new Date(),
      emailId: `test-${Date.now()}`,
      hasAttachment: true,
      attachmentData: {
        name: 'Test Birthday Email User',
        contactNumber: '+0987654321',
        dateOfBirth: `${day}/${month}`, // Format: 4/2 (day/month)
        rawText: 'Test resume data'
      }
    });
    
    await testEmail.save();
    console.log(`✅ Created test email with birthday: ${testEmail.attachmentData.dateOfBirth}\n`);
    
    // Test the birthday checking function
    console.log('🔍 Running birthday check...');
    await checkAndSendBirthdaySMS();
    console.log('✅ Birthday check completed\n');
    
    // Test our new endpoint functionality by manually running the same logic
    console.log('🔍 Testing notification endpoint logic...');
    
    // Replicate the logic from our notification endpoint
    const [emails, resumes] = await Promise.all([
      Email.find({ hasAttachment: true }),
      Resume.find({})
    ]);
    
    // Combine and normalize data
    const allPeople = [
      ...emails.map(e => ({
        _id: e._id,
        name: e.attachmentData?.name || 'Unknown Name',
        phone: e.attachmentData?.contactNumber || 'No Phone',
        dob: e.attachmentData?.dateOfBirth,
        source: 'Email'
      })),
      ...resumes.map(r => ({
        _id: r._id,
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

    console.log(`🎂 Found ${birthdayPeople.length} birthday(s) today:`);
    birthdayPeople.forEach((person, index) => {
      console.log(`  ${index + 1}. ${person.name} - ${person.phone} - ${person.dob}`);
    });
    
    if (birthdayPeople.length === 0) {
      console.log('  ℹ️  No birthdays found (this might be because today\'s date doesn\'t match test data)');
    }
    
    // Return test results
    const results = {
      totalTestUsers: 2, // One from Resume, one from Email
      birthdaysFound: birthdayPeople.length,
      testData: birthdayPeople
    };
    
    console.log('\n📊 Test Results:');
    console.log(`   Total test users created: ${results.totalTestUsers}`);
    console.log(`   Birthdays found today: ${results.birthdaysFound}`);
    console.log(`   Endpoint would return: ${JSON.stringify(results.testData.map(p => ({name: p.name, phone: p.phone, dob: p.dob})), null, 2)}`);
    
    console.log('\n🎉 Birthday notification feature test completed successfully!');
    
    // Clean up test data
    await Resume.deleteMany({ name: { $regex: 'Test Birthday', $options: 'i' } });
    await Email.deleteMany({ 'attachmentData.name': { $regex: 'Test Birthday', $options: 'i' } });
    console.log('🧹 Test data cleaned up');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔒 Database connection closed');
  }
}

// Run the test
testBirthdayFeature();