const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Gemini AI Service for Intelligent Resume Parsing
 * Uses Google's Generative AI to extract structured data from resume text
 */
class GeminiAIService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    this.modelName = 'gemini-1.5-flash'; // Fast and efficient for structured extraction
    
    if (!this.apiKey) {
      console.warn('⚠️  GEMINI_API_KEY not found in environment variables');
      console.warn('   Gemini AI parsing will be disabled. Set GEMINI_API_KEY to enable.');
    } else {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
      console.log('✅ Gemini AI initialized');
    }
  }

  /**
   * Parse resume text using Gemini AI
   * @param {string} text - Raw text extracted from resume
   * @returns {Promise<object>} - Parsed resume data in structured format
   */
  async parseResume(text) {
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text provided for parsing');
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: this.modelName });

      // Enhanced prompt for comprehensive resume extraction
      const prompt = this._buildPrompt(text);

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const textResponse = response.text();

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = textResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonString = jsonMatch ? jsonMatch[1].trim() : textResponse.trim();

      const parsedData = JSON.parse(jsonString);

      // Validate and normalize the parsed data
      const validatedData = this._validateAndNormalize(parsedData);

      console.log('✅ Gemini AI successfully parsed resume');
      return {
        success: true,
        data: validatedData,
        confidence: this._calculateConfidence(validatedData),
        source: 'gemini-ai'
      };

    } catch (error) {
      console.error('❌ Gemini AI parsing error:', error.message);
      
      // If JSON parsing fails, try to extract basic info as fallback
      if (error instanceof SyntaxError) {
        console.warn('⚠️  Response was not valid JSON, attempting fallback extraction');
        return this._fallbackExtraction(text);
      }

      throw error;
    }
  }

  /**
   * Build the prompt for Gemini AI
   */
  _buildPrompt(text) {
    return `You are an expert resume parser. Extract the following information from the resume text below and return it as a JSON object.

IMPORTANT: 
- Do NOT extract section headers (SUMMARY, SKILLS, EXPERIENCE, EDUCATION, etc.) as data
- The candidate's name is usually at the top, NOT section titles
- Return empty string "" if field not found, never use null

REQUIRED FIELDS - Extract these EXACTLY:
{
  "fullName": "Complete full name (e.g., 'ADITYA RAGHAV' or 'Aditya Raghav') - DO NOT include company names or section headers",
  "firstName": "First name only (e.g., 'ADITYA' or 'Aditya')",
  "lastName": "Last name only (e.g., 'RAGHAV' or 'Raghav')",
  "contactNumber": "Phone number with country code (e.g., '+91 9045761043' or '9045761043')",
  "currentRole": "Current/most recent job title (e.g., 'Web Designer', 'Software Engineer')",
  "experience": "Total years of experience as number (e.g., '3.11' or '5' or '2.5')",
  "email": "Email address (e.g., 'adityaraghav86656@gmail.com')",
  "dateOfBirth": "Date of birth in DD/MM/YYYY format (e.g., '27/06/2002')",
  "location": "City, State/Country (e.g., 'Gurugram, India' or 'New York, USA')",
  "currentSalary": "Current salary if mentioned (e.g., '$80,000' or 'INR 10 LPA'), else ''",
  "noticePeriod": "Notice period/days available to join (e.g., '30 days' or '2 weeks' or 'Immediate'), else ''",
  "linkedInProfile": "Full LinkedIn URL (e.g., 'https://www.linkedin.com/in/adityaraghav')",
  "githubProfile": "Full GitHub URL (e.g., 'https://github.com/adityaraghav')",
  "portfolioWebsite": "Personal website/portfolio URL (e.g., 'https://adityaraghav.design')",
  "professionalSummary": "Professional summary/objective paragraph (2-4 sentences)",
  "skills": ["array", "of", "technical", "skills", "only", "technologies"],
  "education": "Highest degree or education details (e.g., 'Bachelor of Technology in Computer Science, 2020-2024')",
  "workHistory": [
    {
      "company": "Company name",
      "position": "Job title",
      "duration": "Employment period (e.g., 'Jan 2022 - Present')",
      "description": "Brief description of role"
    }
  ],
  "certifications": ["array", "of", "certifications", "if", "any"]
}

CRITICAL RULES:
1. Return ONLY valid JSON - no explanations, no markdown, no extra text
2. DO NOT extract section headers as data (ignore: SUMMARY, SKILLS, EXPERIENCE, EDUCATION, PERSONAL DETAILS, etc.)
3. Candidate name is typically at the TOP of resume, often in all caps or larger font
4. For experience, extract ONLY the number (e.g., if text says "3.11 years", return "3.11")
5. Skills should be individual technologies/tools (HTML, CSS, JavaScript, React, Node.js, etc.)
6. Keep formatting clean and professional
7. Normalize phone numbers to include country code if present
8. Extract ALL URLs for LinkedIn, GitHub, and portfolio
9. If a field is not found, use empty string "" or empty array []
10. First name and Last name should be separated properly (not combined)

RESUME TEXT TO PARSE:
${text}

Return the JSON object now (no markdown, just raw JSON):`;
  }

  /**
   * Validate and normalize the parsed data
   */
  _validateAndNormalize(data) {
    // Handle both old format (name) and new format (fullName)
    const fullName = data.fullName || data.name || '';
    const firstName = data.firstName || '';
    const lastName = data.lastName || '';
    
    // If firstName/lastName not provided but fullName is, try to split
    let finalFirstName = firstName;
    let finalLastName = lastName;
    
    if (!finalFirstName && !finalLastName && fullName) {
      const nameParts = fullName.trim().split(/\s+/);
      if (nameParts.length >= 2) {
        finalFirstName = nameParts[0];
        finalLastName = nameParts.slice(1).join(' ');
      } else if (nameParts.length === 1) {
        finalFirstName = nameParts[0];
        finalLastName = '';
      }
    }
    
    const normalized = {
      fullName: fullName.trim(),
      firstName: finalFirstName.trim(),
      lastName: finalLastName.trim(),
      email: (data.email || '').toLowerCase().trim(),
      contactNumber: (data.contactNumber || '').trim(),
      currentRole: (data.currentRole || data.role || '').trim(),
      experience: (data.experience || '').trim(),
      dateOfBirth: (data.dateOfBirth || '').trim(),
      location: (data.location || '').trim(),
      currentSalary: (data.currentSalary || '').trim(),
      noticePeriod: (data.noticePeriod || '').trim(),
      linkedInProfile: (data.linkedInProfile || data.links?.linkedin || '').trim(),
      githubProfile: (data.githubProfile || data.links?.github || '').trim(),
      portfolioWebsite: (data.portfolioWebsite || data.links?.portfolio || '').trim(),
      professionalSummary: (data.professionalSummary || data.summary || '').trim(),
      skills: Array.isArray(data.skills) ? data.skills.filter(s => s && s.trim()) : [],
      education: (data.education || '').trim(),
      workHistory: Array.isArray(data.workHistory) ? data.workHistory : [],
      certifications: Array.isArray(data.certifications) ? data.certifications : []
    };

    // Clean up any null values that might have been returned
    Object.keys(normalized).forEach(key => {
      if (normalized[key] === null || normalized[key] === 'null') {
        normalized[key] = key === 'skills' || key === 'workHistory' || key === 'certifications' ? [] : '';
      }
    });

    return normalized;
  }

  /**
   * Calculate confidence score based on completeness of extracted data
   */
  _calculateConfidence(data) {
    let score = 0;
    let maxScore = 0;

    // Critical fields (weight: 3 points each)
    ['fullName', 'email', 'contactNumber', 'currentRole'].forEach(field => {
      maxScore += 3;
      if (data[field] && data[field].length > 0) score += 3;
    });

    // Important fields (weight: 2 points each)
    ['experience', 'location', 'skills', 'firstName', 'lastName'].forEach(field => {
      maxScore += 2;
      if (field === 'skills') {
        if (data.skills && data.skills.length > 0) score += 2;
      } else if (data[field] && data[field].length > 0) score += 2;
    });

    // Additional fields (weight: 1 point each)
    ['dateOfBirth', 'education', 'professionalSummary'].forEach(field => {
      maxScore += 1;
      if (data[field] && data[field].length > 0) score += 1;
    });

    // Links (weight: 1 point total)
    maxScore += 1;
    if (data.linkedInProfile || data.githubProfile || data.portfolioWebsite) {
      score += 1;
    }

    // Work history adds bonus points
    maxScore += 2;
    if (data.workHistory && data.workHistory.length > 0) {
      score += Math.min(2, data.workHistory.length * 0.5);
    }

    // Salary and notice period (nice to have)
    maxScore += 1;
    if (data.currentSalary || data.noticePeriod) {
      score += 0.5;
    }

    return Math.round((score / maxScore) * 100);
  }

  /**
   * Fallback extraction if Gemini fails
   */
  _fallbackExtraction(text) {
    console.warn('⚠️  Using fallback pattern-based extraction');
    
    // Import the existing pattern-based extractor
    const { extractResumeData } = require('./pdfParser');
    const data = extractResumeData(text);
    
    return {
      success: true,
      data: data,
      confidence: this._calculateConfidence(data),
      source: 'fallback-pattern'
    };
  }

  /**
   * Batch parse multiple resumes
   */
  async batchParse(resumesTextArray) {
    const results = [];
    
    for (let i = 0; i < resumesTextArray.length; i++) {
      try {
        const result = await this.parseResume(resumesTextArray[i]);
        results.push({
          index: i,
          success: true,
          ...result
        });
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = new GeminiAIService();
