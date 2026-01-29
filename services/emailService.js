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
const cloudinary = require('../config/cloudinary');
const redisService = require('./redisService');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
fs.ensureDirSync(uploadsDir);

// IMAP configuration with proper settings
const imapConfig = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT) || 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 20000,
    connTimeout: 20000,
    keepalive: {
      interval: 10000,
      idleInterval: 300000,
      forceNoop: true
    }
  }
};

let isMonitoring = false;
let connection = null;
let checkInterval = null;

// Store processed email UIDs (in-memory fallback)
const processedEmails = new Set();

// Initialize Redis on module load
redisService.initializeRedis().catch(err => {
  console.warn('⚠️ Redis initialization failed, will use in-memory fallback:', err.message);
});

/**
 * Main function to process emails
 */
async function processEmail(connection, io) {
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
    console.log(`\n📧 Searching for emails from today: ${todayStr}...`);

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

    console.log(`\n✅ Found ${messages.length} email(s) from today`);
    console.log(`\n🚀 Processing today's emails...\n`);

    // Process each message
    for (const message of messages) {
      await processIndividualEmail(message, connection, io);
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
async function processIndividualEmail(message, connection, io) {
  const uid = message.attributes.uid;

  // Check if already processed
  if (processedEmails.has(uid)) {
    console.log(`⏭️  Email UID ${uid} already processed (in-memory), skipping...`);
    return;
  }

  try {
    const isProcessed = await redisService.isEmailProcessed(uid);
    if (isProcessed) {
      console.log(`⏭️  Email UID ${uid} already processed (Redis), skipping...`);
      processedEmails.add(uid);
      return;
    }
  } catch (error) {
    console.log(`⚠️ Redis check failed for UID ${uid}, continuing...`);
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
    console.log(`📨 Processing Email UID ${uid}`);
    console.log(`   From: ${fromName} <${fromEmail}>`);
    console.log(`   Subject: "${subject}"`);
    console.log(`   Date: ${new Date(emailDate).toLocaleString()}`);
    console.log(`${'='.repeat(80)}`);

    // Fetch full email body
    console.log(`📥 Fetching full email content...`);
    
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
    await processEmailContent(emailBody, uid, subject, fromEmail, fromName, emailDate, io);

  } catch (error) {
    console.error(`❌ Error processing email UID ${uid}:`, error.message);
    console.error(error.stack);
  }
}

/**
 * Process email content (parse, extract attachments, save to DB)
 */
async function processEmailContent(emailData, uid, subject, fromEmail, fromName, emailDate, io) {
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

    // Process PDF attachments
    let attachmentData = null;
    let hasAttachment = false;

    if (parsed.attachments && parsed.attachments.length > 0) {
      console.log(`\n📎 Found ${parsed.attachments.length} attachment(s)`);

      for (const attachment of parsed.attachments) {
        const filename = attachment.filename || 'attachment.pdf';
        const contentType = attachment.contentType || '';
        const isPdf = contentType === 'application/pdf' || 
                     filename.toLowerCase().endsWith('.pdf');

        console.log(`\n  📎 ${filename}`);
        console.log(`     Type: ${contentType}`);
        console.log(`     Size: ${attachment.size || attachment.content?.length || 'unknown'} bytes`);
        console.log(`     PDF: ${isPdf ? '✅' : '❌'}`);

        if (isPdf) {
          hasAttachment = true;
          attachmentData = await processPdfAttachment(attachment, filename);
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
      console.log(`   Cloudinary: ${attachmentData.cloudinaryUrl ? '✅' : '❌'}`);
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
async function processPdfAttachment(attachment, filename) {
  console.log(`\n🔧 Processing PDF: ${filename}`);

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

    console.log(`  PDF buffer size: ${pdfContent.length} bytes`);

    // Upload to Cloudinary
    let cloudinaryUrl = null;
    let cloudinaryPublicId = null;

    if (process.env.CLOUDINARY_CLOUD_NAME && 
        process.env.CLOUDINARY_API_KEY && 
        process.env.CLOUDINARY_API_SECRET) {
      
      console.log(`  ☁️  Uploading to Cloudinary...`);

      try {
        const timestamp = Date.now();
        const sanitizedFilename = filename
          .replace(/[^a-zA-Z0-9.-]/g, '_')
          .replace(/\.pdf$/i, '');

        const cloudinaryFilename = `resumes/${timestamp}_${sanitizedFilename}`;

        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              resource_type: 'raw',
              folder: 'resumes',
              public_id: cloudinaryFilename,
              format: 'pdf',
              type: 'upload',
              access_mode: 'public'
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(pdfContent);
        });

        cloudinaryUrl = result.secure_url || result.url;
        cloudinaryPublicId = result.public_id;

        console.log(`  ✅ Uploaded to Cloudinary`);
        console.log(`     URL: ${cloudinaryUrl}`);
      } catch (cloudinaryError) {
        console.error(`  ❌ Cloudinary upload failed: ${cloudinaryError.message}`);
      }
    } else {
      console.log(`  ⚠️  Cloudinary not configured, saving locally`);
    }

    // Save locally as fallback
    let localPath = null;
    if (!cloudinaryUrl) {
      const timestamp = Date.now();
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const pdfFilename = `${timestamp}_${sanitizedFilename}`;
      localPath = path.join(uploadsDir, pdfFilename);
      await fs.writeFile(localPath, pdfContent);
      console.log(`  ✓ Saved locally: ${pdfFilename}`);
    }

    // Extract text from PDF
    console.log(`  📄 Extracting text from PDF...`);
    let extractedText = '';

    try {
      const pdfData = await pdfParse(pdfContent);
      extractedText = pdfData.text || '';
      console.log(`  ✅ Extracted ${extractedText.length} characters`);
    } catch (parseError) {
      console.log(`  ⚠️  pdf-parse failed: ${parseError.message}`);

      // Try OCR if available
      if (Tesseract && extractedText.length < 50) {
        console.log(`  🔍 Attempting OCR...`);
        try {
          const { data: { text } } = await Tesseract.recognize(pdfContent, 'eng');
          if (text && text.trim().length > 0) {
            extractedText = text;
            console.log(`  ✅ OCR extracted ${extractedText.length} characters`);
          }
        } catch (ocrError) {
          console.error(`  ❌ OCR failed: ${ocrError.message}`);
        }
      }
    }

    // Extract structured data
    console.log(`  🔍 Extracting structured data...`);
    const extractedData = extractResumeData(extractedText);

    console.log(`  ✓ Extracted:`);
    console.log(`     Name: ${extractedData.name || 'N/A'}`);
    console.log(`     Email: ${extractedData.email || 'N/A'}`);
    console.log(`     Contact: ${extractedData.contactNumber || 'N/A'}`);
    console.log(`     DOB: ${extractedData.dateOfBirth || 'N/A'}`);

    return {
      name: extractedData.name || '',
      email: extractedData.email || '',
      contactNumber: extractedData.contactNumber || '',
      dateOfBirth: extractedData.dateOfBirth || '',
      experience: extractedData.experience || '',
      role: extractedData.role || '',
      cloudinaryUrl: cloudinaryUrl || null,
      cloudinaryPublicId: cloudinaryPublicId || null,
      pdfPath: cloudinaryUrl || localPath,
      rawText: extractedText.substring(0, 5000)
    };

  } catch (error) {
    console.error(`  ❌ Error processing PDF: ${error.message}`);
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
 * Start email monitoring
 */
async function startMonitoring(io) {
  if (isMonitoring) {
    console.log('⚠️ Email monitoring already running');
    return;
  }

  try {
    // Validate configuration
    if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      console.error('❌ IMAP credentials not configured!');
      console.error('   Please set IMAP_USER and IMAP_PASSWORD in .env file');
      return;
    }

    console.log('\n🔄 Connecting to IMAP server...');
    console.log(`   Host: ${imapConfig.imap.host}`);
    console.log(`   Port: ${imapConfig.imap.port}`);
    console.log(`   User: ${imapConfig.imap.user}`);

    // Connect
    connection = await imap.connect(imapConfig);

    // Set up error handlers
    connection.on('error', (err) => {
      console.error('\n❌ IMAP connection error:', err.message);
      isMonitoring = false;
      
      // Attempt reconnection after delay
      setTimeout(() => {
        if (!isMonitoring) {
          console.log('🔄 Attempting to reconnect...');
          startMonitoring(io).catch(console.error);
        }
      }, 30000);
    });

    connection.on('end', () => {
      console.warn('\n⚠️ IMAP connection ended');
      isMonitoring = false;
    });

    // Open inbox
    await connection.openBox('INBOX', true);
    
    console.log('✅ Connected to IMAP server successfully\n');
    isMonitoring = true;

    // Process existing emails
    console.log('📧 Processing existing emails from today...');
    await processEmail(connection, io);

    // Set up periodic checking (every 5 minutes)
    const CHECK_INTERVAL = 5 * 60 * 1000;
    checkInterval = setInterval(async () => {
      if (!isMonitoring || !connection) return;

      console.log('\n⏰ Scheduled email check...');
      try {
        await processEmail(connection, io);
      } catch (err) {
        console.error('❌ Scheduled check failed:', err.message);
      }
    }, CHECK_INTERVAL);

    // Listen for new emails
    connection.on('mail', async () => {
      console.log('\n📬 New email detected!');
      try {
        await processEmail(connection, io);
      } catch (error) {
        console.error('❌ Error processing new email:', error.message);
      }
    });

    console.log('✅ Email monitoring started successfully');
    console.log(`   Checking every ${CHECK_INTERVAL / 60000} minutes`);
    console.log('   Listening for new emails in real-time\n');

  } catch (error) {
    console.error('\n❌ Failed to start email monitoring:', error.message);
    
    // Provide helpful error messages
    if (error.code === 'ENOTFOUND') {
      console.error('\n💡 DNS resolution failed. Check:');
      console.error('   - Internet connection');
      console.error('   - IMAP_HOST setting in .env');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Connection refused. Check:');
      console.error('   - IMAP server accessibility');
      console.error('   - Firewall settings');
      console.error('   - IMAP_PORT setting in .env');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('\n💡 Connection timeout. Check:');
      console.error('   - Network connectivity');
      console.error('   - Server availability');
    } else if (error.message.includes('authenticate') || error.message.includes('Invalid credentials')) {
      console.error('\n💡 Authentication failed. Check:');
      console.error('   - IMAP_USER and IMAP_PASSWORD in .env');
      console.error('   - For Gmail: Enable IMAP and use App Password');
    }

    console.error('\n📝 Configuration checklist:');
    console.error('   ✓ IMAP_USER set in .env');
    console.error('   ✓ IMAP_PASSWORD set in .env');
    console.error('   ✓ IMAP_HOST (default: imap.gmail.com)');
    console.error('   ✓ IMAP_PORT (default: 993)');
    console.error('   ✓ Internet connection active');
    console.error('   ✓ Gmail: IMAP enabled + App Password created\n');

    isMonitoring = false;
  }
}

/**
 * Stop email monitoring
 */
async function stopMonitoring() {
  console.log('\n🛑 Stopping email monitoring...');

  // Clear interval
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  // Close connection
  if (connection) {
    try {
      await connection.end();
    } catch (error) {
      console.error('⚠️ Error closing connection:', error.message);
    }
    connection = null;
  }

  isMonitoring = false;
  console.log('✅ Email monitoring stopped\n');
}

module.exports = {
  startMonitoring,
  stopMonitoring
};
