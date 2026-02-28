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
    authority: `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'common'}`, // Use 'common' to support both work and personal accounts
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Determine the correct authority URL based on account type
 * NOTE: Using 'common' endpoint to support both work/personal accounts with existing app registration
 */
function getAuthorityForAccount(accountEmail) {
  // Using 'common' endpoint which should work for both work and personal accounts
  // with existing app registrations that aren't specifically configured for 'consumers'
  return `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'common'}`;
}

/**
 * Get the Authorization URL for the user to visit
 */
async function getAuthUrl(accountEmail = null) {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  // Use common authority to work with existing app registration
  // (consumers endpoint requires special app registration that supports personal accounts)
  const authority = `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'common'}`;
  
  // Create a new MSAL client with the correct authority
  const msalConfigForAuth = {
    auth: {
      clientId: process.env.MS_GRAPH_CLIENT_ID,
      authority: authority,
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
    }
  };
  const ccaForAuth = new msal.ConfidentialClientApplication(msalConfigForAuth);
  
  const authCodeUrlParameters = {
    scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'],
    redirectUri: redirectUri,
  };

  return ccaForAuth.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange Authorization Code for Tokens
 */
async function redeemCode(code) {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  const tokenRequest = {
    code: code,
    scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'],
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

  // Create a new MSAL client with the correct authority for personal accounts
  const authority = getAuthorityForAccount(accountEmail);
  const msalConfigForRefresh = {
    auth: {
      clientId: process.env.MS_GRAPH_CLIENT_ID,
      authority: authority,
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
    }
  };
  const ccaForRefresh = new msal.ConfidentialClientApplication(msalConfigForRefresh);

  const refreshTokenRequest = {
    refreshToken: tokenRecord.refreshToken,
    scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'],
  };

  try {
    const response = await ccaForRefresh.acquireTokenByRefreshToken(refreshTokenRequest);
    
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
 * Check the status of the token for a given account
 */
async function checkTokenStatus(accountEmail) {
  try {
    const tokenRecord = await Token.findOne({ accountEmail: accountEmail.toLowerCase() });
    
    if (!tokenRecord) {
      return {
        status: 'missing',
        message: 'No token found for this account. Please authorize again.',
        accountEmail: accountEmail
      };
    }
    
    // Check if token exists and has required fields
    if (!tokenRecord.accessToken || !tokenRecord.refreshToken || !tokenRecord.expiresAt) {
      return {
        status: 'invalid',
        message: 'Token data is incomplete. Please re-authorize.',
        accountEmail: accountEmail,
        hasAccessToken: !!tokenRecord.accessToken,
        hasRefreshToken: !!tokenRecord.refreshToken,
        hasExpiresAt: !!tokenRecord.expiresAt
      };
    }
    
    // Check if token is expired
    const isExpired = tokenRecord.expiresAt <= new Date();
    
    // Check if token is expiring soon (within 5 minutes)
    const isExpiringSoon = tokenRecord.expiresAt <= new Date(Date.now() + 5 * 60 * 1000);
    
    return {
      status: isExpired ? 'expired' : (isExpiringSoon ? 'expiring_soon' : 'valid'),
      message: isExpired ? 'Token has expired and needs to be refreshed' : 
               (isExpiringSoon ? 'Token is expiring soon' : 'Token is valid'),
      accountEmail: accountEmail,
      expiresAt: tokenRecord.expiresAt,
      expiresIn: Math.floor((tokenRecord.expiresAt - Date.now()) / 1000),
      isExpired: isExpired,
      isExpiringSoon: isExpiringSoon
    };
  } catch (error) {
    console.error('❌ Error checking token status:', error.message);
    return {
      status: 'error',
      message: `Error checking token status: ${error.message}`,
      accountEmail: accountEmail
    };
  }
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

    let client = getGraphClient(accessToken);

    // Fetch last 10 messages from Inbox
    // For personal accounts, use /me instead of /users/{userId}
    const isPersonalAccount = userId.endsWith('@outlook.com') || userId.endsWith('@hotmail.com') || userId.endsWith('@live.com');
    const mailboxEndpoint = isPersonalAccount ? '/me' : `/users/${userId}`;
    
    let messages;
    try {
      messages = await client.api(`${mailboxEndpoint}/mailFolders/inbox/messages`)
        .top(10)
        .select('id,subject,from,receivedDateTime,hasAttachments')
        .orderby('receivedDateTime DESC')
        .get();
    } catch (apiError) {
      // If it's a 401 error, the token might have expired or been revoked
      if (apiError.statusCode === 401) {
        console.log('🔄 401 Unauthorized received, attempting to refresh token and retry...');
        
        try {
          // Force refresh by deleting the stored token temporarily and getting a new one
          await Token.deleteOne({ accountEmail: userId.toLowerCase() });
          
          // Re-acquire token
          accessToken = await getValidToken(userId);
          
          // Create new client with fresh token
          client = getGraphClient(accessToken);
          
          // Retry the API call
          messages = await client.api(`${mailboxEndpoint}/mailFolders/inbox/messages`)
            .top(10)
            .select('id,subject,from,receivedDateTime,hasAttachments')
            .orderby('receivedDateTime DESC')
            .get();
            
          console.log('✅ Successfully retried fetching messages after token refresh');
        } catch (retryError) {
          console.error('❌ Retry failed after token refresh:', retryError.message);
          
          // Check token status for more details
          const tokenStatus = await checkTokenStatus(userId);
          console.log(`📋 Current token status:`, JSON.stringify(tokenStatus, null, 2));
          
          throw retryError;
        }
      } else {
        throw apiError;
      }
    }

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
      
      // Additional info for debugging
      console.error('   4. The token might be invalid or expired. Try re-authorizing your account.');
      console.error('   5. Make sure the account has proper permissions in Azure AD App Registration.');
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
    // For personal accounts, use /me instead of /users/{userId}
    const isPersonalAccount = userId.endsWith('@outlook.com') || userId.endsWith('@hotmail.com') || userId.endsWith('@live.com');
    const mailboxEndpoint = isPersonalAccount ? '/me' : `/users/${userId}`;
    
    const fullMsg = await client.api(`${mailboxEndpoint}/messages/${message.id}`)
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
      // For personal accounts, use /me instead of /users/{userId}
      const isPersonalAccount = userId.endsWith('@outlook.com') || userId.endsWith('@hotmail.com') || userId.endsWith('@live.com');
      const mailboxEndpoint = isPersonalAccount ? '/me' : `/users/${userId}`;
      
      const attachments = await client.api(`${mailboxEndpoint}/messages/${message.id}/attachments`).get();
      
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
  redeemCode,
  checkTokenStatus
};
