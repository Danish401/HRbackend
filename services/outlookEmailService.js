const { Client } = require('@microsoft/microsoft-graph-client');
const msal = require('@azure/msal-node');
const Email = require('../models/Resume');
const redisService = require('./redisService');
const { processPdfAttachment } = require('./emailService');
require('dotenv').config();

const Token = require('../models/Token');

// MS Graph Configuration
const msalConfig = {
  auth: {
    clientId: process.env.MS_GRAPH_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'consumers'}`,
    clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
  }
};

const cca = new msal.ConfidentialClientApplication(msalConfig);

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
    throw new Error(`Invalid token data for ${accountEmail}. Please re-authorize.`);
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
    redirectUri: redirectUri,
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
      
      throw new Error(`Authentication expired for ${accountEmail}. Please re-authorize.`);
    }

    throw error;
  }
}

/**
 * Get Graph client with access token
 */
function getGraphClient(accessToken) {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    }
  });
}

/**
 * Get today's date in YYYY-MM-DD format for Graph API filtering
 */
function getTodayDateISOString() {
  const today = new Date();
  // Set time to beginning of day to ensure we get emails from today only
  today.setHours(0, 0, 0, 0);
  return today.toISOString();
}

/**
 * Check if an email has already been processed today
 */
async function isEmailProcessedToday(emailId, receivedDate) {
  // Extract date part from receivedDateTime
  const emailDate = new Date(receivedDate);
  const emailDateOnly = new Date(emailDate.getFullYear(), emailDate.getMonth(), emailDate.getDate());
  const today = new Date();
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // If email is not from today, return false (not processed today)
  if (emailDateOnly.getTime() !== todayDateOnly.getTime()) {
    return false;
  }

  // Check if email was already processed today
  try {
    const isProcessed = await redisService.isEmailProcessed(emailId);
    if (isProcessed) {
      return true;
    }
  } catch (err) {
    // Fallback to DB check if Redis fails
    console.warn('Redis check failed, falling back to DB check:', err.message);
  }

  // Check in database if email exists and was received today
  const existingEmail = await Email.findOne({ 
    emailId: emailId,
    receivedAt: {
      $gte: todayDateOnly,
      $lt: new Date(todayDateOnly.getTime() + 24 * 60 * 60 * 1000) // End of today
    }
  });
  
  return !!existingEmail;
}

/**
 * Mark email as processed today
 */
async function markEmailAsProcessed(emailId) {
  try {
    await redisService.markEmailProcessed(emailId);
  } catch (error) {
    console.warn(`⚠️ Could not mark ${emailId} in Redis: ${error.message}`);
  }
}

/**
 * Process individual message from Graph API
 */
async function processGraphMessage(client, userId, message, io) {
  const emailId = `graph_${message.id}`;
  const receivedDate = message.receivedDateTime;

  // Check if already processed today
  const isProcessed = await isEmailProcessedToday(emailId, receivedDate);
  if (isProcessed) {
    console.log(`⏭️  Email ${message.id} already processed today, skipping...`);
    return false; // Indicate that email was skipped
  }

  console.log(`📨 Processing Message ID: ${message.id}`);
  console.log(`   From: ${message.from.emailAddress.name} <${message.from.emailAddress.address}>`);
  console.log(`   Subject: "${message.subject}"`);
  console.log(`   Received: ${receivedDate}`);

  try {
    // Get message content
    const fullMsg = await client.api(`/me/messages/${message.id}`)
      .select('body,hasAttachments,from,subject,receivedDateTime')
      .get();

    const fromEmail = fullMsg.from.emailAddress.address;
    const fromName = fullMsg.from.emailAddress.name;
    const subject = fullMsg.subject;
    const receivedAt = new Date(fullMsg.receivedDateTime);
    
    // Only process if the email was received today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const receivedAtDate = new Date(receivedAt);
    receivedAtDate.setHours(0, 0, 0, 0);
    
    if (receivedAtDate.getTime() !== today.getTime()) {
      console.log(`⚠️  Email received on ${receivedAt.toDateString()}, not today. Skipping...`);
      return false;
    }

    const bodyText = fullMsg.body.content.replace(/<[^>]*>/g, '').trim();

    let attachmentData = null;
    let hasAttachment = false;

    // Fetch attachments if any
    if (fullMsg.hasAttachments) {
      const attachments = await client.api(`/me/messages/${message.id}/attachments`)
        .select('id,name,contentBytes,contentType,@odata.type,size')
        .get();

      for (const attachment of attachments.value) {
        if (attachment['@odata.type'] === '#microsoft.graph.fileAttachment' && 
            (attachment.name.toLowerCase().endsWith('.pdf') || attachment.contentType === 'application/pdf')) {

          console.log(`📎 Found PDF attachment: ${attachment.name}`);
          
          // Check if this attachment has already been processed for this email
          const attachmentId = `attachment_${message.id}_${attachment.id}`;
          const isAttachmentProcessed = await isEmailProcessedToday(attachmentId, receivedDate);
          
          if (isAttachmentProcessed) {
            console.log(`⏭️  Attachment ${attachment.name} already processed for this email, skipping...`);
            continue;
          }

          const buffer = Buffer.from(attachment.contentBytes, 'base64');

          // Process the PDF attachment
          hasAttachment = true;
          attachmentData = await processPdfAttachment(
            { content: buffer, filename: attachment.name, contentType: attachment.contentType },
            attachment.name,
            'Outlook-Graph'
          );

          // Mark attachment as processed
          await markEmailAsProcessed(attachmentId);
          break; // Process only first PDF
        }
      }
    }

    // Save to database
    console.log(`💾 Saving email to MongoDB...`);

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
    console.log(`✅ Email saved successfully!`);

    // Mark as processed
    await markEmailAsProcessed(emailId);

    // Emit real-time notification
    if (io) {
      io.emit('newEmail', {
        message: hasAttachment ? 
          'New Outlook email with PDF attachment received!' : 
          'New Outlook email received!',
        email: savedEmail
      });
      console.log(`✓ Real-time notification sent`);
    }

    return true; // Indicate that email was processed
  } catch (error) {
    console.error(`❌ Error processing Graph message ${message.id}:`, error.message);
    return false; // Indicate that email was not processed due to error
  }
}

/**
 * Fetch only emails received today from Outlook via Microsoft Graph API
 */
async function fetchTodaysOutlookMessages(userId, io) {
  if (!process.env.MS_GRAPH_CLIENT_ID || !process.env.MS_GRAPH_CLIENT_SECRET) {
    console.warn('⚠️ MS Graph credentials missing, skipping Graph API fetch.');
    return { processed: 0, skipped: 0, errors: 0 };
  }

  try {
    console.log(`\n📧 [Outlook-Graph-Today] Checking for new messages for ${userId}...`);

    let accessToken;
    try {
      accessToken = await getValidToken(userId);
    } catch (tokenErr) {
      console.warn(`⚠️ [Outlook-Graph-Today] ${tokenErr.message}`);
      return { processed: 0, skipped: 0, errors: 0 };
    }

    // Create Graph client with access token
    let client;
    try {
      client = getGraphClient(accessToken);
    } catch (clientError) {
      console.error('❌ Error creating Graph client:', clientError.message);
      await Token.deleteOne({ accountEmail: userId.toLowerCase() });
      throw new Error('Failed to create Graph client. Please re-authorize your account.');
    }

    // Get today's date in ISO format for filtering
    const todayISOString = getTodayDateISOString();
    
    // Fetch messages from today only
    // We'll get recent messages and filter by date on our end for precision
    let messages;
    try {
      // Get messages from the last 6 hours to focus on recent activity for real-time processing
      const sixHoursAgo = new Date();
      sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
      
      messages = await client.api(`/me/mailFolders/inbox/messages`)
        .filter(`receivedDateTime ge ${sixHoursAgo.toISOString()}`)
        .top(30) // Limit to 30 recent messages for faster processing
        .select('id,subject,from,receivedDateTime,hasAttachments,bodyPreview')
        .orderby('receivedDateTime DESC')
        .get();
    } catch (apiError) {
      console.error('❌ Error fetching messages from Graph API:', apiError.message);
      
      // If it's a 401 error, the token might have expired or been revoked
      if (apiError.statusCode === 401) {
        console.log('🔄 Attempting to refresh token and retry...');
        
        try {
          // Force refresh by deleting the stored token temporarily
          await Token.deleteOne({ accountEmail: userId.toLowerCase() });
          
          // Re-acquire token
          accessToken = await getValidToken(userId);
          
          // Create new client with fresh token
          client = getGraphClient(accessToken);
          
          // Retry the API call
          const sixHoursAgo = new Date();
          sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
          
          messages = await client.api(`/me/mailFolders/inbox/messages`)
            .filter(`receivedDateTime ge ${sixHoursAgo.toISOString()}`)
            .top(30)
            .select('id,subject,from,receivedDateTime,hasAttachments,bodyPreview')
            .orderby('receivedDateTime DESC')
            .get();
            
          console.log('✅ Successfully retried fetching messages after token refresh');
        } catch (retryError) {
          console.error('❌ Retry failed:', retryError.message);
          throw retryError;
        }
      } else {
        throw apiError;
      }
    }

    if (!messages.value || messages.value.length === 0) {
      console.log('📭 No recent messages found in Outlook inbox.');
      return { processed: 0, skipped: 0, errors: 0 };
    }

    // Filter messages to only include those received today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfToday = new Date(today);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const todaysMessages = messages.value.filter(msg => {
      const receivedDate = new Date(msg.receivedDateTime);
      return receivedDate >= today && receivedDate < endOfToday;
    });

    console.log(`✅ [Outlook-Graph-Today] Found ${todaysMessages.length} messages from today out of ${messages.value.length} recent messages.`);

    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const msg of todaysMessages) {
      try {
        const wasProcessed = await processGraphMessage(client, userId, msg, io);
        if (wasProcessed) {
          processedCount++;
        } else {
          skippedCount++;
        }
      } catch (msgError) {
        console.error(`❌ Error processing message ${msg.id}:`, msgError.message);
        errorCount++;
      }
    }

    console.log(`📊 [Outlook-Graph-Today] Processing complete: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors.`);

    return { processed: processedCount, skipped: skippedCount, errors: errorCount };
  } catch (error) {
    console.error('❌ Error in fetchTodaysOutlookMessages:', error.message || error);
    return { processed: 0, skipped: 0, errors: 1 };
  }
}

/**
 * Schedule daily fetch of today's emails
 */
function scheduleDailyEmailFetch(userId, io) {
  console.log('📅 Setting up real-time Outlook email fetch...');

  // Execute once immediately
  fetchTodaysOutlookMessages(userId, io).catch(err => {
    console.error('❌ Initial daily fetch error:', err.message);
  });

  // Set up interval to check every 2 minutes for real-time processing
  const interval = setInterval(async () => {
    try {
      const now = new Date();
      // Only run between 6 AM and 11 PM
      if (now.getHours() >= 6 && now.getHours() < 23) {
        console.log(`⏰ [${now.toLocaleTimeString()}] Running real-time Outlook email fetch...`);
        await fetchTodaysOutlookMessages(userId, io);
      }
    } catch (err) {
      console.error('❌ Real-time fetch error:', err.message);
    }
  }, 2 * 60 * 1000); // Every 2 minutes for immediate processing

  // Additionally, run at the start of each day
  const checkMidnight = setInterval(async () => {
    const now = new Date();
    // Check if it's the beginning of a new day (within 5 minutes of midnight)
    if (now.getHours() === 0 && now.getMinutes() < 5) {
      console.log(`🌙 [${now.toLocaleTimeString()}] New day detected, fetching today's emails...`);
      try {
        await fetchTodaysOutlookMessages(userId, io);
      } catch (err) {
        console.error('❌ Midnight fetch error:', err.message);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

  return { interval, checkMidnight };
}

module.exports = {
  fetchTodaysOutlookMessages,
  scheduleDailyEmailFetch,
  isEmailProcessedToday,
  markEmailAsProcessed
};