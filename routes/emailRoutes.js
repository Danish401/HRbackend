const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const pdfParse = require('pdf-parse');
const mongoose = require('mongoose');
const { extractResumeData } = require('../services/pdfParser');
const graphService = require('../services/graphService');
const Email = require('../models/Resume');
const { s3Client, bucketName } = require('../config/s3');
const { Upload } = require("@aws-sdk/lib-storage");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { streamToBuffer } = require('../utils/streamUtils'); // I'll need to create this or use a simple implementation

// Configure multer for file uploads
const uploadsDir = path.join(__dirname, '../uploads');
fs.ensureDirSync(uploadsDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}_${originalName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// Helper to get io instance
const getIO = (req) => {
  return req.app.get('io');
};

// Outlook OAuth2 Routes
router.get('/login', async (req, res) => {
  try {
    const url = await graphService.getAuthUrl();
    res.redirect(url);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code provided');

  try {
    const email = await graphService.redeemCode(code);
    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
        <h1 style="color: #28a745;">✅ Authorization Successful!</h1>
        <p>Outlook account <b>${email}</b> is now connected to ResumeExtractor.</p>
        <p>You can close this window now.</p>
      </div>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Get all emails
router.get('/', async (req, res) => {
  try {
    const emails = await Email.find().sort({ receivedAt: -1, createdAt: -1 });
    
    // Log summary for debugging
    const withAttachments = emails.filter(e => e.hasAttachment).length;
    const withCloudinary = emails.filter(e => e.attachmentData?.cloudinaryUrl).length;
    const withLocalPath = emails.filter(e => e.attachmentData?.pdfPath && !e.attachmentData?.pdfPath?.startsWith('http')).length;
    
    console.log(`📊 Email summary: ${emails.length} total, ${withAttachments} with attachments, ${withCloudinary} in Cloudinary, ${withLocalPath} local files`);
    
    res.json(emails);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get email count (must be before /:id route)
router.get('/stats/count', async (req, res) => {
  try {
    const count = await Email.countDocuments();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint to verify route registration
router.get('/test-upload-route', (req, res) => {
  res.json({ message: 'Upload route is registered!', path: '/api/resumes/upload', method: 'POST' });
});

// Test endpoint to verify download route registration
router.get('/test-download-route', (req, res) => {
  res.json({ message: 'Download route is registered!', path: '/api/resumes/download/:id', method: 'GET' });
});

// Helper to process a single uploaded file
async function processUploadedResume(file, req) {
  console.log(`📥 Resume file uploaded: ${file.filename}`);
  console.log(`   Original name: ${file.originalname}`);
  console.log(`   Size: ${file.size} bytes`);

  // Read PDF file
  const pdfBuffer = await fs.readFile(file.path);
  
  // STEP 1: Upload PDF to AWS S3 FIRST
  console.log('☁️  Step 1: Uploading PDF to AWS S3...');
  let s3Result = null;
  let s3Url = null;
  let s3Key = null;
  
  try {
    const timestamp = Date.now();
    const sanitizedFilename = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\s+/g, '_');
    
    s3Key = `resumes/${timestamp}_${sanitizedFilename}`;
    
    // Upload to S3
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: s3Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      },
    });

    s3Result = await upload.done();
    s3Url = s3Result.Location;
    
    console.log('✅ PDF uploaded to AWS S3 successfully!');
    console.log(`   URL: ${s3Url}`);
    console.log(`   Key: ${s3Key}`);
    
  } catch (s3Error) {
    console.error(`❌ AWS S3 upload failed: ${s3Error.message}`);
    console.error(`⚠️  Continuing with local storage as fallback...`);
  }

  // STEP 2: Extract data from PDF
  console.log('📄 Step 2: Parsing PDF and extracting data...');
  
  const pdfData = await pdfParse(pdfBuffer);
  const pdfText = pdfData.text;

  if (!pdfText || pdfText.length === 0) {
    // Clean up local file if S3 succeeded
    if (s3Url) {
      await fs.remove(file.path);
    }
    throw new Error('PDF file appears to be empty or could not be parsed');
  }

  // Extract resume data
  const extractedData = extractResumeData(pdfText);
  
  console.log('✓ Extracted data:', {
    name: extractedData.name,
    email: extractedData.email,
    contactNumber: extractedData.contactNumber,
    role: extractedData.role
  });

  // Check MongoDB connection before saving
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ MongoDB not connected');
    // Clean up local file if S3 succeeded
    if (s3Url) {
      await fs.remove(file.path);
    }
    throw new Error('Database connection unavailable. Please try again later.');
  }

  // Create email/resume record
  const resumeData = {
    from: extractedData.email || 'upload@youhrpower.com',
    fromName: extractedData.name || 'Resume Upload',
    subject: `Resume Upload: ${extractedData.name || 'Unknown'} - ${extractedData.role || 'No Role'}`,
    body: `Resume uploaded directly via shareable link.

File: ${file.originalname}

Extracted Information:
${JSON.stringify(extractedData, null, 2)}`,
    receivedAt: new Date(),
    emailId: `upload_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    hasAttachment: true,
    attachmentData: {
      ...extractedData,
      s3Url: s3Url || null,
      s3Key: s3Key || null,
      pdfPath: s3Url || file.path, // Use S3 URL if available, otherwise local path
      rawText: pdfText.substring(0, 5000) // Store first 5000 chars
    }
  };

  // Save to database
  const savedResume = await Email.create(resumeData);
  console.log(`✅ Resume saved to database: ${savedResume._id}`);

  // Clean up local file if S3 upload succeeded
  if (s3Url) {
    try {
      await fs.remove(file.path);
      console.log(`✓ Local file removed (using S3 URL)`);
    } catch (removeError) {
      console.warn(`⚠️  Could not remove local file: ${removeError.message}`);
    }
  }

  // Emit socket event for real-time update
  const io = req.app.get('io');
  if (io) {
    io.emit('newEmail', {
      message: 'New resume uploaded!',
      email: savedResume
    });
  }

  return savedResume;
}

// Upload multiple resume files (must be before /:id route)
router.post('/upload', (req, res, next) => {
  upload.array('resumes', 10)(req, res, (err) => {
    if (err) {
      console.error('❌ Multer upload error:', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File size too large. Maximum size is 10MB per file.' });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message || 'File upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded. Please select at least one PDF file.' });
    }

    const results = [];
    for (const file of req.files) {
      try {
        const saved = await processUploadedResume(file, req);
        results.push({ file: file.originalname, status: 'success', resume: saved });
      } catch (e) {
        console.error(`❌ Error processing ${file.originalname}:`, e.message);
        results.push({ file: file.originalname, status: 'error', error: e.message });
      }
    }

    res.json({
      message: 'Upload processed',
      results
    });

  } catch (error) {
    console.error('❌ Error processing uploaded resumes:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to process resume upload' 
    });
  }
});

// Download PDF route (must be before /:id route)
router.get('/download/:id', async (req, res) => {
  try {
    console.log(`📥 Download request received for ID: ${req.params.id}`);
    console.log(`📥 Full URL: ${req.originalUrl}`);
    console.log(`📥 Method: ${req.method}`);
    
    if (mongoose.connection.readyState !== 1) {
      console.error('❌ Database not connected');
      return res.status(503).json({ error: 'Database not connected', message: 'MongoDB connection is not established.' });
    }

    const email = await Email.findById(req.params.id);
    if (!email) {
      console.error(`❌ Resume not found with ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Resume not found' });
    }

    // Check if email has attachment data
    if (!email.hasAttachment) {
      console.error(`❌ Email ${req.params.id} does not have attachments`);
      return res.status(404).json({ error: 'This email does not have a PDF attachment' });
    }

    if (!email.attachmentData) {
      console.error(`❌ Email ${req.params.id} has hasAttachment=true but no attachmentData`);
      return res.status(404).json({ error: 'PDF attachment data not found for this resume' });
    }

    // Get the original filename for download
    const originalName = email.attachmentData?.name || email.fromName || 'resume';
    const sanitizedName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filename = `${sanitizedName}_resume.pdf`;

    const https = require('https');
    const http = require('http');
    
    const fetchFromUrl = async (url) => {
      console.log(`📥 Fetching: ${url}`);
      return new Promise((resolve, reject) => {
        try {
          const urlObj = new URL(url);
          const protocol = urlObj.protocol === 'https:' ? https : http;
          
          // Add Cloudinary Basic Auth if it's a Cloudinary URL
          const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          };
          
          if (url.includes('cloudinary.com')) {
            const auth = Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
            console.log('   (Using Cloudinary API Authentication)');
          }
          
          const request = protocol.get(url, {
            headers,
            timeout: 30000
          }, (response) => {
            // Handle redirects
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              const redirectUrl = new URL(response.headers.location, url).href;
              console.log(`🔄 Following redirect to: ${redirectUrl}`);
              fetchFromUrl(redirectUrl).then(resolve).catch(reject);
              return;
            }
            
            if (response.statusCode !== 200) {
              reject(new Error(`HTTP ${response.statusCode}`));
              return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', (err) => reject(new Error(`Stream error: ${err.message}`)));
          });

          request.on('error', (err) => reject(new Error(`Request error: ${err.message}`)));
          request.on('timeout', () => {
            request.destroy();
            reject(new Error('Timeout'));
          });
        } catch (e) {
          reject(new Error(`URL parsing error: ${e.message}`));
        }
      });
    };

    // Check if PDF is stored in AWS S3
    if (email.attachmentData && (email.attachmentData.s3Url || email.attachmentData.s3Key)) {
      console.log(`☁️  PDF linked to AWS S3: ${email.attachmentData.s3Url}`);
      
      // Try direct S3 SDK access first
      try {
        const s3Key = email.attachmentData.s3Key;
        if (s3Key) {
          const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
          });
          
          const { Body } = await s3Client.send(command);
          
          const pdfBuffer = await streamToBuffer(Body);
          
          if (pdfBuffer) {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.send(pdfBuffer);
            return;
          }
        }
      } catch (s3Error) {
        console.error(`❌ AWS S3 SDK error: ${s3Error.message}`);
        console.error(`   Falling back to HTTP download from S3 URL...`);
      }
      
      // Fallback: Try presigned URL approach
      try {
        const s3Key = email.attachmentData.s3Key;
        if (s3Key) {
          // Generate presigned URL for 15 minutes
          const { GetObjectCommand, getSignedUrl } = require("@aws-sdk/s3-request-presigner");
          
          const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
          });
          
          const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 minutes
          console.log(`🔗 Generated presigned URL for S3 object`);
          
          const pdfBuffer = await fetchFromUrl(signedUrl);
          
          if (pdfBuffer) {
            console.log(`✅ Successfully downloaded PDF via presigned URL`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', pdfBuffer.length);
            res.send(pdfBuffer);
            return;
          }
        }
      } catch (presignError) {
        console.error(`❌ Presigned URL generation failed: ${presignError.message}`);
        
        // Final fallback: Try direct HTTP with potential URL fixes
        try {
          const s3Url = email.attachmentData.s3Url;
          if (s3Url) {
            // Try both original and common URL variations
            const urlsToTry = [
              s3Url,
              s3Url.replace('resumeyourhrpower-resumes.s3.ap-south-1.amazonaws.com', 
                           'resumeyourhrpower-resumes.s3.amazonaws.com')
            ];
            
            console.log(`📥 Attempting HTTP download from S3 URLs:`);
            
            for (const url of urlsToTry) {
              try {
                console.log(`   Trying: ${url}`);
                const pdfBuffer = await fetchFromUrl(url);
                if (pdfBuffer) {
                  console.log(`✅ Successfully downloaded PDF via HTTP from S3`);
                  res.setHeader('Content-Type', 'application/pdf');
                  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                  res.setHeader('Content-Length', pdfBuffer.length);
                  res.send(pdfBuffer);
                  return;
                }
              } catch (urlError) {
                console.warn(`⚠️  Failed for ${url}: ${urlError.message}`);
              }
            }
          }
        } catch (httpError) {
          console.error(`❌ HTTP download from S3 failed: ${httpError.message}`);
        }
        
        console.error(`   All S3 download methods exhausted, falling back to alternative methods...`);
      }
    }

    // Check if PDF is stored in Cloudinary (legacy support)
    if (email.attachmentData && (email.attachmentData.cloudinaryUrl || email.attachmentData.cloudinaryPublicId)) {
      console.log(`☁️  PDF linked to Cloudinary: ${email.attachmentData.cloudinaryUrl}`);
      
      try {
        let pdfBuffer = null;
        let publicId = email.attachmentData.cloudinaryPublicId;
        
        if (publicId) {
          // IDs to try: Literal from DB, then with/without .pdf, then my "fixed" versions
          const idsToTry = [
            publicId,
            publicId.endsWith('.pdf') ? publicId.slice(0, -4) : publicId + '.pdf',
            publicId.replace('resumes/resumes/', 'resumes/'),
            publicId.replace('resumes/resumes/', 'resumes/').replace(/\.pdf$/i, '')
          ];
          
          const types = ['upload', 'authenticated'];
          
          let version = null;
          if (email.attachmentData.cloudinaryUrl) {
            const vMatch = email.attachmentData.cloudinaryUrl.match(/\/v(\d+)\//);
            if (vMatch) version = vMatch[1];
          }

          outerLoop: for (const idToTry of [...new Set(idsToTry)]) {
            for (const typeToTry of types) {
              try {
                const options = { resource_type: 'raw', secure: true, sign_url: true, type: typeToTry };
                if (version) options.version = version;
                
                const signedUrl = cloudinary.url(idToTry, options);
                console.log(`📥 Trying signed URL (${typeToTry}): ${idToTry}`);
                pdfBuffer = await fetchFromUrl(signedUrl);
                if (pdfBuffer) {
                  console.log(`✅ Success with signed URL: ${idToTry}`);
                  break outerLoop;
                }
              } catch (e) {
                console.warn(`⚠️  Signed URL failed for ${idToTry} (${typeToTry}): ${e.message}`);
              }
            }
          }
        }
        
        // Final fallback: Try the direct stored URL with Basic Auth
        if (!pdfBuffer && email.attachmentData.cloudinaryUrl) {
          // Normalize URL: ONLY fix typos, do NOT fix folders yet
          let directUrls = [
            email.attachmentData.cloudinaryUrl.replace(/\/uploaad\//g, '/upload/').replace(/\/rraw\//g, '/raw/'),
            email.attachmentData.cloudinaryUrl.replace(/\/uploaad\//g, '/upload/').replace(/\/rraw\//g, '/raw/').replace(/\/resumes\/resumes\//g, '/resumes/')
          ];
          
          for (const url of [...new Set(directUrls)]) {
            try {
              console.log(`📥 Final fallback: Fetching URL: ${url}`);
              pdfBuffer = await fetchFromUrl(url);
              if (pdfBuffer) {
                console.log(`✅ Success with direct URL: ${url}`);
                break;
              }
            } catch (directFail) {
              console.error(`❌ Direct fetch failed for ${url}: ${directFail.message}`);
            }
          }
        }

        if (pdfBuffer) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', pdfBuffer.length);
          res.send(pdfBuffer);
          return;
        }
        
        throw new Error('All Cloudinary fetch attempts failed');
      } catch (cloudinaryError) {
        console.error(`❌ Cloudinary error: ${cloudinaryError.message}`);
        console.error(`   Falling back to local file...`);
      }
    }
    
    // If we reach here, Cloudinary failed or wasn't used - try local file

    // Check if we have a local file path
    if (!email.attachmentData || !email.attachmentData.pdfPath) {
      console.error(`❌ PDF path not found for resume: ${req.params.id}`);
      console.error(`   Email data:`, {
        hasAttachment: email.hasAttachment,
        hasAttachmentData: !!email.attachmentData,
        cloudinaryUrl: email.attachmentData?.cloudinaryUrl,
        pdfPath: email.attachmentData?.pdfPath
      });
      return res.status(404).json({ 
        error: 'PDF file not found for this resume',
        details: 'No PDF path or Cloudinary URL available. The file may not have been uploaded successfully.'
      });
    }

    let pdfPath = email.attachmentData.pdfPath;
    console.log(`📄 PDF path from DB: ${pdfPath}`);
    
    // If pdfPath is a URL, try to fetch it
    if (pdfPath && (pdfPath.startsWith('http://') || pdfPath.startsWith('https://'))) {
      const directUrls = [pdfPath];
      const fixedUrl = pdfPath.replace('/uploaad/', '/upload/').replace('/rraw/', '/raw/');
      if (fixedUrl !== pdfPath) directUrls.push(fixedUrl);

      console.log(`☁️  PDF path is a URL, attempting to fetch...`);
      
      try {
        let pdfBuffer = null;
        for (const url of directUrls) {
          try {
            console.log(`📥 Fetching: ${url}`);
            pdfBuffer = await fetchFromUrl(url);
            if (pdfBuffer) break;
          } catch (e) {
            console.warn(`⚠️  Failed for ${url}: ${e.message}`);
          }
        }

        if (pdfBuffer) {
          console.log(`✅ PDF fetched from URL, size: ${pdfBuffer.length} bytes`);
          console.log(`📤 Sending PDF to client as: ${filename}`);

          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', pdfBuffer.length);
          res.send(pdfBuffer);
          return;
        }
        
        throw new Error('URL fetch failed');
      } catch (urlError) {
        console.error(`❌ Error fetching from URL: ${urlError.message}`);
        console.error(`   Falling back to local file...`);
      }
    }

    // Resolve to absolute path if relative
    if (pdfPath && !pdfPath.startsWith('http') && !path.isAbsolute(pdfPath)) {
      pdfPath = path.resolve(__dirname, '..', pdfPath);
      console.log(`📄 Resolved absolute path: ${pdfPath}`);
    }

    // Check if file exists
    const fileExists = await fs.pathExists(pdfPath);
    if (!fileExists) {
      console.error(`❌ PDF file not found at path: ${pdfPath}`);
      // Try alternative path in uploads directory
      const filename = path.basename(pdfPath);
      const altPath = path.join(__dirname, '../uploads', filename);
      console.log(`🔄 Trying alternative path: ${altPath}`);
      
      if (await fs.pathExists(altPath)) {
        pdfPath = altPath;
        console.log(`✅ Found file at alternative path: ${altPath}`);
      } else {
        return res.status(404).json({ error: 'PDF file not found on server' });
      }
    }

    console.log(`📤 Sending local file: ${pdfPath} as ${filename}`);

    // Use res.sendFile with absolute path
    res.sendFile(pdfPath, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    }, (err) => {
      if (err) {
        console.error('❌ Error sending PDF file:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error reading PDF file: ' + err.message });
        }
      } else {
        console.log(`✅ PDF sent successfully: ${filename}`);
      }
    });

  } catch (error) {
    console.error('❌ Error downloading PDF:', error);
    console.error('Stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download PDF' });
    }
  }
});

// Get a single email by ID (must be after specific routes like /download/:id)
router.get('/:id', async (req, res) => {
  // Don't match if this is a download request (should be caught by /download/:id)
  if (req.path.includes('/download')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  
  try {
    const email = await Email.findById(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json(email);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an email
router.delete('/:id', async (req, res) => {
  try {
    const email = await Email.findByIdAndDelete(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json({ message: 'Email deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add resume from URL
router.post('/add-from-url', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    let pdfUrl;
    try {
      pdfUrl = new URL(url);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Check if URL points to a PDF
    if (!pdfUrl.pathname.toLowerCase().endsWith('.pdf') && !url.toLowerCase().includes('.pdf')) {
      return res.status(400).json({ error: 'URL must point to a PDF file' });
    }

    // Import required modules
    const https = require('https');
    const http = require('http');
    const fs = require('fs-extra');
    const path = require('path');
    const pdfParse = require('pdf-parse');
    const { extractResumeData } = require('../services/pdfParser');

    // Download PDF from URL
    console.log(`📥 Downloading PDF from URL: ${url}`);
    const protocol = pdfUrl.protocol === 'https:' ? https : http;
    
    const pdfBuffer = await new Promise((resolve, reject) => {
      const request = protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download PDF: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });

    console.log(`✓ PDF downloaded, size: ${pdfBuffer.length} bytes`);

    // STEP 1: Upload PDF to Cloudinary FIRST
    console.log('☁️  Step 1: Uploading PDF to Cloudinary...');
    let cloudinaryResult = null;
    let cloudinaryUrl = null;
    let cloudinaryPublicId = null;
    
    try {
      const timestamp = Date.now();
      const cloudinaryFilename = `${timestamp}_resume_from_url`;
      
      cloudinaryResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: 'raw',
            folder: 'resumes',
            public_id: cloudinaryFilename,
            format: 'pdf',
            use_filename: true,
            unique_filename: true
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        );
        
        uploadStream.end(pdfBuffer);
      });
      
      cloudinaryUrl = cloudinaryResult.secure_url || cloudinaryResult.url;
      cloudinaryPublicId = cloudinaryResult.public_id;
      
      console.log('✅ PDF uploaded to Cloudinary successfully!');
      console.log(`   URL: ${cloudinaryUrl}`);
      console.log(`   Public ID: ${cloudinaryPublicId}`);
      
    } catch (cloudinaryError) {
      console.error(`❌ Cloudinary upload failed: ${cloudinaryError.message}`);
      console.error(`⚠️  Continuing with local storage as fallback...`);
      
      // Fallback: Save locally
      const uploadsDir = path.join(__dirname, '../uploads');
      await fs.ensureDir(uploadsDir);
      const timestamp = Date.now();
      const filename = `${timestamp}_resume_from_url.pdf`;
      const pdfPath = path.join(uploadsDir, filename);
      await fs.writeFile(pdfPath, pdfBuffer);
      console.log(`✓ PDF saved locally as fallback: ${pdfPath}`);
    }

    // STEP 2: Extract data from PDF
    console.log('📄 Step 2: Parsing PDF and extracting data...');
    const pdfData = await pdfParse(pdfBuffer);
    const pdfText = pdfData.text;

    // Extract resume data
    console.log('🔍 Extracting resume data...');
    const extractedData = extractResumeData(pdfText);

    const timestamp = Date.now();

    // Create email/resume record
    const resumeData = {
      from: extractedData.email || 'resume@url.com',
      fromName: extractedData.name || 'Resume from URL',
      subject: `Resume: ${extractedData.name || 'Unknown'} - ${extractedData.role || 'No Role'}`,
      body: `Resume added from URL: ${url}\n\nExtracted Information:\n${JSON.stringify(extractedData, null, 2)}`,
      receivedAt: new Date(),
      emailId: `url_${timestamp}`,
      hasAttachment: true,
      attachmentData: {
        ...extractedData,
        cloudinaryUrl: cloudinaryUrl || null,
        cloudinaryPublicId: cloudinaryPublicId || null,
        pdfPath: cloudinaryUrl || (cloudinaryResult ? null : path.join(__dirname, '../uploads', `${timestamp}_resume_from_url.pdf`)),
        rawText: pdfText.substring(0, 5000) // Store first 5000 chars
      }
    };

    // Check if resume already exists
    const existingResume = await Email.findOne({ emailId: resumeData.emailId });
    if (existingResume) {
      return res.status(400).json({ error: 'This resume has already been added' });
    }

    // Save to database
    const savedResume = await Email.create(resumeData);
    console.log(`✅ Resume saved to database: ${savedResume._id}`);

    // Emit socket event for real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('newEmail', {
        message: 'New resume added from URL!',
        email: savedResume
      });
      console.log('✓ Real-time notification sent to frontend');
    }

    res.json({
      message: 'Resume added successfully',
      resume: savedResume
    });

  } catch (error) {
    console.error('❌ Error adding resume from URL:', error);
    res.status(500).json({ error: error.message || 'Failed to process resume from URL' });
  }
});

module.exports = router;
