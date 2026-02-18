const mongoose = require('mongoose');

// Email schema (used by emailService)
const emailSchema = new mongoose.Schema({
  from: {
    type: String,
    required: true
  },
  fromName: {
    type: String
  },
  subject: {
    type: String,
    default: 'No Subject'
  },
  body: {
     type: String,
    default: ""
  },
  receivedAt: {
    type: Date,
    required: true
  },
  emailId: {
    type: String,
    unique: true  // To avoid duplicate emails
  },
  // PDF attachment data (if PDF is attached)
  hasAttachment: {
    type: Boolean,
    default: false
  },
  attachmentData: {
    name: String,
    email: String,
    contactNumber: String,
    dateOfBirth: String,
    experience: String,
    role: String,
    location: String,
    skills: [String],
    education: String,
    summary: String,
    links: {
      linkedin: String,
      github: String,
      portfolio: String
    },
    pdfPath: String,              // URL (Local, Cloudinary or S3)
    s3Url: String,                // AWS S3 URL for the PDF
    s3Key: String,                // AWS S3 Key for deletion
    cloudinaryUrl: String,         // Cloudinary URL for the PDF
    cloudinaryPublicId: String,   // Cloudinary public ID for deletion
    rawText: String
  }
}, {
  timestamps: true
});

// Resume schema (for direct uploads)
const resumeSchema = new mongoose.Schema({
  name: String,
  email: String,
  contactNumber: String,
  dateOfBirth: String,
  experience: String,
  role: String,
  location: String,
  skills: [String],
  education: String,
  summary: String,
  links: {
    linkedin: String,
    github: String,
    portfolio: String
  },
  pdfPath: String,           // URL (Cloudinary or S3)
  s3Url: String,             // AWS S3 URL
  s3Key: String,             // AWS S3 Key
  cloudinaryId: String,      // For delete (kept for backward compatibility)
  cloudinaryPublicId: String, // Cloudinary public ID
  rawText: String,
  extractedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Export both models
const Email = mongoose.model('Email', emailSchema);
const Resume = mongoose.model('Resume', resumeSchema);

// Export Email as default (for emailService compatibility)
module.exports = Email;
module.exports.Resume = Resume;
