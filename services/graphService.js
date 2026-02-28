const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
require('dotenv').config();

const Email = require('../models/Resume');
const redisService = require('./redisService');
const { extractResumeData } = require('./pdfParser');
// Lazy load emailService to avoid circular dependency
function getEmailService() {
  return require('./emailService');
}

const Token = require('../models/Token');

// MS Graph Configuration
const msalConfig = {
  auth: {
    clientId: process.env.MS_GRAPH_CLIENT_ID,
    authority: `https://login.microsoftonline.com/common`, // Use 'common' for personal + work accounts
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Get the Authorization URL for the user to visit
 */
function getAuthUrl() {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  const authCodeUrlParameters = {
    scopes: ['offline_access', 'User.Read', 'Mail.Read'],
    redirectUri: redirectUri,
  };

  return cca.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange Authorization Code for Tokens
 */
async function redeemCode(code) {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  const tokenRequest = {
    code: code,
    scopes: ['offline_access', 'User.Read', 'Mail.Read'],
    redirectUri: redirectUri,
  };

  try {
    const response = await cca.acquireTokenByCode(tokenRequest);
    const accountEmail = response.account.username.toLowerCase();
    
    // Save or update token in DB
    await Token.findOneAndUpdate(
      { accountEmail },
      {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: response.expiresOn,
        updatedAt: new Date()
      },
      { upsert: true }
    );

    return accountEmail;
  } catch (error) {
    console.error('❌ Error redeeming Outlook code:', error.message);
    throw error;
  }
}

/**
 * Get a valid Access Token (refreshes if needed)
 */
async function getValidToken(accountEmail) {
  const tokenRecord = await Token.findOne({ accountEmail: accountEmail.toLowerCase() });
  
  if (!tokenRecord) {
    throw new Error(`No token found for ${accountEmail}. Please authorize again.`);
  }

  // If token is still valid (with 5 min buffer)
  if (tokenRecord.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenRecord.accessToken;
  }

  console.log(`🔄 Refreshing token for ${accountEmail}...`);

  const refreshTokenRequest = {
    refreshToken: tokenRecord.refreshToken,
    scopes: ['offline_access', 'User.Read', 'Mail.Read'],
  };

  try {
    const response = await cca.acquireTokenByRefreshToken(refreshTokenRequest);
    
    tokenRecord.accessToken = response.accessToken;
    if (response.refreshToken) tokenRecord.refreshToken = response.refreshToken;
    tokenRecord.expiresAt = response.expiresOn;
    tokenRecord.updatedAt = new Date();
    await tokenRecord.save();

    return response.accessToken;
  } catch (error) {
    console.error('❌ Error refreshing Outlook token:', error.message);
    throw error;
  }
}

function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    }
  });
}

/**
 * Fetch messages from Outlook via Microsoft Graph API
 */
async function fetchOutlookMessages(userId, io) {
  if (!process.env.MS_GRAPH_CLIENT_ID || !process.env.MS_GRAPH_CLIENT_SECRET) {
    console.warn('⚠️ MS Graph credentials missing, skipping Graph API fetch.');
    return;
  }

  try {
    console.log(`\n📧 [Outlook-Graph] Checking for new messages for ${userId}...`);
    
    let accessToken;
    try {
      accessToken = await getValidToken(userId);
    } catch (tokenErr) {
      console.warn(`⚠️ [Outlook-Graph] ${tokenErr.message}`);
      const authUrl = process.env.MS_GRAPH_REDIRECT_URI ? 
        process.env.MS_GRAPH_REDIRECT_URI.replace('/callback', '/login') : 
        `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`;
      console.log(`👉 Please authorize at: ${authUrl}`);
      return;
    }

    const client = getGraphClient(accessToken);

    // Fetch last 10 messages from Inbox
    const messages = await client.api(`/users/${userId}/mailFolders/inbox/messages`)
      .top(10)
      .select('id,subject,from,receivedDateTime,hasAttachments')
      .orderby('receivedDateTime DESC')
      .get();

    if (!messages.value || messages.value.length === 0) {
      console.log('❌ No messages found in Outlook inbox.');
      return;
    }

    console.log(`✅ [Outlook-Graph] Found ${messages.value.length} recent messages.`);

    for (const msg of messages.value) {
      await processGraphMessage(client, userId, msg, io);
    }

  } catch (error) {
    console.error('❌ Error in fetchOutlookMessages:', error.message || error);
    if (error.statusCode) console.error(`   Status Code: ${error.statusCode}`);
    if (error.code) console.error(`   Error Code: ${error.code}`);
    
    // Handle ReadableStream error body
    if (error.body && typeof error.body.getReader === 'function') {
      try {
        console.log('   Attempting to read error body stream...');
        // In some environments, error.body might be a stream
      } catch (e) {}
    } else if (error.body) {
      console.error(`   Error Body: ${JSON.stringify(error.body)}`);
    }

    if (error.statusCode === 401) {
      console.error('\n💡 [Outlook-Graph] 401 Unauthorized usually means:');
      console.error('   1. Personal accounts (@outlook.com) often do not support "Application Permissions".');
      console.error('   2. Ensure you have granted "Admin Consent" for Mail.Read in Azure Portal.');
      console.error('   3. Check if your Client Secret is correct and not expired.');
    }
  }
}

/**
 * Process individual message from Graph API
 */
async function processGraphMessage(client, userId, message, io) {
  const emailId = `graph_${message.id}`;

  // Check if already processed
  try {
    const isProcessed = await redisService.isEmailProcessed(emailId);
    if (isProcessed) {
      return;
    }
  } catch (err) {
    // Fallback to DB check if Redis fails
  }

  const existingEmail = await Email.findOne({ emailId });
  if (existingEmail) {
    await redisService.markEmailProcessed(emailId).catch(() => {});
    return;
  }

  console.log(`📨 [Outlook-Graph] Processing Message ID: ${message.id}`);
  console.log(`   From: ${message.from.emailAddress.name} <${message.from.emailAddress.address}>`);
  console.log(`   Subject: "${message.subject}"`);

  try {
    // Get message content
    const fullMsg = await client.api(`/users/${userId}/messages/${message.id}`)
      .select('body,hasAttachments,from,subject,receivedDateTime')
      .get();

    const fromEmail = fullMsg.from.emailAddress.address;
    const fromName = fullMsg.from.emailAddress.name;
    const subject = fullMsg.subject;
    const receivedAt = new Date(fullMsg.receivedDateTime);
    const bodyText = fullMsg.body.content.replace(/<[^>]*>/g, '').trim();
    
    let attachmentData = null;
    let hasAttachment = false;

    // Fetch attachments if any
    if (fullMsg.hasAttachments) {
      const attachments = await client.api(`/users/${userId}/messages/${message.id}/attachments`).get();
      
      for (const attachment of attachments.value) {
        if (attachment['@odata.type'] === '#microsoft.graph.fileAttachment' && 
            (attachment.name.toLowerCase().endsWith('.pdf') || attachment.contentType === 'application/pdf')) {
          
          console.log(`📎 [Outlook-Graph] Found PDF attachment: ${attachment.name}`);
          
          const buffer = Buffer.from(attachment.contentBytes, 'base64');
          
          // Use processPdfAttachment from emailService
          const emailService = getEmailService();
          if (emailService && emailService.processPdfAttachment) {
            hasAttachment = true;
            attachmentData = await emailService.processPdfAttachment(
              { content: buffer, filename: attachment.name, contentType: attachment.contentType },
              attachment.name,
              'Outlook-Graph'
            );
            break; // Process only first PDF
          }
        }
      }
    }

    // Save to database
    console.log(`\n💾 [Outlook-Graph] Saving email to MongoDB...`);

    const email = new Email({
      from: fromEmail,
      fromName: fromName,
      subject: subject || 'No Subject',
      body: bodyText,
      receivedAt: receivedAt,
      emailId: emailId,
      hasAttachment: hasAttachment,
      attachmentData: attachmentData || undefined
    });

    const savedEmail = await email.save();
    console.log(`✅ [Outlook-Graph] Email saved successfully!`);

    // Mark as processed
    const emailService = getEmailService();
    if (emailService && emailService.markAsProcessed) {
      await emailService.markAsProcessed(emailId);
    } else {
      await redisService.markEmailProcessed(emailId).catch(() => {});
    }

    // Emit real-time notification
    if (io) {
      io.emit('newEmail', {
        message: hasAttachment ? 
          'New Outlook email with PDF attachment received!' : 
          'New Outlook email received!',
        email: savedEmail
      });
      console.log(`✓ [Outlook-Graph] Real-time notification sent`);
    }

  } catch (error) {
    console.error(`❌ Error processing Graph message ${message.id}:`, error.message);
  }
}

module.exports = {
  fetchOutlookMessages,
  getAuthUrl,
  redeemCode
};
