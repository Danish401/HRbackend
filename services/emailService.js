const imap = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const fs = require('fs-extra');
const path = require('path');
const pdfParse = require('pdf-parse');
require('dotenv').config();

// Optional: Tesseract.js for OCR (only load if available)
let Tesseract = null;
try {
  Tesseract = require('tesseract.js');
} catch (e) {
  console.warn('⚠️  tesseract.js not installed. OCR functionality will be disabled.');
  console.warn('   To enable OCR, run: npm install tesseract.js');
}

const Email = require('../models/Resume'); // File is Resume.js but exports Email model
const { extractResumeData } = require('./pdfParser');
const cloudinary = require('../config/cloudinary');
const redisService = require('./redisService');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../uploads');
fs.ensureDirSync(uploadsDir);

const imapConfig = {
  imap: {
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT) || 993,
    tls: true, // Always use TLS for Gmail
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 20000, // 20 seconds for authentication
    connTimeout: 20000, // 20 seconds for connection
    keepalive: false,
    authTimeout: 10000,
    connTimeout: 10000
    autotls: 'always' // Always use TLS
  }
};

let isMonitoring = false;
let connection = null;

// Store processed email UIDs to avoid reprocessing (in-memory fallback)
const processedEmails = new Set();

// Initialize Redis on module load
redisService.initializeRedis().catch(err => {
  console.warn('⚠️  Redis initialization failed, will use in-memory fallback:', err.message);
});

async function processEmail(connection, io) {
  try {
    // Get today's date for filtering
    const today = new Date();
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    
    // Format date for display
    const formatDate = (date) => {
      const day = date.getDate().toString().padStart(2, '0');
      const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
      const year = date.getFullYear();
      return `${day}-${month}-${year}`;
    };
    
    const todayStr = formatDate(todayStart);
    
    console.log(`📧 Searching for emails from today: ${todayStr}...`);
    console.log(`Optimized strategy: Fetch only headers of last 20 emails, then filter by today`);
    
    // Step 1: Get inbox info and fetch last 20 emails by sequence number (NO SEARCH - avoids Gmail throttling)
    let messages = [];
    
    try {
      console.log('Step 1: Getting inbox info and fetching last 20 emails by sequence number...');
      console.log('   Strategy: Bypass SEARCH command completely (Gmail throttles it)');
      console.log('   Using sequence numbers directly - much faster!');
      
      // Get inbox box info to know total message count
      // Box should already be open from startMonitoring, but get info safely
      let totalMessages = 0;
      try {
        const box = await connection.openBox('INBOX', true); // true = read-only mode
        totalMessages = box.messages.total;
      } catch (boxError) {
        // Box might already be open, try to get current box
        if (connection.mailbox) {
          totalMessages = connection.mailbox.messages.total;
        } else {
          throw new Error('Cannot get inbox message count');
        }
      }
      
      console.log(`✓ Inbox has ${totalMessages} total message(s)`);
      
      if (totalMessages === 0) {
        console.log(`\n❌ No emails found in inbox.\n`);
        return;
      }
      
      // Calculate sequence range for last 20 emails
      const fetchCount = Math.min(20, totalMessages);
      const startSeq = Math.max(1, totalMessages - fetchCount + 1);
      const endSeq = totalMessages;
      const seqRange = `${startSeq}:${endSeq}`;
      
      console.log(`   Fetching sequence range: ${seqRange} (last ${fetchCount} emails)`);
      console.log('   Fetching headers only (no body/attachments - very fast)');
      
      // Access the underlying IMAP connection to use seq.fetch (bypasses search)
      // imap-simple wraps the raw imap connection - try different property names
      let rawImap = null;
      
      // Try different ways to access the underlying connection
      if (connection._imap) {
        rawImap = connection._imap;
      } else if (connection.imap) {
        rawImap = connection.imap;
      } else if (connection.connection && connection.connection._imap) {
        rawImap = connection.connection._imap;
      }
      
      if (!rawImap) {
        // If we can't access raw connection, fall back to search
        throw new Error('Cannot access underlying IMAP connection - will use fallback');
      }
      
      if (!rawImap.seq || typeof rawImap.seq.fetch !== 'function') {
        throw new Error('Sequence fetch not available - will use fallback');
      }
      
      // Fetch by sequence number - this is MUCH faster than search
      const fetchOptions = {
        bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)', // Only headers
        struct: true // Get structure for envelope
      };
      
      // Use Promise to wrap the event-based fetch
      messages = await new Promise((resolve, reject) => {
        const fetchedMessages = [];
        let messageCount = 0;
        const expectedCount = endSeq - startSeq + 1;
        
        const timeout = setTimeout(() => {
          reject(new Error('Sequence fetch timeout after 20 seconds'));
        }, 20000);
        
        try {
          const fetch = rawImap.seq.fetch(seqRange, fetchOptions);
          
          fetch.on('message', (msg, seqno) => {
            const messageData = {
              attributes: {
                uid: null,
                date: null,
                envelope: null,
                struct: null
              },
              parts: []
            };
            
            msg.on('body', (stream, info) => {
              let buffer = '';
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
              stream.on('end', () => {
                // Header buffer parsed - we have envelope data from attributes
              });
            });
            
            msg.once('attributes', (attrs) => {
              messageData.attributes.uid = attrs.uid;
              messageData.attributes.date = attrs.date;
              messageData.attributes.envelope = attrs.envelope;
              messageData.attributes.struct = attrs.struct;
            });
            
            msg.once('end', () => {
              fetchedMessages.push(messageData);
              messageCount++;
              
              if (messageCount === expectedCount) {
                clearTimeout(timeout);
                resolve(fetchedMessages);
              }
            });
          });
          
          fetch.once('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
          
          fetch.once('end', () => {
            if (messageCount < expectedCount && messageCount > 0) {
              clearTimeout(timeout);
              resolve(fetchedMessages); // Return what we got
            } else if (messageCount === 0) {
              clearTimeout(timeout);
              reject(new Error('No messages fetched from sequence range'));
            }
          });
        } catch (fetchErr) {
          clearTimeout(timeout);
          reject(fetchErr);
        }
      });
      
      console.log(`✓ Fetched ${messages.length} email(s) by sequence number (no SEARCH used!)`);
      
      if (messages.length === 0) {
        console.log(`\n❌ No emails fetched.\n`);
        return;
      }
      
    } catch (fetchError) {
      console.error(`❌ Error fetching emails by sequence: ${fetchError.message}`);
      console.error(`   Error code: ${fetchError.code || 'N/A'}`);
      console.error(`\n   Falling back to alternative method...`);
      
      // Fallback: Try a very simple search with timeout
      try {
        console.log('   Trying fallback: Simple search with 15 second timeout...');
        const fallbackPromise = connection.search(['ALL'], { bodies: '', struct: true });
        const fallbackTimeout = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Fallback timeout')), 15000);
        });
        
        const fallbackMessages = await Promise.race([fallbackPromise, fallbackTimeout]);
        messages = fallbackMessages.slice(-20); // Last 20 only
        console.log(`✓ Fallback succeeded: Got ${messages.length} emails`);
      } catch (fallbackError) {
        console.error(`❌ Fallback also failed: ${fallbackError.message}`);
        console.error(`\n   This might indicate:`);
        console.error(`   - IMAP server is not responding`);
        console.error(`   - Network connectivity issues`);
        console.error(`   - Gmail IMAP is throttling requests`);
        console.error(`\n   Possible solutions:`);
        console.error(`   1. Wait a few minutes and try again (Gmail rate limiting)`);
        console.error(`   2. Check your internet connection`);
        console.error(`   3. Verify IMAP is enabled in Gmail settings`);
        return;
      }
    }
    
    // Step 3: Filter to only include emails from today (using header dates)
    if (messages.length > 0) {
      const originalCount = messages.length;
      console.log(`Step 3: Filtering ${originalCount} emails to find today's emails...`);
      
      messages = messages.filter(msg => {
        try {
          let emailDate = null;
          
          // Get date from envelope (header data we just fetched)
          if (msg.attributes.envelope && msg.attributes.envelope.date) {
            emailDate = new Date(msg.attributes.envelope.date);
          } else if (msg.attributes.date) {
            emailDate = new Date(msg.attributes.date);
          }
          
          if (!emailDate || isNaN(emailDate.getTime())) {
            console.log(`  ⚠️  Email UID ${msg.attributes.uid} has no valid date, including it anyway`);
            return true; // Include emails with invalid dates to be safe
          }
          
          // Compare dates only (not times) - check if it's the same calendar day
          const emailDateOnly = new Date(emailDate.getFullYear(), emailDate.getMonth(), emailDate.getDate());
          const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          
          const isToday = emailDateOnly.getTime() === todayDateOnly.getTime();
          
          if (isToday) {
            const subject = msg.attributes.envelope?.subject || 'No Subject';
            console.log(`  ✓ Email UID ${msg.attributes.uid} is from today: ${emailDate.toLocaleString()}`);
            console.log(`    Subject: "${subject}"`);
          } else {
            console.log(`  ❌ Email UID ${msg.attributes.uid} is from ${emailDate.toLocaleDateString()}, skipping`);
          }
          return isToday;
        } catch (err) {
          console.log(`  ⚠️  Error checking date for email UID ${msg.attributes.uid}:`, err.message);
          return true; // Include on error to be safe
        }
      });
      console.log(`✓ Filtered ${originalCount} total emails to ${messages.length} from today`);
    }
    
    if (messages.length === 0) {
      console.log(`\n❌ No emails found from today (${todayStr}).`);
      console.log(`   Please check if emails were sent today.\n`);
      return;
    }

    console.log(`\n✅ Found ${messages.length} email(s) from today`);
    console.log(`\n🚀 Step 4: Now fetching full content (body + attachments) only for today's emails...\n`);

    for (const message of messages) {
      const uid = message.attributes.uid;
      
      // Skip if already processed (check in-memory first, then Redis)
      if (processedEmails.has(uid)) {
        console.log(`Email UID ${uid} already processed (in-memory), skipping...`);
        continue;
      }
      
      // Check Redis (but don't block if Redis fails)
      try {
        const isProcessed = await redisService.isEmailProcessed(uid);
        if (isProcessed) {
          console.log(`Email UID ${uid} already processed (Redis), skipping...`);
          processedEmails.add(uid); // Add to in-memory cache too
          continue;
        }
      } catch (error) {
        // If Redis check fails, continue processing the email
        console.log(`⚠️  Redis check failed for UID ${uid}, continuing with processing...`);
      }

      try {
        // Extract subject and sender info from message attributes (from headers we fetched)
        let emailSubject = 'No Subject';
        let emailFrom = 'Unknown Sender';
        let emailDate = null;
        
        if (message.attributes.envelope) {
          if (message.attributes.envelope.subject) {
            emailSubject = message.attributes.envelope.subject;
          }
          if (message.attributes.envelope.from && message.attributes.envelope.from.length > 0) {
            const fromAddr = message.attributes.envelope.from[0];
            emailFrom = fromAddr.name || fromAddr.address || 'Unknown';
          }
          if (message.attributes.envelope.date) {
            emailDate = new Date(message.attributes.envelope.date);
          }
        }
        
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📨 Processing Email UID ${uid}:`);
        console.log(`   From: ${emailFrom}`);
        console.log(`   Subject: "${emailSubject}"`);
        console.log(`   Date: ${emailDate ? emailDate.toLocaleString() : 'Unknown'}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        
        // NOW fetch the full email body and attachments (only for emails from today)
        console.log(`   Fetching full email content (body + attachments)...`);
        let emailBody = null;
        
        try {
          // Fetch full email with body and structure for this specific UID
          const fullFetchOptions = {
            bodies: '', // Full body
            struct: true // Structure for attachments
          };
          
          const fullFetchPromise = connection.search([['UID', uid]], fullFetchOptions);
          const fullFetchTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Full fetch timeout')), 30000);
          });
          
          const fullMessages = await Promise.race([fullFetchPromise, fullFetchTimeout]);
          
          if (fullMessages && fullMessages.length > 0) {
            const fullMessage = fullMessages[0];
            
            // Get the full message body from the parts
            if (fullMessage.parts && fullMessage.parts.length > 0) {
              const fullPart = fullMessage.parts.find(part => part.which === '' || part.which === undefined);
              if (fullPart && fullPart.body) {
                emailBody = fullPart.body;
                console.log(`   ✓ Got email body, size: ${emailBody.length} bytes`);
              } else if (fullMessage.parts[0] && fullMessage.parts[0].body) {
                emailBody = fullMessage.parts[0].body;
                console.log(`   ✓ Got email body from first part, size: ${emailBody.length} bytes`);
              }
            }
            
            // If we don't have the body yet, fetch it using getPartData
            if (!emailBody && fullMessage.attributes.struct) {
              try {
                const parts = imap.getParts(fullMessage.attributes.struct);
                if (parts && parts.length > 0) {
                  let rootPart = parts.find(part => !part.partID || part.partID === '1');
                  if (!rootPart) {
                    rootPart = parts[0];
                  }
                  
                  if (rootPart) {
                    emailBody = await connection.getPartData(fullMessage, rootPart);
                    console.log(`   ✓ Fetched email body using getPartData, size: ${emailBody ? emailBody.length : 0} bytes`);
                  }
                }
              } catch (err) {
                console.error(`   Error fetching part data:`, err.message);
              }
            }
            
            // Update message with full data for processing
            message.parts = fullMessage.parts;
            message.attributes.struct = fullMessage.attributes.struct;
          }
        } catch (fetchError) {
          console.error(`   ❌ Error fetching full email content: ${fetchError.message}`);
          // Continue processing with what we have
        }
        
        if (!emailBody) {
          console.error(`❌ Could not fetch email body for UID ${uid}`);
          await redisService.markEmailProcessed(uid);
          processedEmails.add(uid);
          continue;
        }

        // Convert to Buffer if needed
        if (typeof emailBody === 'string') {
          emailBody = Buffer.from(emailBody);
        } else if (emailBody instanceof Uint8Array) {
          emailBody = Buffer.from(emailBody);
        } else if (!Buffer.isBuffer(emailBody)) {
          emailBody = Buffer.from(emailBody);
        }
        
        console.log(`✓ Email body ready, size: ${emailBody.length} bytes`);

        // Parse the email using mailparser
        await processEmailContent(emailBody, uid, io);
        
      } catch (error) {
        console.error(`❌ Error processing email UID ${uid}:`, error.message);
        console.error(error.stack);
      }
    }
  } catch (error) {
    console.error('Error processing emails:', error.message);
    console.error(error.stack);
  }
}

async function processEmailContent(emailData, uid, io) {
  try {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📨 Processing Email Content UID ${uid}...`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    // Parse email using mailparser
    const parsed = await simpleParser(emailData);
    
    console.log(`✓ Email parsed successfully`);
    console.log(`  From: ${parsed.from ? parsed.from.text : 'Unknown'}`);
    console.log(`  Subject: ${parsed.subject || 'No Subject'}`);
    console.log(`  Date: ${parsed.date || 'Unknown'}`);
    console.log(`  Attachments: ${parsed.attachments ? parsed.attachments.length : 0}`);
    
    // Extract email body text
    let emailBodyText = '';
    
    // Try to get plain text first, then HTML
    if (parsed.text) {
      emailBodyText = parsed.text;
    } else if (parsed.textAsHtml) {
      // Convert HTML to plain text
      emailBodyText = parsed.textAsHtml.replace(/<[^>]*>/g, '').trim();
    } else if (parsed.html) {
      // Convert HTML to plain text
      emailBodyText = parsed.html.replace(/<[^>]*>/g, '').trim();
    } else if (parsed.textAsPlainText) {
      emailBodyText = parsed.textAsPlainText;
    }
    
    // Clean up the text (remove excessive whitespace)
    emailBodyText = emailBodyText.replace(/\n{3,}/g, '\n\n').trim();
    
    console.log(`  Body length: ${emailBodyText.length} characters`);
    
    if (!emailBodyText) {
      console.log(`⚠️  No email body text found for UID ${uid}`);
      emailBodyText = '(No content)';
    }
    
    // Get sender information
    const senderEmail = parsed.from && parsed.from.value && parsed.from.value[0] ? 
      parsed.from.value[0].address : 
      'unknown@example.com';
    
    const senderName = parsed.from && parsed.from.value && parsed.from.value[0] ? 
      (parsed.from.value[0].name || senderEmail) : 
      senderEmail;
    
    // Check if email has PDF attachments and process them
    let attachmentData = null;
    let hasAttachment = false;
    
    if (parsed.attachments && parsed.attachments.length > 0) {
      console.log(`\n📎 Found ${parsed.attachments.length} attachment(s) - checking for PDFs...`);
      
      // Look for PDF attachments
      for (let i = 0; i < parsed.attachments.length; i++) {
        const attachment = parsed.attachments[i];
        const filename = attachment.filename || attachment.name || `attachment_${i + 1}`;
        const contentType = attachment.contentType || '';
        const isPdf = contentType === 'application/pdf' || 
                      filename.toLowerCase().endsWith('.pdf');
        
        console.log(`\n  📎 Attachment ${i + 1}/${parsed.attachments.length}:`);
        console.log(`     Filename: ${filename}`);
        console.log(`     Content Type: ${contentType}`);
        console.log(`     Size: ${attachment.size || 'unknown'} bytes`);
        console.log(`     Is PDF: ${isPdf ? '✅ YES' : '❌ NO'}`);
        
        if (isPdf) {
          console.log(`\n  🚀 Starting PDF processing for: ${filename}`);
          hasAttachment = true;
          
          try {
            // Handle attachment content - convert to Buffer
            let pdfContent;
            if (Buffer.isBuffer(attachment.content)) {
              pdfContent = attachment.content;
              console.log(`  PDF content is Buffer, size: ${pdfContent.length} bytes`);
            } else if (attachment.content instanceof Uint8Array) {
              pdfContent = Buffer.from(attachment.content);
              console.log(`  PDF content is Uint8Array, converted to Buffer, size: ${pdfContent.length} bytes`);
            } else if (typeof attachment.content === 'string') {
              try {
                // Try base64 first
                pdfContent = Buffer.from(attachment.content, 'base64');
                console.log(`  PDF content is string (base64), converted to Buffer, size: ${pdfContent.length} bytes`);
              } catch {
                // If base64 fails, try as plain string
                pdfContent = Buffer.from(attachment.content, 'binary');
                console.log(`  PDF content is string (binary), converted to Buffer, size: ${pdfContent.length} bytes`);
              }
            } else {
              pdfContent = Buffer.from(attachment.content);
              console.log(`  PDF content converted to Buffer, size: ${pdfContent.length} bytes`);
            }
            
            if (!pdfContent || pdfContent.length === 0) {
              throw new Error('PDF content is empty');
            }
            
            // STEP 1: Upload PDF to Cloudinary FIRST
            console.log(`  ☁️  Step 1: Uploading PDF to Cloudinary...`);
            console.log(`     PDF size: ${pdfContent.length} bytes`);
            let cloudinaryResult = null;
            let cloudinaryUrl = null;
            let cloudinaryPublicId = null;
            
            // Check if Cloudinary is configured
            if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
              console.warn(`  ⚠️  Cloudinary not configured in .env file`);
              console.warn(`     Missing: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET`);
              console.warn(`     Will save PDF locally instead`);
            } else {
              try {
                // Create unique filename for Cloudinary
                const timestamp = Date.now();
                const originalFilename = filename || 'resume.pdf';
                const sanitizedFilename = originalFilename
                  .replace(/[^a-zA-Z0-9.-]/g, '_')
                  .replace(/\s+/g, '_');
                
                const cloudinaryFilename = `resumes/${timestamp}_${sanitizedFilename}`;
                console.log(`     Uploading as: ${cloudinaryFilename}`);
                
                // Upload to Cloudinary using upload_stream
                cloudinaryResult = await new Promise((resolve, reject) => {
                  const uploadStream = cloudinary.uploader.upload_stream(
                    {
                      resource_type: 'raw',
                      folder: 'resumes',
                      public_id: cloudinaryFilename.replace('.pdf', ''),
                      format: 'pdf',
                      use_filename: true,
                      unique_filename: true,
                      type: 'upload', // Ensure upload type
                      access_mode: 'public' // Make publicly accessible
                    },
                    (error, result) => {
                      if (error) {
                        reject(error);
                      } else {
                        resolve(result);
                      }
                    }
                  );
                  
                  // Write the buffer to the upload stream
                  uploadStream.end(pdfContent);
                });
                
                cloudinaryUrl = cloudinaryResult.secure_url || cloudinaryResult.url;
                cloudinaryPublicId = cloudinaryResult.public_id;
                
                console.log(`  ✅ PDF uploaded to Cloudinary successfully!`);
                console.log(`     URL: ${cloudinaryUrl}`);
                console.log(`     Public ID: ${cloudinaryPublicId}`);
                
              } catch (cloudinaryError) {
                console.error(`  ❌ Cloudinary upload failed: ${cloudinaryError.message}`);
                console.error(`     Error details:`, cloudinaryError);
                console.error(`  ⚠️  Continuing with local storage as fallback...`);
              }
            }
            
            // Fallback: Save locally if Cloudinary failed or not configured
            if (!cloudinaryUrl) {
              await fs.ensureDir(uploadsDir);
              const timestamp = Date.now();
              const originalFilename = filename || 'resume.pdf';
              const sanitizedFilename = originalFilename
                .replace(/[^a-zA-Z0-9.-]/g, '_')
                .replace(/\s+/g, '_');
              
              const pdfFilename = `${timestamp}_${sanitizedFilename}`;
              const pdfPath = path.join(uploadsDir, pdfFilename);
              await fs.writeFile(pdfPath, pdfContent);
              console.log(`  ✓ PDF saved locally: ${pdfPath}`);
            }
            
            // STEP 2: Extract data from PDF (using the buffer we already have)
            console.log(`  📄 Step 2: Extracting data from PDF...`);
            let pdfData = null;
            let extractedText = '';
            
            try {
              // First, try pdf-parse (works for text-based PDFs)
              pdfData = await pdfParse(pdfContent);
              extractedText = pdfData.text || '';
              console.log(`  ✅ PDF parsed with pdf-parse, extracted ${extractedText.length} characters`);
            } catch (parseError) {
              console.log(`  ⚠️  pdf-parse failed: ${parseError.message}`);
              console.log(`  Will try OCR for scanned PDF...`);
            }
            
            // If pdf-parse didn't extract text or extracted very little, try OCR
            if (!extractedText || extractedText.trim().length < 50) {
              console.log(`  🔍 PDF appears to be scanned or image-based, attempting OCR...`);
              console.log(`  ⚠️  Note: OCR works best when PDF pages are converted to images first.`);
              console.log(`  📸 Running OCR on PDF directly (this may take a moment)...`);
              
              try {
                // Try to use Tesseract.js for OCR (if available)
                if (!Tesseract) {
                  console.log(`  ⚠️  Tesseract.js not available, skipping OCR`);
                  throw new Error('Tesseract.js not installed');
                }
                
                // Note: Tesseract.js works best with images. For PDFs, consider converting pages to images first
                // using pdf-img-convert or similar (requires native dependencies on Windows)
                const { data: { text: ocrText } } = await Tesseract.recognize(pdfContent, 'eng', {
                  logger: m => {
                    if (m.status === 'recognizing text') {
                      console.log(`  OCR progress: ${Math.round(m.progress * 100)}%`);
                    }
                  }
                });
                
                if (ocrText && ocrText.trim().length > 0) {
                  extractedText = ocrText;
                  console.log(`  ✅ OCR completed successfully, extracted ${extractedText.length} characters`);
                  
                  // Create a mock pdfData object for consistency
                  pdfData = { text: extractedText };
                } else {
                  console.log(`  ⚠️  OCR completed but no text was extracted`);
                  console.log(`  💡 Tip: For scanned PDFs, consider converting PDF pages to images first for better OCR accuracy`);
                }
              } catch (ocrError) {
                console.error(`  ❌ OCR failed: ${ocrError.message}`);
                console.error(`  💡 Tip: For better OCR support, install pdf-img-convert to convert PDF pages to images first`);
                console.error(`  💡 Alternative: Use a cloud OCR service for production-grade scanned PDF processing`);
                // Continue with whatever text we have (even if empty)
              }
            }
            
            if (!extractedText || extractedText.trim().length === 0) {
              console.log(`  ⚠️  Could not extract text from PDF (neither pdf-parse nor OCR worked)`);
              extractedText = '';
            }
            
            // Extract structured data from PDF (name, email, contact, DOB)
            console.log(`  Extracting structured data from PDF...`);
            if (extractedText.length > 0) {
              console.log(`  PDF text preview (first 500 chars): ${extractedText.substring(0, 500)}`);
            }
            
            const extractedData = extractResumeData(extractedText);
            
            console.log(`  ✅ Extracted data from PDF:`);
            console.log(`     - Name: "${extractedData.name || 'Not found'}"`);
            console.log(`     - Email: "${extractedData.email || 'Not found'}"`);
            console.log(`     - Contact: "${extractedData.contactNumber || 'Not found'}"`);
            console.log(`     - DOB: "${extractedData.dateOfBirth || 'Not found'}"`);
            
            // Prepare attachment data for MongoDB - include Cloudinary URL and public ID
            // Get local path if Cloudinary wasn't used
            let localPdfPath = null;
            if (!cloudinaryUrl) {
              const timestamp = Date.now();
              const originalFilename = filename || 'resume.pdf';
              const sanitizedFilename = originalFilename
                .replace(/[^a-zA-Z0-9.-]/g, '_')
                .replace(/\s+/g, '_');
              localPdfPath = path.join(uploadsDir, `${timestamp}_${sanitizedFilename}`);
            }
            
            attachmentData = {
              name: extractedData.name || '',
              email: extractedData.email || '',
              contactNumber: extractedData.contactNumber || '',
              dateOfBirth: extractedData.dateOfBirth || '',
              experience: extractedData.experience || '',
              role: extractedData.role || '',
              cloudinaryUrl: cloudinaryUrl || null,           // Cloudinary URL (primary)
              cloudinaryPublicId: cloudinaryPublicId || null, // Cloudinary public ID for deletion
              pdfPath: cloudinaryUrl || localPdfPath,         // Use Cloudinary URL if available, otherwise local path
              rawText: extractedText.substring(0, 5000) // Store first 5000 chars for reference
            };
            
            // Log what will be saved
            console.log(`  📦 Attachment data to save:`, JSON.stringify(attachmentData, null, 2));
            
            console.log(`  ✅ PDF attachment processed successfully (uploaded to Cloudinary + data extracted)`);
            
            // Found PDF, process only the first one
            break;
          } catch (error) {
            console.error(`  ❌ Error processing PDF attachment:`, error.message);
            console.error(`  Stack:`, error.stack);
            // Continue processing email even if PDF fails
          }
        }
      }
      
      if (!hasAttachment) {
        console.log(`  No PDF attachments found in ${parsed.attachments.length} attachment(s)`);
      }
    } else {
      console.log(`  No attachments found in email`);
    }
    
    // Create unique email ID
    const emailId = `uid_${uid}`;
    
    // Check if email already exists in database
    const existingEmail = await Email.findOne({ emailId: emailId });
    if (existingEmail) {
      console.log(`⚠️  Email UID ${uid} already exists in database`);
      
      // If it exists but doesn't have attachment data, update it
      if (hasAttachment && attachmentData && (!existingEmail.attachmentData || !existingEmail.attachmentData.name)) {
        console.log(`  Updating existing email with PDF attachment data...`);
        existingEmail.hasAttachment = true;
        existingEmail.attachmentData = attachmentData;
        await existingEmail.save();
        console.log(`✅ Updated email with PDF data: Name=${attachmentData.name}, Email=${attachmentData.email}`);
        
        // Emit notification
        if (io) {
          io.emit('newEmail', {
            message: 'Email updated with PDF attachment data!',
            email: existingEmail
          });
        }
      }
      
      await redisService.markEmailProcessed(uid);
      processedEmails.add(uid);
      return;
    }
    
    // Save to MongoDB
    console.log(`\n💾 Saving email to MongoDB...`);
    console.log(`  Email data:`, {
      from: senderEmail,
      subject: parsed.subject,
      hasAttachment: hasAttachment,
      hasAttachmentData: !!attachmentData,
      cloudinaryUrl: attachmentData?.cloudinaryUrl || 'N/A'
    });
    
    const email = new Email({
      from: senderEmail,
      fromName: senderName,
      subject: parsed.subject || 'No Subject',
      body: emailBodyText,
      receivedAt: parsed.date || new Date(),
      emailId: emailId,
      hasAttachment: hasAttachment,
      attachmentData: attachmentData || undefined  // Only include if attachmentData exists
    });
    
    try {
      const savedEmail = await email.save();
      console.log(`✅ Email saved successfully to MongoDB!`);
      console.log(`     Email ID: ${savedEmail._id}`);
      console.log(`     Subject: "${savedEmail.subject}"`);
      console.log(`     From: ${savedEmail.from}`);
      
      if (hasAttachment && attachmentData) {
        console.log(`\n✅ PDF attachment data saved to MongoDB:`);
        console.log(`     - Name: ${attachmentData.name || 'Not extracted'}`);
        console.log(`     - Email: ${attachmentData.email || 'Not extracted'}`);
        console.log(`     - Contact: ${attachmentData.contactNumber || 'Not extracted'}`);
        console.log(`     - DOB: ${attachmentData.dateOfBirth || 'Not extracted'}`);
        console.log(`     - Role: ${attachmentData.role || 'Not extracted'}`);
        console.log(`     - Cloudinary URL: ${attachmentData.cloudinaryUrl || 'Not uploaded (using local path)'}`);
        console.log(`     - PDF Path: ${attachmentData.pdfPath || 'N/A'}`);
      } else {
        console.log(`ℹ️  No PDF attachment found in email`);
      }
      
      // Mark email as processed (in Redis and in-memory)
      await redisService.markEmailProcessed(uid);
      processedEmails.add(uid);
      
      // Emit real-time notification
      if (io) {
        io.emit('newEmail', {
          message: hasAttachment ? 'New email with PDF attachment received!' : 'New email received!',
          email: savedEmail
        });
        console.log(`✓ Real-time notification sent to frontend`);
      }
      
    } catch (saveError) {
      console.error(`❌ Error saving email to MongoDB:`, saveError.message);
      console.error(`   Stack:`, saveError.stack);
      throw saveError; // Re-throw to be caught by outer try-catch
    }
    
  } catch (error) {
    console.error(`\n❌ Error processing email content for UID ${uid}:`, error.message);
    console.error(`   Stack:`, error.stack);
    // Don't mark as processed if there was an error - allow retry
    // await redisService.markEmailProcessed(uid);
    // processedEmails.add(uid);
  }
}

async function startMonitoring(io) {
  if (isMonitoring) {
    console.log('Email monitoring already running');
    return;
  }

  try {
    // Check IMAP configuration
    if (!process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
      console.error('❌ IMAP credentials not configured!');
      console.error('   Please set IMAP_USER and IMAP_PASSWORD in your .env file');
      return;
    }

    console.log('🔄 Connecting to IMAP server...');
    console.log(`   Host: ${imapConfig.imap.host}`);
    console.log(`   Port: ${imapConfig.imap.port}`);
    console.log(`   User: ${imapConfig.imap.user}`);
    
    connection = await imap.connect(imapConfig);
    
    // Add error handlers to prevent unhandled errors
    connection.on('error', (err) => {
      console.error('❌ IMAP connection error:', err.message);
      console.error('   Code:', err.code);
      isMonitoring = false;
      // Attempt to reconnect after a delay
      setTimeout(() => {
        if (!isMonitoring) {
          console.log('🔄 Attempting to reconnect to IMAP server...');
          startMonitoring(io).catch(err => {
            console.error('❌ Reconnection failed:', err.message);
          });
        }
      }, 30000); // Retry after 30 seconds
    });
    
    connection.on('end', () => {
      console.warn('⚠️  IMAP connection ended');
      isMonitoring = false;
    });
    
    await connection.openBox('INBOX',true);
    console.log('✅ Connected to IMAP server successfully');
    
    isMonitoring = true;
    const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

    const checkInterval = setInterval(async () => {
      if (!isMonitoring || !connection) return;
    
      try {
        await processEmail(connection, io);
      } catch (err) {
        console.error('❌ Scheduled email check failed:', err.message);
      }
    }, CHECK_INTERVAL);

    // Listen for new emails in real-time
    connection.on('mail', async () => {
      console.log('📬 New email detected via IMAP event!');
      try {
        await processEmail(connection, io);
      } catch (error) {
        console.error('❌ Error processing new email:', error.message);
      }
    });

    // Process existing emails on startup
    console.log('📧 Checking for existing emails from today...');
    await processEmail(connection, io);
    
  } catch (error) {
    console.error('❌ Failed to connect to IMAP server:', error.message);
    console.error('   Error code:', error.code);
    
    if (error.code === 'ENOTFOUND' || error.message.includes('ENOTFOUND')) {
      console.error('\n   This usually means:');
      console.error('   - IMAP hostname cannot be resolved (check your internet connection)');
      console.error('   - IMAP_HOST in .env might be incorrect');
      console.error('   - DNS resolution failed');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n   This usually means:');
      console.error('   - IMAP server is not accessible');
      console.error('   - Firewall is blocking the connection');
      console.error('   - Wrong port number');
    } else if (error.code === 'ETIMEDOUT') {
      console.error('\n   This usually means:');
      console.error('   - Connection timeout');
      console.error('   - Network connectivity issues');
    }
    
    console.error('\n   Please check:');
    console.error('   1. IMAP_USER and IMAP_PASSWORD in .env file');
    console.error('   2. IMAP_HOST (default: imap.gmail.com)');
    console.error('   3. IMAP_PORT (default: 993)');
    console.error('   4. Your internet connection');
    console.error('   5. For Gmail: Enable "Less secure app access" or use App Password\n');
    
    isMonitoring = false;
  }
}

async function stopMonitoring() {
  if (connection) {
    await connection.end();
    connection = null;
  }
  isMonitoring = false;
  console.log('Email monitoring stopped');
}

module.exports = {
  startMonitoring,
  stopMonitoring
};
