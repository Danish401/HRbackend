const express = require('express');
const router = express.Router();
const { s3Client, bucketName } = require('../config/s3');
const { Upload } = require("@aws-sdk/lib-storage");
const upload = require('../middleware/upload');
const pdfParse = require('pdf-parse');
const Email = require('../models/Resume');
const { extractResumeData } = require('../services/pdfParser');

router.post('/upload', upload.array('resumes', 25), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      try {
        // 1️⃣ Upload to AWS S3
        const timestamp = Date.now();
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const s3Key = `resumes/${timestamp}_${sanitizedFilename}`;

        const uploadResult = await new Upload({
          client: s3Client,
          params: {
            Bucket: bucketName,
            Key: s3Key,
            Body: file.buffer,
            ContentType: 'application/pdf',
          },
        }).done();

        const s3Url = uploadResult.Location;

        // 2️⃣ Extract text from PDF buffer (cheap, no OCR yet)
        const pdfData = await pdfParse(file.buffer);
        const rawText = pdfData.text || '';

        // 3️⃣ Extract structured data
        const extractedData = extractResumeData(rawText);

        // 4️⃣ Save in MongoDB (using Email model structure for frontend compatibility)
        const resumeData = {
          from: extractedData.email || 'upload@user.com',
          fromName: extractedData.name || file.originalname,
          subject: `Web Upload: ${file.originalname}`,
          body: `Resume uploaded via web dashboard.`,
          receivedAt: new Date(),
          emailId: `web_${timestamp}_${Math.random().toString(36).substr(2, 5)}`,
          hasAttachment: true,
          attachmentData: {
            ...extractedData,
            rawText,
            pdfPath: s3Url,
            s3Url: s3Url,
            s3Key: s3Key
          }
        };

        const resume = await Email.create(resumeData);

        // 5️⃣ Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
          io.emit('newEmail', {
            message: `New resume uploaded: ${file.originalname}`,
            email: resume
          });
        }

        results.push({
          status: 'success',
          file: file.originalname,
          resumeId: resume._id
        });
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        results.push({
          status: 'error',
          file: file.originalname,
          error: fileError.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${results.filter(r => r.status === 'success').length} files successfully`,
      results
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
