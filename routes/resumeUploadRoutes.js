const express = require('express');
const router = express.Router();
const cloudinary = require('../config/cloudinary');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Resume = require('../models/Resume');
const { extractResumeData } = require('../utils/extractResumeData');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'PDF file required' });
    }

    // 1️⃣ Upload PDF to Cloudinary
    const cloudinaryResult = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'resumes',
          resource_type: 'raw'
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // 2️⃣ Extract text from PDF
    const pdfData = await pdfParse(req.file.buffer);
    const rawText = pdfData.text || '';

    // 3️⃣ Extract structured resume data
    const extracted = extractResumeData(rawText);

    // 4️⃣ Save in MongoDB
    const resume = await Resume.create({
      ...extracted,
      rawText,
      pdfPath: cloudinaryResult.secure_url,
      cloudinaryId: cloudinaryResult.public_id,
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
