const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
require('dotenv').config();

const Email = require('../models/Resume');
const { extractResumeData } = require('./pdfParser');
const { checkDuplicateAndPrepare, linkResumeToCandidate } = require('./deduplicationService');
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
  // For personal Outlook (@outlook.com, etc.), MUST use 'common' - specific tenant blocks sign-in
  const isPersonalAccount = accountEmail && /@(outlook|hotmail|live)\.com$/i.test(accountEmail);
  return `https://login.microsoftonline.com/${isPersonalAccount ? 'common' : (process.env.MS_GRAPH_TENANT_ID || 'common')}`;
}

/**
 * Get the Authorization URL for the user to visit
 */
async function getAuthUrl(accountEmail = null) {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;
  
  // For personal Outlook (@outlook.com, @hotmail.com, @live.com), MUST use 'common'
  // A specific tenant ID blocks personal accounts from signing in
  const isPersonalAccount = accountEmail && /@(outlook|hotmail|live)\.com$/i.test(accountEmail);
  const authority = `https://login.microsoftonline.com/${isPersonalAccount ? 'common' : (process.env.MS_GRAPH_TENANT_ID || 'common')}`;
  
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
    // Pre-fill the email so user signs in with the account matching MS_GRAPH_USER_ID
    ...(accountEmail && { loginHint: accountEmail }),
    // Force prompt to ensure user sees consent screen and gets refresh token
    prompt: 'consent',  // Forces consent screen - CRITICAL for refresh token!
  };

  console.log('\n🔐 Generating OAuth Authorization URL...');
  console.log('   Authority:', authority);
  console.log('   Scopes requested:', authCodeUrlParameters.scopes.join(', '));
  console.log('   Redirect URI:', redirectUri);
  console.log('   Account email:', accountEmail || 'Not specified (user will choose)');
  console.log('   Is personal account:', isPersonalAccount ? 'Yes' : 'No/Unknown');
  console.log('   ⚠️  CRITICAL: "offline_access" scope IS included - required for refresh token!\n');

  const authUrl = await ccaForAuth.getAuthCodeUrl(authCodeUrlParameters);
  
  console.log('✅ Auth URL generated (length:', authUrl.length, 'chars)');
  console.log('   URL preview:', authUrl.substring(0, 150) + '...\n');
  
  return authUrl;
}

/**
 * Exchange Authorization Code for Tokens
 * MUST use /common for personal accounts - AADSTS70000121 if wrong authority used
 */
async function redeemCode(code) {
  const redirectUri = process.env.MS_GRAPH_REDIRECT_URI || 
    `http://localhost:${process.env.PORT || 5000}/api/outlook-auth/callback`;

  // Personal accounts REQUIRE /common - AADSTS70000121 otherwise. Default to common to support @outlook.com etc.
  const isPersonalAccount = process.env.MS_GRAPH_USER_ID && /@(outlook|hotmail|live)\.com$/i.test(process.env.MS_GRAPH_USER_ID);
  const authority = (isPersonalAccount || !process.env.MS_GRAPH_USER_ID)
    ? 'https://login.microsoftonline.com/common'
    : `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID || 'common'}`;
  const ccaForRedeem = new msal.ConfidentialClientApplication({
    auth: {
      clientId: process.env.MS_GRAPH_CLIENT_ID,
      authority,
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET,
    }
  });

  const tokenRequest = {
    code: code,
    scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Read.Shared'],
    redirectUri: redirectUri,
  };

  try {
    console.log('\n💡 Requesting token from Microsoft with authorization code...');
    console.log('   Authority URL:', authority);
    console.log('   Scopes:', tokenRequest.scopes.join(', '));
    console.log('   Code length:', tokenRequest.code?.length || 0);
    console.log('   Redirect URI:', redirectUri);
    
    const response = await ccaForRedeem.acquireTokenByCode(tokenRequest);

    console.log('\n🔍 === MICROSOFT OAuth Response Debug ===');
    console.log('Full response object keys:', Object.keys(response || {}));
    console.log('Response account:', response?.account);
    console.log('Response has accessToken:', !!response?.accessToken);
    console.log('Response has refreshToken:', !!response?.refreshToken);
    console.log('Response has idToken:', !!response?.idToken);
    console.log('Response fromCache:', response?.fromCache || false);
    console.log('Response expiresOn:', response?.expiresOn);
    console.log('Response extendsExpiry:', response?.extendsExpiry);
    console.log('Response refreshOn:', response?.refreshOn || 'Not set');
    console.log('Response extExpiresOn:', response?.extExpiresOn || 'Not set');
    
    // Check if response is from cache - this might mean old/different token
    if (response?.fromCache) {
      console.log('\n⚠️  WARNING: Token response is from CACHE!');
      console.log('   This might be from a previous authorization attempt.');
      console.log('   Cached responses may not include refresh tokens.');
      console.log('   Try clearing browser cache/cookies and re-authorizing in incognito mode.');
    }
    
    // Log refresh token if it exists
    if (response?.refreshToken) {
      console.log('\n✅ REFRESH TOKEN FOUND!');
      console.log('Refresh token length:', response.refreshToken.length);
      console.log('Refresh token preview:', response.refreshToken.substring(0, 50) + '...');
      console.log('Refresh token starts with:', response.refreshToken.substring(0, 20));
      console.log('\n🎉 This will enable automatic token refresh for 90 days!');
    } else {
      console.log('\n❌ REFRESH TOKEN NOT RETURNED BY MICROSOFT');
      console.log('This is WHY it\'s not being stored in MongoDB!');
      console.log('\n📋 CRITICAL CHECKLIST:');
      console.log('   1. Did you see ALL consent screens during login?');
      console.log('   2. Did you click "Yes, I trust this app" or similar?');
      console.log('   3. Was "offline_access" permission shown and granted?');
      console.log('   4. Are you using a personal @outlook.com account?');
      console.log('   5. Try again in incognito/private browsing mode\n');
      console.log('💡 SOLUTION: Delete token and re-authorize:');
      console.log('   node scripts/fix-missing-refresh-token.js');
      console.log('   Then visit: http://localhost:5000/api/outlook-auth/login\n');
    }
    console.log('=== End Debug ===\n');

    if (!response || !response.account || !response.accessToken) {
      throw new Error('Invalid token response from Microsoft Graph');
    }

    const accountEmail = response.account.username.toLowerCase();

    console.log(
      '✅ Outlook OAuth token acquired for',
      accountEmail,
      'refreshToken:',
      !!response.refreshToken,
      'expiresOn:',
      response.expiresOn
    );

    // Build token data, with sensible fallbacks for missing fields
    const tokenUpdate = {
      accessToken: response.accessToken,
      expiresAt: response.expiresOn || new Date(Date.now() + 50 * 60 * 1000),
      updatedAt: new Date()
    };

    if (response.refreshToken) {
      tokenUpdate.refreshToken = response.refreshToken;
      console.log('💾 Saving refresh token to MongoDB...');
    } else {
      console.warn('⚠️  NOT saving refresh token (Microsoft did not provide one)');
      console.warn('   Without refresh token, auto-refresh will NOT work after 1 hour!');
    }

    // Save or update token in DB
    const savedToken = await Token.findOneAndUpdate(
      { accountEmail },
      tokenUpdate,
      { upsert: true, new: true }
    );
    
    console.log('\n📦 MongoDB Token Document:');
    console.log('   accountEmail:', savedToken.accountEmail);
    console.log('   Has accessToken:', !!savedToken.accessToken);
    console.log('   Has refreshToken:', !!savedToken.refreshToken);
    console.log('   expiresAt:', savedToken.expiresAt);
    console.log('   _id:', savedToken._id, '\n');

    return accountEmail;
  } catch (error) {
    console.error('❌ Error redeeming Outlook code:', error.message);
    throw error;
  }
}

/**
 * Get a valid Access Token (refreshes if needed)
 * 
 * Token Lifecycle:
 * 1. Access Token valid for ~1 hour
 * 2. Refresh Token valid for 90 days
 * 3. Automatic refresh when access token expires
 * 4. No manual re-authorization needed unless refresh token expires
 */
async function getValidToken(accountEmail) {
  const tokenRecord = await Token.findOne({ accountEmail: accountEmail.toLowerCase() });
  
  if (!tokenRecord) {
    console.error(`❌ No token found for ${accountEmail}. User needs to authorize.`);
    throw new Error(`No token found for ${accountEmail}. Please authorize again.`);
  }

  // Validate required fields
  if (!tokenRecord.accessToken) {
    console.error(`❌ Token record for ${accountEmail} missing accessToken.`);
    await Token.deleteOne({ accountEmail: accountEmail.toLowerCase() });
    throw new Error(`Invalid token data for ${accountEmail}. Please re-authorize.`);
  }

  // Handle case where refreshToken is missing (fallback to access token only)
  if (!tokenRecord.refreshToken || !tokenRecord.expiresAt) {
    console.warn(
      `⚠️ Token for ${accountEmail} missing refreshToken or expiresAt. ` +
      'Using current access token; may need re-authorization soon.'
    );
    
    // If expiresAt is missing, assume 50 minutes from now
    if (!tokenRecord.expiresAt) {
      tokenRecord.expiresAt = new Date(Date.now() + 50 * 60 * 1000);
      tokenRecord.updatedAt = new Date();
      await tokenRecord.save().catch(e => {
        console.warn('⚠️ Failed to save synthetic expiresAt:', e.message);
      });
    }
    
    return tokenRecord.accessToken;
  }

  // Check if token is still valid (with 5-minute buffer before expiry)
  const now = new Date();
  const bufferTime = new Date(now.getTime() + 5 * 60 * 1000);
  
  if (tokenRecord.expiresAt > bufferTime) {
    // Token is still valid
    return tokenRecord.accessToken;
  }

  console.log(
    `🔄 Access token expired for ${accountEmail}. ` +
    `Expired at: ${tokenRecord.expiresAt.toISOString()}, Now: ${now.toISOString()}. ` +
    'Attempting automatic refresh with refresh token...'
  );

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
    
    if (!response || !response.accessToken) {
      throw new Error('Microsoft returned invalid token response');
    }
    
    // Update tokens in database
    tokenRecord.accessToken = response.accessToken;
    // Microsoft may rotate refresh tokens - always save the new one if provided
    if (response.refreshToken) {
      tokenRecord.refreshToken = response.refreshToken;
      console.log(`🔄 Refresh token rotated for ${accountEmail}`);
    }
    tokenRecord.expiresAt = response.expiresOn || new Date(Date.now() + 50 * 60 * 1000);
    tokenRecord.updatedAt = new Date();
    await tokenRecord.save();

    console.log(
      `✅ Token refreshed successfully for ${accountEmail}. ` +
      `New expiry: ${tokenRecord.expiresAt.toISOString()} ` +
      `(valid for ~${Math.floor((tokenRecord.expiresAt - new Date()) / 60000)} minutes)`
    );
    return response.accessToken;
  } catch (error) {
    console.error('❌ Error refreshing Outlook token:', error.message);
    console.error(`   Error Code: ${error.errorCode || 'N/A'}`);
    console.error(`   Status Code: ${error.statusCode || 'N/A'}`);
    
    // Check if refresh token has expired or been revoked
    const isRefreshTokenExpired = 
      error.errorCode === 'invalid_grant' ||
      error.message.includes('invalid_grant') ||
      error.message.includes('AADSTS70008') || // Refresh token expired
      error.message.includes('AADSTS50012') || // Invalid client secret
      error.message.includes('AADSTS70002') || // Invalid client credentials
      error.message.includes('AADSTS50173') || // Failed authentication
      error.statusCode === 401 ||
      error.statusCode === 403;

    if (isRefreshTokenExpired) {
      console.error(
        `❌ Refresh token for ${accountEmail} has expired or been revoked. ` +
        'This happens after 90 days of inactivity or if user revoked access. ' +
        'User MUST re-authorize.'
      );
      
      // Delete invalid token so user can re-authenticate
      await Token.deleteOne({ accountEmail: accountEmail.toLowerCase() });
      
      throw new Error(
        `Authentication expired for ${accountEmail}. ` +
        'Refresh token no longer valid. Please re-authorize your Microsoft account.'
      );
    }

    // For other errors, keep the old token in case it's still usable
    console.warn(
      `⚠️ Token refresh failed but keeping existing token. ` +
      'Will retry on next request.'
    );
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

  // Check if already processed (Redis removed, using DB only)
  const existingEmail = await Email.findOne({ emailId });
  if (existingEmail) {
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

    // Deduplication: same file (sha256) → skip save
    let dedup = null;
    if (hasAttachment && attachmentData) {
      dedup = await checkDuplicateAndPrepare(attachmentData.fileSha256, attachmentData);
      if (dedup.isDuplicate) {
        console.log(`⏭️ [Outlook-Graph] Duplicate resume (same file hash), skipping save. Existing ID: ${dedup.existingId}`);
        // Skip Redis marking - not used
        return;
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

    if (hasAttachment && attachmentData && dedup) {
      await linkResumeToCandidate(savedEmail, dedup.normalizedEmail, dedup.normalizedPhone);
    }

    // Mark as processed using emailService
    const emailService = getEmailService();
    if (emailService && emailService.markAsProcessed) {
      await emailService.markAsProcessed(emailId);
    }
    // Note: Redis service removed - not used in current implementation

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
