const crypto = require('crypto');
const Email = require('../models/Resume');
const Candidate = require('../models/Candidate');

/**
 * Compute SHA256 hash of file buffer for duplicate detection.
 */
function computeFileSha256(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return null;
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Normalize email: lowercase, trim. Empty string if invalid.
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const normalized = email.trim().toLowerCase();
  return normalized.includes('@') ? normalized : '';
}

/**
 * Normalize phone: digits only (optional: with leading +). Empty string if invalid.
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits : '';
}

/**
 * Check if a resume with this file hash already exists (exact duplicate file).
 */
async function findExistingBySha256(sha256) {
  if (!sha256) return null;
  return Email.findOne({ 'attachmentData.fileSha256': sha256 }).lean();
}

/**
 * Find candidate by normalized email (non-empty).
 */
async function findCandidateByEmail(normalizedEmail) {
  if (!normalizedEmail) return null;
  return Candidate.findOne({ normalizedEmail });
}

/**
 * Find candidate by normalized phone (non-empty).
 */
async function findCandidateByPhone(normalizedPhone) {
  if (!normalizedPhone) return null;
  return Candidate.findOne({ normalizedPhone });
}

/**
 * Find existing candidate: first by email, then by phone (per spec order).
 */
async function findCandidateByEmailOrPhone(normalizedEmail, normalizedPhone) {
  const byEmail = await findCandidateByEmail(normalizedEmail);
  if (byEmail) return byEmail;
  return findCandidateByPhone(normalizedPhone);
}

/**
 * Find or create candidate and link this resume (Email id). Updates candidate's latestResumeId and resumeIds.
 */
async function findOrCreateCandidateAndLink(normalizedEmail, normalizedPhone, newEmailId) {
  const existing = await findCandidateByEmailOrPhone(normalizedEmail, normalizedPhone);
  if (existing) {
    existing.resumeIds = existing.resumeIds || [];
    if (!existing.resumeIds.some(id => id.toString() === newEmailId.toString())) {
      existing.resumeIds.push(newEmailId);
    }
    existing.latestResumeId = newEmailId;
    await existing.save();
    return { candidate: existing, isNew: false };
  }
  const candidate = new Candidate({
    normalizedEmail: normalizedEmail || '',
    normalizedPhone: normalizedPhone || '',
    latestResumeId: newEmailId,
    resumeIds: [newEmailId]
  });
  await candidate.save();
  return { candidate, isNew: true };
}

/**
 * Deduplication check and prepare data for save.
 * Order: 1) same file (sha256) → duplicate, don't save.
 *        2) same candidate (email then phone) → attach resume to candidate + update latestResumeId.
 *        3) else → new candidate.
 *
 * @param {Buffer|string} pdfBufferOrSha256 - Raw PDF buffer (for sha256) or precomputed fileSha256 string
 * @param {{ email?: string, contactNumber?: string }} extractedData - Parsed email and phone
 * @returns {{ isDuplicate: true, existingId: string } | { isDuplicate: false, fileSha256: string, normalizedEmail: string, normalizedPhone: string }}
 */
async function checkDuplicateAndPrepare(pdfBufferOrSha256, extractedData) {
  const fileSha256 = Buffer.isBuffer(pdfBufferOrSha256)
    ? computeFileSha256(pdfBufferOrSha256)
    : (typeof pdfBufferOrSha256 === 'string' && pdfBufferOrSha256 ? pdfBufferOrSha256 : null);
  const existingByHash = await findExistingBySha256(fileSha256);
  if (existingByHash) {
    return { isDuplicate: true, existingId: existingByHash._id.toString() };
  }
  const normalizedEmail = normalizeEmail(extractedData?.email || '');
  const normalizedPhone = normalizePhone(extractedData?.contactNumber || '');
  return {
    isDuplicate: false,
    fileSha256: fileSha256 || '',
    normalizedEmail,
    normalizedPhone
  };
}

/**
 * After saving a new Email doc, link it to a candidate (find or create) and set candidateId on the email.
 */
async function linkResumeToCandidate(savedEmail, normalizedEmail, normalizedPhone) {
  const emailId = savedEmail._id;
  const { candidate } = await findOrCreateCandidateAndLink(normalizedEmail, normalizedPhone, emailId);
  if (!savedEmail.attachmentData) savedEmail.attachmentData = {};
  savedEmail.attachmentData.candidateId = candidate._id;
  await savedEmail.save();
  return candidate;
}

module.exports = {
  computeFileSha256,
  normalizeEmail,
  normalizePhone,
  findExistingBySha256,
  findCandidateByEmail,
  findCandidateByPhone,
  findCandidateByEmailOrPhone,
  findOrCreateCandidateAndLink,
  checkDuplicateAndPrepare,
  linkResumeToCandidate
};
