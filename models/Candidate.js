const mongoose = require('mongoose');

/**
 * Candidate groups multiple resumes (emails) for the same person.
 * Deduplication: match by normalized email, then phone; track latest resume.
 */
const candidateSchema = new mongoose.Schema({
  normalizedEmail: { type: String, default: '', index: true },
  normalizedPhone: { type: String, default: '', index: true },
  /** Latest resume (Email doc) for this candidate */
  latestResumeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', default: null },
  /** All resume (Email) IDs for this candidate */
  resumeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Email' }],
}, { timestamps: true });

// Compound index for finding by email or phone
candidateSchema.index({ normalizedEmail: 1 });
candidateSchema.index({ normalizedPhone: 1 });

const Candidate = mongoose.model('Candidate', candidateSchema);
module.exports = Candidate;
