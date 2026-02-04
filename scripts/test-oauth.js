const graphService = require('./services/graphService');

async function testAuthUrl() {
  try {
    const url = await graphService.getAuthUrl();
    console.log('\n=== Microsoft OAuth Authorization URL ===');
    console.log('Click this link to authorize your Outlook account:');
    console.log('\n' + url);
    console.log('\n=========================================\n');
  } catch (error) {
    console.error('Error generating auth URL:', error.message);
  }
}

// Run the test
testAuthUrl();