require('dotenv').config();
const mongoose = require('mongoose');
const { fetchOutlookMessages } = require('../services/graphService');
const Token = require('../models/Token');

// Connect to MongoDB
async function connectDB() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/resumeextractor', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  }
}

async function testOutlookAuth() {
  console.log('🧪 Testing Outlook authentication...\n');
  
  // Connect to database first
  await connectDB();
  
  const userId = process.env.MS_GRAPH_USER_ID;
  if (!userId) {
    console.error('❌ MS_GRAPH_USER_ID not configured in environment variables');
    return;
  }

  console.log(`📧 Testing account: ${userId}`);
  
  try {
    // Check if token exists
    const tokenRecord = await Token.findOne({ accountEmail: userId.toLowerCase() });
    if (!tokenRecord) {
      console.log('❌ No token found. Please authorize first using the authorization URL.');
      const graphService = require('../services/graphService');
      const authUrl = await graphService.getAuthUrl(userId);
      console.log('\n🔗 Authorization URL:');
      console.log(authUrl);
      return;
    }
    
    console.log('✅ Token found in database');
    console.log(`   Expires at: ${tokenRecord.expiresAt}`);
    console.log(`   Updated at: ${tokenRecord.updatedAt}`);
    
    // Try to fetch messages
    console.log('\n📧 Attempting to fetch messages...');
    await fetchOutlookMessages(userId, null);
    
    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.message.includes('re-authorize')) {
      console.log('\n💡 The token may be invalid. Please re-authorize using:');
      console.log('   node scripts/reauth-outlook.js');
    }
  }
}

// Run the test
if (require.main === module) {
  testOutlookAuth();
}

module.exports = { testOutlookAuth };