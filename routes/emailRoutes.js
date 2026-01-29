const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const pdfParse = require('pdf-parse');
const mongoose = require('mongoose');
const { extractResumeData } = require('../services/pdfParser');
const Email = require('../models/Resume'); // Model is renamed to Email but file is still Resume.js
const cloudinary = require('../config/cloudinary');

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
  
  // STEP 1: Upload PDF to Cloudinary FIRST
  console.log('☁️  Step 1: Uploading PDF to Cloudinary...');
  let cloudinaryResult = null;
  let cloudinaryUrl = null;
  let cloudinaryPublicId = null;
  
  try {
    const timestamp = Date.now();
    const sanitizedFilename = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\s+/g, '_');
    
    const cloudinaryFilename = `resumes/${timestamp}_${sanitizedFilename}`;
    
    // Upload to Cloudinary
    cloudinaryResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'resumes',
          public_id: cloudinaryFilename.replace('.pdf', ''),
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
  }

  // STEP 2: Extract data from PDF
  console.log('📄 Step 2: Parsing PDF and extracting data...');
  
  const pdfData = await pdfParse(pdfBuffer);
  const pdfText = pdfData.text;

  if (!pdfText || pdfText.length === 0) {
    // Clean up local file if Cloudinary succeeded
    if (cloudinaryUrl) {
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
    // Clean up local file if Cloudinary succeeded
    if (cloudinaryUrl) {
      await fs.remove(file.path);
    }
    throw new Error('Database connection unavailable. Please try again later.');
  }

  // Create email/resume record
  const resumeData = {
    from: extractedData.email || 'upload@youhrpower.com',
    fromName: extractedData.name || 'Resume Upload',
    subject: `Resume Upload: ${extractedData.name || 'Unknown'} - ${extractedData.role || 'No Role'}`,
    body: `Resume uploaded directly via shareable link.\n\nFile: ${file.originalname}\n\nExtracted Information:\n${JSON.stringify(extractedData, null, 2)}`,
    receivedAt: new Date(),
    emailId: `upload_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    hasAttachment: true,
    attachmentData: {
      ...extractedData,
      cloudinaryUrl: cloudinaryUrl || null,
      cloudinaryPublicId: cloudinaryPublicId || null,
      pdfPath: cloudinaryUrl || file.path, // Use Cloudinary URL if available, otherwise local path
      rawText: pdfText.substring(0, 5000) // Store first 5000 chars
    }
  };

  // Save to database
  const savedResume = await Email.create(resumeData);
  console.log(`✅ Resume saved to database: ${savedResume._id}`);

  // Clean up local file if Cloudinary upload succeeded
  if (cloudinaryUrl) {
    try {
      await fs.remove(file.path);
      console.log(`✓ Local file removed (using Cloudinary URL)`);
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

    // Check if PDF is stored in Cloudinary
    if (email.attachmentData && email.attachmentData.cloudinaryUrl) {
      console.log(`☁️  PDF stored in Cloudinary: ${email.attachmentData.cloudinaryUrl}`);
      
      try {
        const cloudinaryPublicId = email.attachmentData.cloudinaryPublicId;
        
        if (cloudinaryPublicId) {
          console.log(`📥 Generating Cloudinary download URL (Public ID: ${cloudinaryPublicId})...`);
          
          // Use Cloudinary's URL helper to generate a proper download URL
          // For raw files, we need to specify resource_type: 'raw'
          let downloadUrl;
          
          try {
            // Generate URL using Cloudinary API - this ensures proper format
            downloadUrl = cloudinary.url(cloudinaryPublicId, {
              resource_type: 'raw',
              secure: true,
              // Add attachment flag to force download
              flags: 'attachment'
            });
            
            console.log(`✅ Generated Cloudinary URL: ${downloadUrl}`);
          } catch (urlError) {
            console.warn(`⚠️  Could not generate URL with API, using stored URL: ${urlError.message}`);
            downloadUrl = email.attachmentData.cloudinaryUrl;
            
            // Ensure it's the correct format for raw files
            if (!downloadUrl.includes('/raw/upload/') && downloadUrl.includes('/upload/')) {
              downloadUrl = downloadUrl.replace('/upload/', '/raw/upload/');
            }
          }
          
          // Fetch PDF from Cloudinary
          const https = require('https');
          const http = require('http');
          
          console.log(`📥 Fetching PDF from Cloudinary: ${downloadUrl}`);
          
          const pdfBuffer = await new Promise((resolve, reject) => {
            const urlObj = new URL(downloadUrl);
            const protocol = urlObj.protocol === 'https:' ? https : http;
            
            const request = protocol.get(downloadUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              followRedirect: true
            }, (response) => {
              // Handle redirects (Cloudinary might redirect)
              if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = response.headers.location;
                console.log(`🔄 Following redirect to: ${redirectUrl}`);
                
                const redirectProtocol = redirectUrl.startsWith('https:') ? https : http;
                const redirectRequest = redirectProtocol.get(redirectUrl, (redirectResponse) => {
                  if (redirectResponse.statusCode !== 200) {
                    reject(new Error(`Failed after redirect: ${redirectResponse.statusCode}`));
                    return;
                  }
                  
                  const chunks = [];
                  redirectResponse.on('data', (chunk) => chunks.push(chunk));
                  redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
                  redirectResponse.on('error', reject);
                });
                
                redirectRequest.on('error', reject);
                redirectRequest.setTimeout(30000, () => {
                  redirectRequest.destroy();
                  reject(new Error('Redirect fetch timeout'));
                });
                
                return;
              }
              
              if (response.statusCode === 401 || response.statusCode === 403) {
                // If still unauthorized, the file might be private or URL is wrong
                // Try using the original stored URL as-is
                console.warn(`⚠️  Got ${response.statusCode}, trying original stored URL...`);
                
                const originalUrl = email.attachmentData.cloudinaryUrl;
                const originalProtocol = originalUrl.startsWith('https:') ? https : http;
                const originalRequest = originalProtocol.get(originalUrl, (originalResponse) => {
                  if (originalResponse.statusCode !== 200) {
                    reject(new Error(`Original URL also failed: ${originalResponse.statusCode}. File might be private or URL incorrect.`));
                    return;
                  }
                  
                  const chunks = [];
                  originalResponse.on('data', (chunk) => chunks.push(chunk));
                  originalResponse.on('end', () => resolve(Buffer.concat(chunks)));
                  originalResponse.on('error', reject);
                });
                
                originalRequest.on('error', reject);
                originalRequest.setTimeout(30000, () => {
                  originalRequest.destroy();
                  reject(new Error('Original URL fetch timeout'));
                });
                
                return;
              }
              
              if (response.statusCode !== 200) {
                reject(new Error(`Failed to fetch PDF from Cloudinary: ${response.statusCode} ${response.statusMessage}`));
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
              reject(new Error('Cloudinary fetch timeout'));
            });
          });

          console.log(`✅ PDF fetched from Cloudinary, size: ${pdfBuffer.length} bytes`);
          console.log(`📤 Sending PDF to client as: ${filename}`);

          // Set headers and send PDF
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.setHeader('Content-Length', pdfBuffer.length);
          res.send(pdfBuffer);
          
          return;
        } else {
          // No public ID - this shouldn't happen if upload was successful
          console.log(`⚠️  No Cloudinary public ID found`);
          throw new Error('Cloudinary public ID missing');
        }
      } catch (cloudinaryError) {
        console.error(`❌ Error fetching from Cloudinary: ${cloudinaryError.message}`);
        console.error(`   Cloudinary URL: ${email.attachmentData?.cloudinaryUrl}`);
        console.error(`   Public ID: ${email.attachmentData?.cloudinaryPublicId}`);
        console.error(`   Error details:`, cloudinaryError);
        console.error(`   Falling back to local file...`);
        // Fall through to try local file - don't return here
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
    
    // Skip URL handling if it's a Cloudinary URL (already tried above)
    // Only handle non-Cloudinary URLs here
    if (pdfPath && (pdfPath.startsWith('http://') || pdfPath.startsWith('https://'))) {
      // Check if it's a Cloudinary URL - if so, we already tried it above
      if (pdfPath.includes('cloudinary.com') || pdfPath.includes('res.cloudinary.com')) {
        console.error(`❌ Cloudinary URL failed, and no local file path available`);
        return res.status(500).json({ 
          error: 'Failed to download PDF from Cloudinary',
          details: 'The PDF is stored in Cloudinary but could not be accessed. Please check Cloudinary configuration or re-upload the file.'
        });
      }
      console.log(`☁️  PDF path is a URL (non-Cloudinary), fetching from: ${pdfPath}`);
      
      try {
        const https = require('https');
        const http = require('http');
        const url = new URL(pdfPath);
        const protocol = url.protocol === 'https:' ? https : http;
        
        const pdfBuffer = await new Promise((resolve, reject) => {
          const request = protocol.get(pdfPath, (response) => {
            if (response.statusCode !== 200) {
              reject(new Error(`Failed to fetch PDF: ${response.statusCode}`));
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
            reject(new Error('PDF fetch timeout'));
          });
        });

        console.log(`✅ PDF fetched from URL, size: ${pdfBuffer.length} bytes`);
        console.log(`📤 Sending PDF to client as: ${filename}`);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
        
        return;
      } catch (urlError) {
        console.error(`❌ Error fetching from URL: ${urlError.message}`);
        // Don't return here - fall through to try local file
        console.error(`   Falling back to local file...`);
      }
    }

    // Resolve to absolute path if relative
    if (!path.isAbsolute(pdfPath)) {
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
      const cloudinaryFilename = `resumes/${timestamp}_resume_from_url`;
      
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
