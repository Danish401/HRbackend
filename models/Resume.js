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
  // Pipeline / categorization
  source: {
    type: String,
    default: 'email',
    index: true
  },
  tags: {
    type: [String],
    default: []
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
    currentSalary: String,
    noticePeriod: String,
    skills: [String],
    education: String,
    summary: String,
    links: {
      linkedin: String,
      github: String,
      portfolio: String
    },
    pdfPath: String,              // URL (Local or S3)
    s3Url: String,                // AWS S3 URL for the PDF
    s3Key: String,                // AWS S3 Key for deletion
    rawText: String,
    // Deduplication
    fileSha256: String,           // SHA256 of PDF file (indexed for duplicate check)
    isDuplicate: { type: Boolean, default: false },
    candidateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Candidate', default: null }
  }
}, {
  timestamps: true
});

emailSchema.index({ 'attachmentData.fileSha256': 1 });
emailSchema.index({
  'attachmentData.name': 'text',
  'attachmentData.location': 'text',
  'attachmentData.skills': 'text',
  'attachmentData.summary': 'text',
  'attachmentData.rawText': 'text'
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
  pdfPath: String,           // URL (Local or S3)
  s3Url: String,             // AWS S3 URL
  s3Key: String,             // AWS S3 Key
  // cloudinaryId: String,      // For delete (kept for backward compatibility) - commented out as per production requirements
  // cloudinaryPublicId: String, // Cloudinary public ID - commented out as per production requirements
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
