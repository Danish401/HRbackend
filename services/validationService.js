/**
 * Resume Data Validation Service
 * Validates parsed resume data and calculates confidence scores
 */
class ValidationService {
  constructor() {
    this.requiredFields = ['fullName', 'email'];
    this.importantFields = ['contactNumber', 'currentRole', 'experience', 'skills', 'firstName', 'lastName'];
    
    // Email validation regex
    this.emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    // Phone validation (10-15 digits)
    this.phoneRegex = /^\+?[\d\s\-().]{10,15}$/;
    
    console.log('✅ Validation Service initialized');
  }

  /**
   * Validate parsed resume data
   * @param {object} data - Parsed resume data
   * @returns {object} - Validation result with score and warnings
   */
  validateResume(data) {
    const warnings = [];
    let score = 0;
    let maxScore = 0;

    // ===== VALIDATE REQUIRED FIELDS =====
    this.requiredFields.forEach(field => {
      maxScore += 10;
      
      if (!data[field] || data[field].trim() === '') {
        warnings.push(`Missing required field: ${field}`);
      } else {
        score += 10;
        
        // Additional validation for specific fields
        if (field === 'email' && !this.isValidEmail(data.email)) {
          warnings.push(`Invalid email format: ${data.email}`);
          score -= 3; // Penalty for invalid format
        }
        
        if (field === 'fullName' && data.fullName.length < 3) {
          warnings.push('Full name seems too short');
          score -= 2;
        }
      }
    });

    // ===== VALIDATE IMPORTANT FIELDS =====
    this.importantFields.forEach(field => {
      maxScore += 5;
      
      if (!data[field] || (Array.isArray(field) && data[field].length === 0)) {
        warnings.push(`Missing important field: ${field}`);
      } else {
        score += 5;
        
        // Additional validation
        if (field === 'contactNumber' && !this.isValidPhone(data.contactNumber)) {
          warnings.push(`Invalid phone format: ${data.contactNumber}`);
          score -= 2;
        }
        
        if (field === 'experience' && !this.isValidExperience(data.experience)) {
          warnings.push(`Suspicious experience value: ${data.experience}`);
          score -= 2;
        }
        
        if (field === 'skills' && Array.isArray(data.skills)) {
          if (data.skills.length === 0) {
            warnings.push('No skills extracted');
            score -= 3;
          } else if (data.skills.length > 50) {
            warnings.push('Unusually high number of skills detected');
            score -= 2;
          }
        }
        
        if ((field === 'firstName' || field === 'lastName') && (!data[field] || data[field].length < 2)) {
          warnings.push(`${field} is missing or too short`);
          score -= 1;
        }
      }
    });

    // ===== VALIDATE OPTIONAL FIELDS =====
    const optionalFields = ['location', 'education', 'professionalSummary', 'dateOfBirth', 'currentSalary', 'noticePeriod'];
    optionalFields.forEach(field => {
      maxScore += 2;
      
      if (data[field] && data[field].trim() !== '') {
        score += 2;
      }
    });

    // ===== VALIDATE LINKS =====
    maxScore += 3;
    if (data.linkedInProfile || data.githubProfile || data.portfolioWebsite) {
      let hasValidLink = false;
      
      if (data.linkedInProfile && this.isValidUrl(data.linkedInProfile)) {
        score += 1;
        hasValidLink = true;
      }
      
      if (data.githubProfile && this.isValidUrl(data.githubProfile)) {
        score += 1;
        hasValidLink = true;
      }
      
      if (data.portfolioWebsite && this.isValidUrl(data.portfolioWebsite)) {
        score += 1;
        hasValidLink = true;
      }
      
      if (!hasValidLink) {
        warnings.push('No valid social/profile links found');
      }
    } else {
      warnings.push('Links object missing');
    }

    // ===== VALIDATE WORK HISTORY =====
    maxScore += 5;
    if (data.workHistory && Array.isArray(data.workHistory)) {
      if (data.workHistory.length > 0) {
        score += Math.min(5, data.workHistory.length);
        
        // Check for completeness of work history entries
        const completeEntries = data.workHistory.filter(job => 
          job.company && job.position
        ).length;
        
        if (completeEntries < data.workHistory.length) {
          warnings.push(`${data.workHistory.length - completeEntries} incomplete work history entries`);
        }
      } else {
        warnings.push('No work history entries found');
      }
    } else {
      warnings.push('Work history array missing');
    }

    // ===== CHECK FOR DUPLICATE INFORMATION =====
    if (this.hasDuplicateInfo(data)) {
      warnings.push('Potential duplicate or redundant information detected');
      score -= 3;
    }

    // ===== CHECK TEXT QUALITY =====
    if (data.professionalSummary && data.professionalSummary.length < 20) {
      warnings.push('Professional summary is too short or generic');
      score -= 1;
    }

    // ===== CALCULATE CONFIDENCE PERCENTAGE =====
    const confidence = Math.max(0, Math.min(100, Math.round((score / maxScore) * 100)));

    // ===== DETERMINE IF MANUAL REVIEW NEEDED =====
    const needsReview = 
      confidence < 70 ||
      !data.fullName ||
      !data.email ||
      warnings.length > 5;

    return {
      isValid: confidence >= 50,
      confidence,
      score,
      maxScore,
      warnings,
      needsReview,
      reviewReasons: this.getReviewReasons(confidence, data, warnings)
    };
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    if (!email) return false;
    return this.emailRegex.test(email);
  }

  /**
   * Validate phone number format
   */
  isValidPhone(phone) {
    if (!phone) return false;
    const cleaned = phone.replace(/[\s\-().]/g, '');
    return /^\+?\d{10,15}$/.test(cleaned);
  }

  /**
   * Validate experience format
   */
  isValidExperience(experience) {
    if (!experience) return false;
    // Should contain a number and "year/years"
    return /\d+\s*(years?|yrs?)/i.test(experience);
  }

  /**
   * Validate URL format
   */
  isValidUrl(url) {
    if (!url) return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check for duplicate/redundant information
   */
  hasDuplicateInfo(data) {
    // Check if name appears in summary (redundant)
    if (data.name && data.summary) {
      const normalizedName = data.name.toLowerCase().trim();
      const normalizedSummary = data.summary.toLowerCase();
      
      if (normalizedSummary.includes(normalizedName)) {
        return true;
      }
    }

    // Check for repeated phrases in summary
    if (data.summary && data.summary.length > 100) {
      const words = data.summary.split(/\s+/);
      const wordFreq = {};
      
      words.forEach(word => {
        if (word.length > 4) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      });
      
      const maxFrequency = Math.max(...Object.values(wordFreq));
      if (maxFrequency > 5) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get detailed review reasons
   */
  getReviewReasons(confidence, data, warnings) {
    const reasons = [];

    if (confidence < 50) {
      reasons.push('Very low confidence score (< 50%)');
    } else if (confidence < 70) {
      reasons.push('Low confidence score (< 70%)');
    }

    if (!data.fullName) {
      reasons.push('Candidate full name not extracted');
    }

    if (!data.firstName || !data.lastName) {
      reasons.push('First name or last name missing');
    }

    if (!data.email) {
      reasons.push('Email address not extracted');
    }

    if (!data.contactNumber) {
      reasons.push('Contact number not extracted');
    }

    if (!data.currentRole) {
      reasons.push('Current role not extracted');
    }

    if (warnings.length > 5) {
      reasons.push(`Multiple validation warnings (${warnings.length})`);
    }

    return reasons;
  }

  /**
   * Batch validate multiple resumes
   */
  batchValidate(resumesData) {
    const results = [];
    
    resumesData.forEach((data, index) => {
      const validation = this.validateResume(data);
      results.push({
        index,
        ...validation,
        data
      });
    });
    
    return results;
  }

  /**
   * Get validation statistics
   */
  getValidationStats(validations) {
    const total = validations.length;
    const valid = validations.filter(v => v.isValid).length;
    const needsReview = validations.filter(v => v.needsReview).length;
    const avgConfidence = Math.round(
      validations.reduce((sum, v) => sum + v.confidence, 0) / total
    );

    return {
      total,
      valid,
      invalid: total - valid,
      needsReview,
      avgConfidence,
      reviewRate: Math.round((needsReview / total) * 100)
    };
  }
}

module.exports = new ValidationService();
