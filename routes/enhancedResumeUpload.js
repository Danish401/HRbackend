const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const { s3Client, bucketName } = require('../config/s3');
const { Upload } = require('@aws-sdk/lib-storage');
const crypto = require('crypto');

/**
 * Enhanced Resume Upload Route with Complete Pipeline
 * Supports: PDF, DOCX, Images
 * Features: OCR, Gemini AI parsing, duplicate check, validation
 */

// POST /api/resume-upload/pipeline
router.post('/pipeline', upload.array('resumes', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No files uploaded' 
      });
    }

    console.log(`\n📥 Received ${req.files.length} resume(s) for processing`);
    
    const results = [];

    // Process each file synchronously
    for (const file of req.files) {
      try {
        // Generate unique job ID
        const jobId = `resume_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        
        // Upload to S3 first (for permanent storage)
        let s3Url = null;
        let s3Key = null;
        
        try {
          const timestamp = Date.now();
          const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
          s3Key = `resumes/${timestamp}_${sanitizedFilename}`;

          const uploadResult = await new Upload({
            client: s3Client,
            params: {
              Bucket: bucketName,
              Key: s3Key,
              Body: file.buffer,
              ContentType: file.mimetype,
            },
          }).done();

          s3Url = uploadResult.Location;
          console.log(`✅ Uploaded ${file.originalname} to S3`);
        } catch (s3Error) {
          console.warn(`⚠️  S3 upload failed for ${file.originalname}, using local storage`);
        }

        // Prepare job data
        const jobData = {
          fileId: jobId,
          filename: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          fileBuffer: file.buffer,
          s3Url,
          s3Key,
          source: 'web-upload',
          uploadedAt: new Date(),
          priority: 0
        };

        // Process the file synchronously
        const worker = require('../services/pageByPageProcessor');
        const processResult = await worker.processJob(jobData);

      } catch (fileError) {
        console.error(`❌ Error processing ${file.originalname}:`, fileError.message);
        results.push({
          status: 'error',
          file: file.originalname,
          error: fileError.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processing ${results.length} resume(s)`,
      results,
      processingMode: 'sync'
    });

  } catch (error) {
    console.error('❌ Upload route error:', error.message);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET /api/resume-upload/stats - Get processing statistics
router.get('/stats', async (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Statistics endpoint available',
      processingMode: 'sync'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
