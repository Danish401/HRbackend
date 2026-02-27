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
    authority: `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'consumers'}`, // Use 'consumers' for personal accounts, 'organizations' for work accounts only, 'common' for both
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
  },
  // Cache configuration to handle token refresh properly
  cache: {
    // You can add cache configuration here if needed
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Get the Authorization URL for the user to visit
 */
function getAuthUrl() {
  // Ensure we always use the configured redirect URI, with fallback to localhost
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  // Use configured scopes or default scopes
  const scopes = process.env.MS_GRAPH_SCOPES ? 
    process.env.MS_GRAPH_SCOPES.split(',').map(scope => scope.trim()) : 
    ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'];

  const authCodeUrlParameters = {
    scopes: scopes,
    redirectUri: redirectUri,
  };

  return cca.getAuthCodeUrl(authCodeUrlParameters);
}

/**
 * Exchange Authorization Code for Tokens
 */
async function redeemCode(code) {
  // Ensure we always use the configured redirect URI, with fallback to localhost
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  // Use configured scopes or default scopes
  const scopes = process.env.MS_GRAPH_SCOPES ? 
    process.env.MS_GRAPH_SCOPES.split(',').map(scope => scope.trim()) : 
    ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'];

  const tokenRequest = {
    code: code,
    scopes: scopes,
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

  // Check if token exists and has required fields
  if (!tokenRecord.accessToken || !tokenRecord.refreshToken || !tokenRecord.expiresAt) {
    console.error(`❌ Invalid token record for ${accountEmail}. Missing required fields.`);
    await Token.deleteOne({ accountEmail: accountEmail.toLowerCase() });
    throw new Error(`Invalid token data for ${accountEmail}. Please re-authorize at the Outlook authentication endpoint.`);
  }

  // If token is still valid (with 5 min buffer)
  if (tokenRecord.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenRecord.accessToken;
  }

  console.log(`🔄 Refreshing token for ${accountEmail}...`);

  // Use the same redirect URI that was used for the original authorization
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  // Use configured scopes or default scopes
  const scopes = process.env.MS_GRAPH_SCOPES ? 
    process.env.MS_GRAPH_SCOPES.split(',').map(scope => scope.trim()) : 
    ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'];

  const refreshTokenRequest = {
    refreshToken: tokenRecord.refreshToken,
    scopes: scopes,
    redirectUri: redirectUri, // Include redirectUri in refresh request for better compatibility
  };

  try {
    const response = await cca.acquireTokenByRefreshToken(refreshTokenRequest);
    
    // Validate response
    if (!response || !response.accessToken) {
      throw new Error('Invalid token response from Microsoft Graph');
    }
    
    tokenRecord.accessToken = response.accessToken;
    // Only update refresh token if Microsoft provided a new one
    if (response.refreshToken) {
      tokenRecord.refreshToken = response.refreshToken;
    }
    tokenRecord.expiresAt = response.expiresOn;
    tokenRecord.updatedAt = new Date();
    await tokenRecord.save();

    console.log(`✅ Token refreshed successfully for ${accountEmail}`);
    return response.accessToken;
  } catch (error) {
    console.error('❌ Error refreshing Outlook token:', error.message);
    console.error('Error details:', {
      errorCode: error.errorCode,
      errorMessage: error.errorMessage,
      statusCode: error.statusCode
    });
    
    // Handle various token expiration/revocation scenarios
    const isTokenInvalid = error.errorCode === 'invalid_grant' || 
                          error.message.includes('invalid_grant') || 
                          error.message.includes('AADSTS70008') || // Refresh token expired
                          error.message.includes('AADSTS50012') || // Invalid client secret
                          error.message.includes('AADSTS70002') || // Invalid client credentials
                          error.statusCode === 401;
    
    if (isTokenInvalid) {
      console.error(`❌ Refresh token for ${accountEmail} is invalid/expired. User needs to re-authorize.`);
      
      // Delete the invalid token record so user can re-authenticate
      await Token.deleteOne({ accountEmail: accountEmail.toLowerCase() });
      
      throw new Error(`Authentication expired for ${accountEmail}. Please re-authorize at the Outlook authentication endpoint.`);
    }
    
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
      
      // Emit an event to notify the frontend that reauthorization is needed
      if (io) {
        io.emit('tokenExpired', {
          message: 'Outlook authentication expired. Please reauthorize.',
          email: userId,
          authUrl: authUrl
        });
      }
      return;
    }

    // Create Graph client with access token
    let client;
    try {
      client = getGraphClient(accessToken);
    } catch (clientError) {
      console.error('❌ Error creating Graph client:', clientError.message);
      // Clear the stored token since it might be invalid
      await Token.deleteOne({ accountEmail: userId.toLowerCase() });
      throw new Error('Failed to create Graph client. Please re-authorize your account.');
    }

    // Fetch last 10 messages from Inbox
    let messages;
    try {
      messages = await client.api(`/me/mailFolders/inbox/messages`) // Changed from /users/{userId}/... to /me/ for personal accounts
        .top(10)
        .select('id,subject,from,receivedDateTime,hasAttachments')
        .orderby('receivedDateTime DESC')
        .get();
    } catch (apiError) {
      console.error('❌ Error fetching messages from Graph API:', apiError.message);
      
      // If it's a 401 error, the token might have expired or been revoked
      if (apiError.statusCode === 401) {
        console.log('🔄 Attempting to refresh token and retry...');
        
        // Try to get a fresh token
        try {
          // Force refresh by deleting the stored token temporarily
          await Token.deleteOne({ accountEmail: userId.toLowerCase() });
          
          // Re-acquire token
          accessToken = await getValidToken(userId);
          
          // Create new client with fresh token
          client = getGraphClient(accessToken);
          
          // Retry the API call
          messages = await client.api(`/me/mailFolders/inbox/messages`)
            .top(10)
            .select('id,subject,from,receivedDateTime,hasAttachments')
            .orderby('receivedDateTime DESC')
            .get();
            
          console.log('✅ Successfully retried fetching messages after token refresh');
        } catch (retryError) {
          console.error('❌ Retry failed:', retryError.message);
          
          // Emit token expired event for frontend notification
          if (io) {
            const authUrl = process.env.MS_GRAPH_REDIRECT_URI ? 
              process.env.MS_GRAPH_REDIRECT_URI.replace('/callback', '/login') : 
              `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`;
            
            io.emit('tokenExpired', {
              message: 'Outlook authentication failed. Please reauthorize your account.',
              email: userId,
              authUrl: authUrl,
              error: '401 Unauthorized - Authentication required'
            });
          }
          
          throw retryError;
        }
      } else {
        throw apiError;
      }
    }

    if (!messages.value || messages.value.length === 0) {
      console.log('📭 No new messages found in Outlook inbox.');
      return;
    }

    console.log(`✅ [Outlook-Graph] Found ${messages.value.length} recent messages.`);

    let processedCount = 0;
    let errorCount = 0;
    
    for (const msg of messages.value) {
      try {
        await processGraphMessage(client, userId, msg, io);
        processedCount++;
      } catch (msgError) {
        console.error(`❌ Error processing message ${msg.id}:`, msgError.message);
        errorCount++;
      }
    }

    console.log(`📊 [Outlook-Graph] Processing complete: ${processedCount} successful, ${errorCount} errors.`);

  } catch (error) {
    console.error('❌ Error in fetchOutlookMessages:', error.message || error);
    
    // Log detailed error information
    const errorDetails = {
      statusCode: error.statusCode,
      code: error.code,
      requestId: error.requestId,
      date: error.date
    };
    
    if (Object.values(errorDetails).some(val => val !== undefined)) {
      console.error('   Error Details:', JSON.stringify(errorDetails, null, 2));
    }
    
    // Handle ReadableStream error body
    if (error.body && typeof error.body.getReader === 'function') {
      try {
        console.log('   Attempting to read error body stream...');
        const reader = error.body.getReader();
        const { done, value } = await reader.read();
        if (!done) {
          const decoder = new TextDecoder();
          const errorBody = decoder.decode(value);
          console.error('   Error Body Content:', errorBody);
        }
      } catch (e) {
        console.error('   Error reading stream:', e.message);
      }
    } else if (error.body) {
      console.error(`   Error Body: ${JSON.stringify(error.body)}`);
    }

    // Provide specific guidance based on error type
    if (error.statusCode === 401) {
      console.error('\n💡 [Outlook-Graph] 401 Unauthorized - Troubleshooting steps:');
      console.error('   1. Personal accounts (@outlook.com) may have limited API access');
      console.error('   2. Verify "Mail.Read" permission is granted in Azure Portal');
      console.error('   3. Check if Client Secret is valid and not expired');
      console.error('   4. Ensure Admin Consent was granted for application permissions');
      console.error('   5. Try re-authorizing the account through the login endpoint');
      
      // Emit token expired event for frontend notification
      if (io) {
        const authUrl = process.env.MS_GRAPH_REDIRECT_URI ? 
          process.env.MS_GRAPH_REDIRECT_URI.replace('/callback', '/login') : 
          `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/login`;
        
        io.emit('tokenExpired', {
          message: 'Outlook authentication failed. Please reauthorize your account.',
          email: userId,
          authUrl: authUrl,
          error: '401 Unauthorized - Authentication required'
        });
      }
    } else if (error.statusCode === 403) {
      console.error('\n💡 [Outlook-Graph] 403 Forbidden - Access denied:');
      console.error('   1. Check if the correct permissions are granted in Azure AD');
      console.error('   2. Verify the user has consented to the required scopes');
      console.error('   3. Ensure the application has proper access to the user\'s mailbox');
    } else if (error.statusCode === 429) {
      console.error('\n💡 [Outlook-Graph] 429 Too Many Requests - Rate limit exceeded:');
      console.error('   1. Reduce the frequency of API calls');
      console.error('   2. Implement proper rate limiting and backoff strategies');
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
    const fullMsg = await client.api(`/me/messages/${message.id}`)
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
      const attachments = await client.api(`/me/messages/${message.id}/attachments`).get();
      
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

/**
 * Check token status for a user
 */
async function checkTokenStatus(accountEmail) {
  try {
    const tokenRecord = await Token.findOne({ accountEmail: accountEmail.toLowerCase() });
    
    if (!tokenRecord) {
      return {
        status: 'missing',
        message: `No token found for ${accountEmail}`
      };
    }
    
    const now = new Date();
    const isExpired = tokenRecord.expiresAt <= now;
    const expiresInMinutes = Math.floor((tokenRecord.expiresAt - now) / (1000 * 60));
    
    return {
      status: isExpired ? 'expired' : 'valid',
      email: accountEmail,
      expiresAt: tokenRecord.expiresAt,
      expiresInMinutes: isExpired ? 0 : expiresInMinutes,
      needsRefresh: isExpired || expiresInMinutes < 5,
      updatedAt: tokenRecord.updatedAt
    };
  } catch (error) {
    console.error(`Error checking token status for ${accountEmail}:`, error.message);
    return {
      status: 'error',
      message: error.message
    };
  }
}

module.exports = {
  fetchOutlookMessages,
  getAuthUrl,
  redeemCode,
  getValidToken,
  checkTokenStatus
};
