const express = require('express');
const router = express.Router();
const cloudinary = require('../config/cloudinary');
const upload = require('../middleware/upload');
const pdfParse = require('pdf-parse');
const Resume = require('../models/Resume');
const { extractResumeData } = require('../utils/extractResumeData');

router.post('/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 1️⃣ Upload to Cloudinary
    const uploadResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'resumes',
          resource_type: 'raw', // IMPORTANT for PDFs
          format: 'pdf'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // 2️⃣ Extract text from PDF buffer (cheap, no OCR yet)
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text || '';

    // 3️⃣ Extract structured data
    const extractedData = extractResumeData(rawText);

    // 4️⃣ Save to MongoDB
    const resume = await Resume.create({
      ...extractedData,
      rawText,
      pdfPath: uploadResult.secure_url,
      cloudinaryId: uploadResult.public_id,
      extractedAt: new Date()
    });

    res.json({
      success: true,
      resume
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
