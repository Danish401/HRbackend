const imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
require('dotenv').config();

// Optional: Tesseract.js for OCR
let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('⚠️ tesseract.js not installed. OCR functionality will be disabled.');
  console.warn('   To enable OCR, run: npm install tesseract.js');
}

const Email = require('../models/Resume');
const { extractResumeData } = require('./pdfParser');
const { s3Client, bucketName } = require('../config/s3');
const { Upload } = require("@aws-sdk/lib-storage");
const redisService = require('./redisService');
const tnef = require('node-tnef');
const graphService = require('./graphService');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
fs.ensureDirSync(uploadsDir);

// IMAP configuration factory
const createImapConfig = (user, password, host, port) => {
  const imapHost = host || 'imap.gmail.com';
  return {
    imap: {
      user,
      password,
      host: imapHost,
      port: parseInt(port) || 993,
      tls: true,
      tlsOptions: { 
        rejectUnauthorized: false,
        servername: imapHost // Required for some servers like Outlook
      },
      authTimeout: 20000,
      connTimeout: 20000,
      // debug: console.log, // Uncomment for raw IMAP traffic
      keepalive: {
        interval: 10000,
        idleInterval: 300000,
        forceNoop: true
      }
    }
  };
};

let monitoringInstances = [];

// Store processed email UIDs (in-memory fallback)
const processedEmails = new Set();

// Initialize Redis on module load
redisService.initializeRedis().catch(err => {
  console.warn('⚠️ Redis initialization failed, will use in-memory fallback:', err.message);
});

/**
 * Main function to process emails for a specific connection
 */
async function processEmail(connection, io, accountName = 'Primary') {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const formatDate = (date) => {
      const day = date.getDate().toString().padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[date.getMonth()];
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };

    const todayStr = formatDate(today);
    console.log(`\n📧 [${accountName}] Searching for emails from today: ${todayStr}...`);

    let messages = [];

    // Try optimized fetch first (sequence-based)
    try {
      messages = await fetchEmailsBySequence(connection);
    } catch (error) {
      console.error(`❌ Sequence fetch failed: ${error.message}`);
      // Fallback to search-based method
      try {
        console.log('🔄 Falling back to search-based method...');
        messages = await fetchEmailsBySearch(connection);
      } catch (fallbackError) {
        console.error(`❌ Fallback search also failed: ${fallbackError.message}`);
        console.error('\nPossible issues:');
        console.error('  - IMAP server not responding');
        console.error('  - Network connectivity issues');
        console.error('  - Gmail rate limiting (wait a few minutes)');
        return;
      }
    }

    if (!messages || messages.length === 0) {
      console.log(`\n❌ No emails found in inbox.\n`);
      return;
    }

    // Filter messages to today only
    messages = filterEmailsByDate(messages, today);

    if (messages.length === 0) {
      console.log(`\n❌ No emails found from today (${todayStr}).\n`);
      return;
    }

    console.log(`\n✅ [${accountName}] Found ${messages.length} email(s) from today`);
    console.log(`\n🚀 [${accountName}] Processing today's emails...\n`);

    // Process each message
    for (const message of messages) {
      await processIndividualEmail(message, connection, io, accountName);
    }

  } catch (error) {
    console.error('❌ Error in processEmail:', error.message);
    console.error(error.stack);
  }
}

/**
 * Fetch emails using sequence numbers (faster, bypasses Gmail search throttling)
 */
async function fetchEmailsBySequence(connection) {
  console.log('📥 Fetching last 20 emails by sequence number...');

  // Get inbox info
  let box;
  try {
    box = await connection.openBox('INBOX', true);
  } catch (error) {
    // Box might already be open
    if (connection._box) {
      box = connection._box;
    } else {
      throw new Error('Cannot access inbox: ' + error.message);
    }
  }

  const totalMessages = box.messages.total;
  console.log(`✓ Inbox has ${totalMessages} total message(s)`);

  if (totalMessages === 0) {
    return [];
  }

  // Calculate sequence range for last 20 emails
  const fetchCount = Math.min(20, totalMessages);
  const startSeq = Math.max(1, totalMessages - fetchCount + 1);
  const endSeq = totalMessages;

  console.log(`  Fetching sequence ${startSeq}:${endSeq} (last ${fetchCount} emails)`);

  // Use search with UID to get the messages
  // This is more reliable than accessing raw IMAP connection
  const searchCriteria = ['ALL'];
  const fetchOptions = {
    bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', ''],
    struct: true
  };

  const allMessages = await connection.search(searchCriteria, fetchOptions);
  
  // Get last 20 messages
  const recentMessages = allMessages.slice(-20);
  
  console.log(`✓ Fetched ${recentMessages.length} recent email(s)`);
  
  return recentMessages;
}

/**
 * Fallback: Fetch emails using IMAP search
 */
async function fetchEmailsBySearch(connection) {
  console.log('📥 Fetching emails using IMAP search...');

  const searchCriteria = ['ALL'];
  const fetchOptions = {
    bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', ''],
    struct: true
  };

  const messages = await Promise.race([
    connection.search(searchCriteria, fetchOptions),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Search timeout')), 30000)
    )
  ]);

  // Get last 20 only
  return messages.slice(-20);
}

/**
 * Filter emails to only include today's emails
 */
function filterEmailsByDate(messages, today) {
  console.log(`\n🔍 Filtering ${messages.length} emails for today's date...`);

  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  return messages.filter(msg => {
    try {
      let emailDate = null;

      // Try to get date from different sources
      if (msg.attributes.date) {
        emailDate = new Date(msg.attributes.date);
      } else if (msg.attributes.envelope && msg.attributes.envelope.date) {
        emailDate = new Date(msg.attributes.envelope.date);
      }

      // Parse date from headers if not in attributes
      if (!emailDate || isNaN(emailDate.getTime())) {
        const headers = msg.parts.find(p => p.which === 'HEADER.FIELDS (FROM TO SUBJECT DATE)');
        if (headers && headers.body) {
          const dateMatch = headers.body.match(/Date: (.+)/i);
          if (dateMatch) {
            emailDate = new Date(dateMatch[1]);
          }
        }
      }

      if (!emailDate || isNaN(emailDate.getTime())) {
        console.log(`  ⚠️ Email UID ${msg.attributes.uid} has no valid date, including it`);
        return true;
      }

      // Compare dates (ignore time)
      const emailDateOnly = new Date(
        emailDate.getFullYear(),
        emailDate.getMonth(),
        emailDate.getDate()
      );

      const isToday = emailDateOnly.getTime() === todayDateOnly.getTime();

      if (isToday) {
        const subject = msg.attributes.envelope?.subject || 
                       msg.attributes.subject || 
                       'No Subject';
        console.log(`  ✓ UID ${msg.attributes.uid}: ${emailDate.toLocaleDateString()} - "${subject}"`);
      }

      return isToday;
    } catch (err) {
      console.log(`  ⚠️ Error checking date for UID ${msg.attributes.uid}: ${err.message}`);
      return true; // Include on error
    }
  });
}

/**
 * Process individual email message
 */
async function processIndividualEmail(message, connection, io, accountName = 'Primary') {
  const uid = message.attributes.uid;

  // Check if already processed
  if (processedEmails.has(uid)) {
    console.log(`⏭️  [${accountName}] Email UID ${uid} already processed (in-memory), skipping...`);
    return;
  }

  try {
    const isProcessed = await redisService.isEmailProcessed(uid);
    if (isProcessed) {
      console.log(`⏭️  [${accountName}] Email UID ${uid} already processed (Redis), skipping...`);
      processedEmails.add(uid);
      return;
    }
  } catch (error) {
    console.log(`⚠️  [${accountName}] Redis check failed for UID ${uid}, continuing...`);
  }

  try {
    // Extract basic info from message
    const envelope = message.attributes.envelope || {};
    const subject = envelope.subject || 'No Subject';
    const from = envelope.from?.[0];
    const fromEmail = from?.address || 'unknown@example.com';
    const fromName = from?.name || fromEmail;
    const emailDate = message.attributes.date || new Date();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📨 [${accountName}] Processing Email UID ${uid}`);
    console.log(`   From: ${fromName} <${fromEmail}>`);
    console.log(`   Subject: "${subject}"`);
    console.log(`   Date: ${new Date(emailDate).toLocaleString()}`);
    console.log(`${'='.repeat(80)}`);

    // Fetch full email body
    console.log(`📥 [${accountName}] Fetching full email content...`);
    
    const fullMessages = await connection.search([['UID', uid]], {
      bodies: [''],
      struct: true
    });

    if (!fullMessages || fullMessages.length === 0) {
      console.error(`❌ Could not fetch email body for UID ${uid}`);
      await markAsProcessed(uid);
      return;
    }

    const fullMessage = fullMessages[0];
    
    // Get email body
    let emailBody = null;
    const bodyPart = fullMessage.parts.find(p => p.which === '');
    
    if (bodyPart && bodyPart.body) {
      emailBody = bodyPart.body;
    } else {
      // Try to get body using getPartData
      const parts = imap.getParts(fullMessage.attributes.struct);
      if (parts && parts.length > 0) {
        const textPart = parts.find(p => p.type === 'text' && p.subtype === 'plain') || parts[0];
        emailBody = await connection.getPartData(fullMessage, textPart);
      }
    }

    if (!emailBody) {
      console.error(`❌ Could not extract email body for UID ${uid}`);
      await markAsProcessed(uid);
      return;
    }

    // Ensure emailBody is a Buffer
    if (!Buffer.isBuffer(emailBody)) {
      emailBody = Buffer.from(emailBody);
    }

    console.log(`✓ Email body fetched (${emailBody.length} bytes)`);

    // Process email content
    await processEmailContent(emailBody, uid, subject, fromEmail, fromName, emailDate, io, accountName);

  } catch (error) {
    console.error(`❌ Error processing email UID ${uid}:`, error.message);
    console.error(error.stack);
  }
}

/**
 * Process email content (parse, extract attachments, save to DB)
 */
async function processEmailContent(emailData, uid, subject, fromEmail, fromName, emailDate, io, accountName = 'Primary') {
  try {
    // Parse email
    const parsed = await simpleParser(emailData);
    console.log(`✓ Email parsed successfully`);
    console.log(`  Attachments: ${parsed.attachments?.length || 0}`);

    // Extract email body text
    let emailBodyText = parsed.text || 
                        parsed.textAsHtml?.replace(/<[^>]*>/g, '').trim() ||
                        parsed.html?.replace(/<[^>]*>/g, '').trim() ||
                        '(No content)';

    emailBodyText = emailBodyText.replace(/\n{3,}/g, '\n\n').trim();
    console.log(`  Body length: ${emailBodyText.length} characters`);

    // Check for existing email in database
    const emailId = `uid_${uid}`;
    const existingEmail = await Email.findOne({ emailId });

    if (existingEmail) {
      console.log(`⚠️ Email UID ${uid} already exists in database`);
      await markAsProcessed(uid);
      return;
    }

    // Process attachments (including potential winmail.dat/TNEF)
    let attachments = parsed.attachments || [];
    
    // Handle Outlook's winmail.dat (TNEF)
    const tnefAttachment = attachments.find(a => 
      a.filename === 'winmail.dat' || a.contentType === 'application/ms-tnef'
    );
    
    if (tnefAttachment) {
      console.log(`📦 [${accountName}] Found winmail.dat (TNEF) attachment, extracting...`);
      try {
        const tnefData = tnef.parseBuffer(tnefAttachment.content);
        if (tnefData && tnefData.Attachments) {
          console.log(`✓ [${accountName}] Extracted ${tnefData.Attachments.length} file(s) from winmail.dat`);
          for (const tnefFile of tnefData.Attachments) {
            // Check if it's a PDF
            const filename = tnefFile.Title || 'attachment.pdf';
            if (filename.toLowerCase().endsWith('.pdf')) {
              attachments.push({
                filename: filename,
                content: tnefFile.Data,
                contentType: 'application/pdf'
              });
            }
          }
        }
      } catch (tnefError) {
        console.error(`❌ [${accountName}] Error parsing winmail.dat:`, tnefError.message);
      }
    }

    // Process PDF attachments
    let attachmentData = null;
    let hasAttachment = false;

    if (attachments.length > 0) {
      console.log(`\n📎 [${accountName}] Found ${attachments.length} attachment(s) (including extracted)`);

      for (const attachment of attachments) {
        const filename = attachment.filename || 'attachment.pdf';
        const contentType = attachment.contentType || '';
        const isPdf = contentType === 'application/pdf' || 
                     filename.toLowerCase().endsWith('.pdf');

        if (filename === 'winmail.dat') continue; // Skip the container

        console.log(`\n  📎 ${filename}`);
        console.log(`     Type: ${contentType}`);
        console.log(`     Size: ${attachment.size || attachment.content?.length || 'unknown'} bytes`);
        console.log(`     PDF: ${isPdf ? '✅' : '❌'}`);

        if (isPdf) {
          hasAttachment = true;
          attachmentData = await processPdfAttachment(attachment, filename, accountName);
          break; // Process only first PDF
        }
      }
    }

    // Save to database
    console.log(`\n💾 Saving email to MongoDB...`);

    const email = new Email({
      from: fromEmail,
      fromName: fromName,
      subject: subject || 'No Subject',
      body: emailBodyText,
      receivedAt: emailDate,
      emailId: emailId,
      hasAttachment: hasAttachment,
      attachmentData: attachmentData || undefined
    });

    const savedEmail = await email.save();
    console.log(`✅ Email saved successfully!`);
    console.log(`   MongoDB ID: ${savedEmail._id}`);

    if (hasAttachment && attachmentData) {
      console.log(`\n✅ PDF data extracted:`);
      console.log(`   Name: ${attachmentData.name || 'N/A'}`);
      console.log(`   Email: ${attachmentData.email || 'N/A'}`);
      console.log(`   Contact: ${attachmentData.contactNumber || 'N/A'}`);
      console.log(`   DOB: ${attachmentData.dateOfBirth || 'N/A'}`);
      console.log(`   S3: ${attachmentData.s3Url ? '✅' : '❌'}`);
    }

    // Mark as processed
    await markAsProcessed(uid);

    // Emit real-time notification
    if (io) {
      io.emit('newEmail', {
        message: hasAttachment ? 
          'New email with PDF attachment received!' : 
          'New email received!',
        email: savedEmail
      });
      console.log(`✓ Real-time notification sent`);
    }

  } catch (error) {
    console.error(`❌ Error processing email content:`, error.message);
    console.error(error.stack);
    throw error;
  }
}

/**
 * Process PDF attachment
 */
async function processPdfAttachment(attachment, filename, accountName = 'Primary') {
  console.log(`\n🔧 [${accountName}] Processing PDF: ${filename}`);

  try {
    // Convert attachment to Buffer
    let pdfContent = attachment.content;
    
    if (!Buffer.isBuffer(pdfContent)) {
      if (pdfContent instanceof Uint8Array) {
        pdfContent = Buffer.from(pdfContent);
      } else if (typeof pdfContent === 'string') {
        pdfContent = Buffer.from(pdfContent, 'base64');
      } else {
        pdfContent = Buffer.from(pdfContent);
      }
    }

    console.log(`  [${accountName}] PDF buffer size: ${pdfContent.length} bytes`);

    // Upload to AWS S3
    let s3Url = null;
    let s3Key = null;

    if (process.env.AWS_ACCESS_KEY_ID && 
        process.env.AWS_SECRET_ACCESS_KEY && 
        process.env.AWS_REGION && 
        process.env.AWS_S3_BUCKET_NAME) {
      
      console.log(`  ☁️  [${accountName}] Uploading to AWS S3...`);

      try {
        const timestamp = Date.now();
        const sanitizedFilename = filename
          .replace(/[^a-zA-Z0-9.-]/g, '_');

        s3Key = `resumes/${timestamp}_${sanitizedFilename}`;

        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: bucketName,
            Key: s3Key,
            Body: pdfContent,
            ContentType: 'application/pdf',
          },
        });

        const result = await upload.done();
        s3Url = result.Location;

        console.log(`  ✅ [${accountName}] Uploaded to AWS S3`);
        console.log(`     URL: ${s3Url}`);
      } catch (s3Error) {
        console.error(`  ❌ [${accountName}] AWS S3 upload failed: ${s3Error.message}`);
      }
    } else {
      console.log(`  ⚠️  [${accountName}] AWS S3 not configured, saving locally`);
    }

    // Save locally as fallback
    let localPath = null;
    if (!s3Url) {
      const timestamp = Date.now();
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const pdfFilename = `${timestamp}_${sanitizedFilename}`;
      localPath = path.join(uploadsDir, pdfFilename);
      await fs.writeFile(localPath, pdfContent);
      console.log(`  ✓ [${accountName}] Saved locally: ${pdfFilename}`);
    }

    // Extract text from PDF
    console.log(`  📄 [${accountName}] Extracting text from PDF...`);
    let extractedText = '';

    try {
      const pdfData = await pdfParse(pdfContent);
      extractedText = pdfData.text || '';
      console.log(`  ✅ [${accountName}] Extracted ${extractedText.length} characters`);
    } catch (parseError) {
      console.log(`  ⚠️  [${accountName}] pdf-parse failed: ${parseError.message}`);

      // Try OCR if available
      if (Tesseract && extractedText.length < 50) {
        console.log(`  🔍 [${accountName}] Attempting OCR...`);
        try {
          const { data: { text } } = await Tesseract.recognize(pdfContent, 'eng');
          if (text && text.trim().length > 0) {
            extractedText = text;
            console.log(`  ✅ [${accountName}] OCR extracted ${extractedText.length} characters`);
          }
        } catch (ocrError) {
          console.error(`  ❌ [${accountName}] OCR failed: ${ocrError.message}`);
        }
      }
    }

    // Extract structured data
    console.log(`  🔍 [${accountName}] Extracting structured data...`);
    const extractedData = extractResumeData(extractedText);

    console.log(`  ✓ [${accountName}] Extracted:`);
    console.log(`     Name: ${extractedData.name || 'N/A'}`);
    console.log(`     Email: ${extractedData.email || 'N/A'}`);
    console.log(`     Contact: ${extractedData.contactNumber || 'N/A'}`);
    console.log(`     DOB: ${extractedData.dateOfBirth || 'N/A'}`);

    return {
      ...extractedData,
      s3Url: s3Url || null,
      s3Key: s3Key || null,
      pdfPath: s3Url || localPath,
      rawText: extractedText.substring(0, 5000)
    };

  } catch (error) {
    console.error(`  ❌ [${accountName}] Error processing PDF: ${error.message}`);
    throw error;
  }
}

/**
 * Mark email as processed
 */
async function markAsProcessed(uid) {
  try {
    await redisService.markEmailProcessed(uid);
    processedEmails.add(uid);
  } catch (error) {
    console.warn(`⚠️ Could not mark UID ${uid} in Redis: ${error.message}`);
    processedEmails.add(uid); // At least mark in memory
  }
}

/**
 * Start email monitoring for all configured accounts
 */
async function startMonitoring(io) {
  console.log('\n🚀 Initializing email monitoring...');
  
  const configs = [];
  
  // Primary/Gmail Account
  if (process.env.IMAP_USER && process.env.IMAP_PASSWORD) {
    configs.push({
      name: 'Primary',
      config: createImapConfig(
        process.env.IMAP_USER,
        process.env.IMAP_PASSWORD,
        process.env.IMAP_HOST,
        process.env.IMAP_PORT
      )
    });
  }

  // Outlook/Microsoft Account
  if (process.env.OUTLOOK_USER && process.env.OUTLOOK_PASSWORD) {
    configs.push({
      name: 'Outlook',
      config: createImapConfig(
        process.env.OUTLOOK_USER,
        process.env.OUTLOOK_PASSWORD,
        process.env.OUTLOOK_HOST || 'outlook.office365.com',
        process.env.OUTLOOK_PORT || 993
      )
    });
  }

  if (configs.length === 0) {
    console.error('❌ No IMAP accounts configured! Please check your .env file.');
    return;
  }

  // Start each account monitoring with timeout protection (non-blocking)
  for (const account of configs) {
    // Don't await - start them in parallel and continue
    startAccountMonitoringWithTimeout(account, io);
  }

  // Also start Microsoft Graph API polling if configured (non-blocking)
  if (process.env.MS_GRAPH_CLIENT_ID && process.env.MS_GRAPH_CLIENT_SECRET && process.env.MS_GRAPH_USER_ID) {
    console.log(`\n🚀 [Outlook-Graph] Starting Microsoft Graph API polling...`);
    
    const pollInterval = setInterval(async () => {
      try {
        await graphService.fetchOutlookMessages(process.env.MS_GRAPH_USER_ID, io);
      } catch (err) {
        console.error('❌ [Outlook-Graph] Polling error:', err.message);
      }
    }, 5 * 60 * 1000); // Poll every 5 minutes

    monitoringInstances.push({
      name: 'Outlook-Graph',
      stop: async () => {
        clearInterval(pollInterval);
      }
    });

    // Run initial fetch immediately (non-blocking)
    setImmediate(() => {
      graphService.fetchOutlookMessages(process.env.MS_GRAPH_USER_ID, io).catch(err => {
        console.error('❌ [Outlook-Graph] Initial fetch error:', err.message);
      });
    });
  }
  
  console.log('✅ Email monitoring initialization completed (connections starting in background)');
}

/**
 * Start monitoring for a specific account (with timeout protection)
 */
async function startAccountMonitoringWithTimeout(account, io) {
  const { name } = account;
  const timeout = 30000; // 30 second timeout for connection
  
  console.log(`\n🚀 [${name}] Initializing account monitoring...`);
  
  const connectionTimeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Connection timeout')), timeout)
  );
  
  try {
    await Promise.race([
      startAccountMonitoring(account, io),
      connectionTimeout
    ]);
  } catch (err) {
    console.error(`\n❌ [${name}] Failed to start monitoring (non-fatal):`, err.message);
    console.log(`   [${name}] Server will continue without this account`);
    
    // Retry after 60 seconds (in background)
    setTimeout(() => {
      console.log(`\n🔄 [${name}] Retrying connection...`);
      startAccountMonitoringWithTimeout(account, io);
    }, 60000);
  }
}

/**
 * Start monitoring for a specific account
 */
async function startAccountMonitoring(account, io) {
  const { name, config } = account;
  
  try {
    console.log(`\n🔄 [${name}] Connecting to IMAP server...`);
    console.log(`   Host: ${config.imap.host}`);
    console.log(`   User: ${config.imap.user}`);

    const connection = await imap.connect(config);
    let isConnected = true;

    const instance = {
      name,
      connection,
      checkInterval: null,
      stop: async () => {
        if (instance.checkInterval) clearInterval(instance.checkInterval);
        if (connection) await connection.end();
        isConnected = false;
      }
    };

    monitoringInstances.push(instance);

    // Set up error handlers
    connection.on('error', (err) => {
      console.error(`\n❌ [${name}] IMAP connection error:`, err.message);
      isConnected = false;
    });

    connection.on('end', () => {
      console.warn(`\n⚠️  [${name}] IMAP connection ended`);
      isConnected = false;
    });

    // Open inbox
    await connection.openBox('INBOX', true);
    console.log(`✅ [${name}] Connected successfully\n`);

    // Process existing emails
    await processEmail(connection, io, name);

    // Set up periodic checking (every 5 minutes)
    const CHECK_INTERVAL = 5 * 60 * 1000;
    instance.checkInterval = setInterval(async () => {
      if (!isConnected) return;
      console.log(`\n⏰ [${name}] Scheduled email check...`);
      try {
        await processEmail(connection, io, name);
      } catch (err) {
        console.error(`❌ [${name}] Scheduled check failed:`, err.message);
      }
    }, CHECK_INTERVAL);

    // Listen for new emails
    connection.on('mail', async () => {
      console.log(`\n📬 [${name}] New email detected!`);
      try {
        await processEmail(connection, io, name);
      } catch (error) {
        console.error(`❌ [${name}] Error processing new email:`, error.message);
      }
    });

  } catch (error) {
    console.error(`\n❌ [${name}] Failed to start monitoring:`, error.message);
    if (error.source === 'authentication' || error.message.includes('LOGIN failed')) {
      console.log(`   Detailed Error: ${JSON.stringify(error)}`);
    }
    
    // Provide helpful error messages for login failures
    if (error.message.includes('LOGIN failed') || error.message.includes('authenticate') || error.message.includes('Invalid credentials')) {
      console.error(`\n💡 [${name}] Authentication failed. Please check:`);
      if (name === 'Outlook') {
        console.error('   1. Ensure IMAP is enabled in Outlook settings (Settings > Mail > Sync email)');
        console.error('   2. If Two-Factor Authentication is ON, you MUST use an "App Password", not your regular password.');
        console.error('   3. Go to Microsoft Account Security > Advanced security options to create an App Password.');
        console.error('   4. If this is a personal account, try changing OUTLOOK_HOST to imap-mail.outlook.com');
      } else {
        console.error(`   - Check ${name === 'Primary' ? 'IMAP_USER and IMAP_PASSWORD' : 'credentials'} in .env`);
        console.error('   - For Gmail: Use an App Password (not your regular password).');
      }
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
      console.error(`\n💡 [${name}] Connection issue: Check host/port settings and internet connection.`);
    }
  }
}

/**
 * Stop email monitoring for all accounts
 */
async function stopMonitoring() {
  console.log('\n🛑 Stopping all email monitoring...');
  for (const instance of monitoringInstances) {
    try {
      await instance.stop();
      console.log(`✅ [${instance.name}] Stopped`);
    } catch (err) {
      console.error(`⚠️  [${instance.name}] Error stopping:`, err.message);
    }
  }
  monitoringInstances = [];
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  processPdfAttachment,
  markAsProcessed
};
