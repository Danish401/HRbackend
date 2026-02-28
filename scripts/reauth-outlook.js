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

async function reauthorizeOutlookAccount() {
  console.log('🔄 Reauthorizing Outlook account...\n');
  
  // Connect to database first
  await connectDB();
  
  const userId = process.env.MS_GRAPH_USER_ID;
  if (!userId) {
    console.error('❌ MS_GRAPH_USER_ID not configured in environment variables');
    return;
  }

  console.log(`📧 Target account: ${userId}`);
  
  try {
    // Delete existing token to force re-authentication
    console.log('🗑️  Deleting existing token...');
    await Token.deleteOne({ accountEmail: userId.toLowerCase() });
    console.log('✅ Existing token deleted\n');
    
    console.log('📋 Please visit the following URL to authorize your Outlook account:');
    console.log('   This will generate a new token with proper permissions.\n');
    
    // Generate the authorization URL
    const graphService = require('../services/graphService');
    const authUrl = await graphService.getAuthUrl(userId);
    console.log(authUrl);
    console.log('\n📋 After authorizing, the callback will be sent to:');
    console.log(process.env.MS_GRAPH_REDIRECT_URI || 'http://localhost:5000/api/outlook-auth/callback');
    
    console.log('\n💡 Note: After successful authorization, you can test the connection again.');
  } catch (error) {
    console.error('❌ Error during reauthorization process:', error.message);
    console.error(error.stack);
  }
}

// Run the reauthorization
if (require.main === module) {
  reauthorizeOutlookAccount();
}

module.exports = { reauthorizeOutlookAccount };