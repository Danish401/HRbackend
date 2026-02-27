/**
 * Detects the layout type of the resume
 * @param {string} text - Original resume text
 * @returns {string} Layout type ('classic', 'modern', 'chronological', 'functional', 'combination', 'unknown')
 */
function detectLayoutType(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  let hasSkillsSection = false;
  let hasExperienceSection = false;
  let hasEducationSection = false;
  let hasSummarySection = false;
  
  for (const line of lines) {
    const lowerLine = line.toLowerCase();
    if (lowerLine.includes('skills')) hasSkillsSection = true;
    if (lowerLine.includes('experience') || lowerLine.includes('work')) hasExperienceSection = true;
    if (lowerLine.includes('education') || lowerLine.includes('academic')) hasEducationSection = true;
    if (lowerLine.includes('summary') || lowerLine.includes('objective')) hasSummarySection = true;
  }
  
  // Classic layout: Name, Contact Info, Skills, Experience, Education
  if (hasSkillsSection && hasExperienceSection && hasEducationSection) {
    return 'classic';
  }
  
  // Chronological: Name, Contact, Experience, Education, Skills
  if (hasExperienceSection && hasEducationSection && hasSkillsSection) {
    return 'chronological';
  }
  
  // Functional: Skills, Experience, Education (skills first)
  if (hasSkillsSection && hasExperienceSection && hasEducationSection && lines[0]?.toLowerCase().includes('skills')) {
    return 'functional';
  }
  
  // Combination: Mix of skills and experience
  if (hasSkillsSection && hasExperienceSection) {
    return 'combination';
  }
  
  return 'unknown';
}

/**
 * Extracts structured data from resume PDF text
 * Improved patterns based on common resume formats
 */
function extractResumeData(text) {
  const data = {
    name: '',
    email: '',
    contactNumber: '',
    dateOfBirth: '',
    experience: '',
    role: '',
    location: '',
    skills: [],
    education: '',
    summary: '',
    links: {
      linkedin: '',
      github: '',
      portfolio: ''
    },
    layoutType: 'unknown'
  };

  if (!text || text.length === 0) {
    console.log('⚠️  PDF text is empty');
    return data;
  }

  console.log(`📄 PDF text length: ${text.length} characters`);
  console.log(`📄 First 500 chars: ${text.substring(0, 500)}`);

  // Detect layout type
  data.layoutType = detectLayoutType(text);
  console.log(`📊 Detected layout type: ${data.layoutType}`);

  // Keep original text with newlines for better pattern matching
  const originalText = text;
  const lines = originalText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  console.log(`📄 Total lines: ${lines.length}`);
  console.log(`📄 First 10 lines:`, lines.slice(0, 10));

  // ========== EXTRACT NAME ==========
  console.log('🔍 Extracting name...');
  
  // Strategy 1: Look for "Name:" or "Full Name:" patterns (case insensitive)
  const namePatterns1 = [
    /(?:^|\n)\s*name\s*[:=]?\s*([^\n\r]+)/i,
    /(?:^|\n)\s*full\s*name\s*[:=]?\s*([^\n\r]+)/i,
    /name\s*[:=]?\s*([A-Za-z\s]+)/i,
    /full\s*name\s*[:=]?\s*([A-Za-z\s]+)/i,
    /(?:^|\s)(?:mr\.?|mrs\.?|miss\.?|ms\.?)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i
  ];
  
  for (const pattern of namePatterns1) {
    const match = originalText.match(pattern);
    if (match && match[1]) {
      let extractedName = match[1].trim();
      // Clean up the extracted name
      extractedName = extractedName.replace(/^[=:\s]+|[=:\s]+$/, '').trim();
      if (extractedName.length > 1 && extractedName.length < 100) { // Reasonable name length
        data.name = extractedName;
        console.log(`✓ Name found (pattern 1): "${data.name}"`);
        break;
      }
    }
  }

  // Strategy 2: Look for all-caps name at the start (common in resumes)
  // First check if first few lines are all caps (could be name even if single word)
  if (!data.name) {
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const line = lines[i];
      // Check if line is all uppercase and 2-4 words
      if (line === line.toUpperCase() && line.length > 2 && line.length < 50) {
        const words = line.split(/\s+/);
        if (words.length >= 1 && words.length <= 4 && /^[A-Z\s\.\-]+$/.test(line)) {
          // Additional check: ensure it doesn't look like a job title or other header
          const lowerLine = line.toLowerCase();
          const excludeKeywords = ['last updated', 'updated', 'resume', 'cv', 'curriculum', 'vitae', 'contact', 'information', 'profile', 'summary', 'objective', 'experience', 'education', 'skills', 'projects'];
          
          if (!excludeKeywords.some(keyword => lowerLine.includes(keyword))) {
            data.name = line;
            console.log(`✓ Name found (all caps line ${i}): "${data.name}"`);
            break;
          }
        }
      }
    }
  }

  // Strategy 2b: Look for capitalized words at the start (2-4 words, all capitalized)
  if (!data.name) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      const words = line.split(/\s+/);
      
      // Check if line has 1-4 words and all start with capital letters
      if (words.length >= 1 && words.length <= 4) {
        const allCapitalized = words.every(word => 
          word.length > 0 && /^[A-Z]/.test(word) && /^[A-Za-z\-\.]+$/.test(word)
        );
        if (allCapitalized && /^[A-Za-z\s\-\.]+$/.test(line)) {
          // Additional check: ensure it doesn't look like a job title or other header
          const lowerLine = line.toLowerCase();
          const excludeKeywords = ['last updated', 'updated', 'resume', 'cv', 'curriculum', 'vitae', 'contact', 'information', 'profile', 'summary', 'objective', 'experience', 'education', 'skills', 'projects'];
          
          if (!excludeKeywords.some(keyword => lowerLine.includes(keyword))) {
            data.name = line;
            console.log(`✓ Name found (capitalized, line ${i}): "${data.name}"`);
            break;
          }
        }
      }
    }
  }

  // Strategy 3: Look for common name patterns (First Last format) in first few lines
  if (!data.name) {
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      // Look for First Last pattern in the line
      const namePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]*){1,3})/;
      const match = line.match(namePattern);
      if (match && match[1]) {
        const extractedName = match[1].trim();
        // Additional validation: check if it's not a job title
        const lowerName = extractedName.toLowerCase();
        const excludeKeywords = ['last updated', 'updated', 'resume', 'cv', 'curriculum', 'vitae', 'contact', 'information', 'profile', 'summary', 'objective', 'experience', 'education', 'skills', 'projects'];
        
        if (!excludeKeywords.some(keyword => lowerName.includes(keyword)) && extractedName.length > 3 && extractedName.length < 50) {
          data.name = extractedName;
          console.log(`✓ Name found (First Last pattern, line ${i}): "${data.name}"`);
          break;
        }
      }
    }
  }

  // Strategy 4: Enhanced pattern matching with more name variations
  if (!data.name) {
    const advancedNamePatterns = [
      // Patterns with common name prefixes
      /(?:\bby\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?=\s+(?:contact|email|phone|mobile|linkedin|github|address|summary|objective|profile|experience|education|skills))/i,
      // Patterns with common contact info nearby
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}).*?(?:email|e-mail|mail|contact|phone|mobile|linkedin|github|address)/i,
      // Patterns with contact info before name
      /(email|e-mail|mail|phone|mobile|linkedin|github|address).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    ];
    
    for (const pattern of advancedNamePatterns) {
      const match = originalText.match(pattern);
      if (match && match[1]) {
        const extractedName = (match[2] || match[1]).trim();
        // Validate the extracted name
        if (extractedName.length > 3 && extractedName.length < 50 && !extractedName.toLowerCase().includes('last updated')) {
          data.name = extractedName;
          console.log(`✓ Name found (advanced pattern): "${data.name}"`);
          break;
        }
      }
    }
  }

  // Strategy 5: Look for names near contact information
  if (!data.name) {
    // Find positions of contact-related keywords
    const contactKeywords = ['email', 'phone', 'mobile', 'contact', 'linkedin', 'github', 'address'];
    for (const keyword of contactKeywords) {
      const keywordIndex = originalText.toLowerCase().indexOf(keyword);
      if (keywordIndex !== -1) {
        // Look for a name-like pattern before the contact info
        const beforeText = originalText.substring(Math.max(0, keywordIndex - 100), keywordIndex);
        const linesBefore = beforeText.split(/\r?\n/).reverse();
        
        for (const line of linesBefore) {
          const nameMatch = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/);
          if (nameMatch && nameMatch[1]) {
            const extractedName = nameMatch[1].trim();
            if (extractedName.length > 3 && extractedName.length < 50 && !extractedName.toLowerCase().includes('last updated')) {
              data.name = extractedName;
              console.log(`✓ Name found (near contact info): "${data.name}"`);
              break;
            }
          }
        }
        
        if (data.name) break;
      }
    }
  }

  // Strategy 6: Layout-specific name extraction
  if (!data.name) {
    // In modern layouts, the name might be the first prominent text
    for (let i = 0; i < Math.min(7, lines.length); i++) {
      const line = lines[i];
      // Look for a line that looks like a name (first letter capitalized, multiple words)
      const nameCandidate = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})$/);
      if (nameCandidate && nameCandidate[1]) {
        const candidate = nameCandidate[1].trim();
        // Ensure it's not a job title
        const excludeKeywords = ['engineer', 'developer', 'manager', 'director', 'consultant', 'analyst', 'architect', 'lead'];
        if (!excludeKeywords.some(keyword => candidate.toLowerCase().includes(keyword))) {
          data.name = candidate;
          console.log(`✓ Name found (layout-specific): "${data.name}"`);
          break;
        }
      }
    }
  }

  if (!data.name) {
    console.log('❌ Name not found');
  }

  // ========== EXTRACT EMAIL ==========
  console.log('🔍 Extracting email...');
  
  // Comprehensive email regex - handles all valid email formats
  const emailRegex = /\b[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}\b/g;
  
  // Try to find all email matches in the text
  let emailMatches = originalText.match(emailRegex);
  
  if (emailMatches && emailMatches.length > 0) {
    // Filter out common false positives and prioritize personal emails
    emailMatches = emailMatches
      .map(email => email.toLowerCase().trim())
      .filter(email => {
        // Filter out common false positives
        const falsePositives = ['example.com', 'email.com', 'test.com', 'domain.com', 'company.com', 'business.com'];
        const domain = email.split('@')[1];
        return !falsePositives.some(fp => domain.includes(fp));
      })
      .filter(email => {
        // Additional filtering: avoid email addresses that look like template placeholders
        return !email.includes('${') && !email.includes('{') && !email.includes('}') && email.length > 6;
      });
    
    if (emailMatches.length > 0) {
      // Prioritize personal emails over business ones if multiple found
      const personalDomains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'protonmail.com', 'aol.com'];
      const personalEmails = emailMatches.filter(email => personalDomains.some(domain => email.includes(domain)));
      
      if (personalEmails.length > 0) {
        data.email = personalEmails[0];
      } else {
        data.email = emailMatches[0];
      }
      
      console.log(`✓ Email found: "${data.email}"`);
    }
  }
  
  // If still not found, try patterns with labels
  if (!data.email) {
    const emailWithLabelPatterns = [
      /(?:email|e-mail|mail)\s*[:=]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /(?:contact\s*at|reach\s*at)\s*[:=]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\s*(?:-\s*)?(?:email|contact|mail)/gi
    ];
    
    for (const pattern of emailWithLabelPatterns) {
      const matches = originalText.match(pattern);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          const emailMatch = match.match(emailRegex);
          if (emailMatch && emailMatch[0]) {
            data.email = emailMatch[0].toLowerCase().trim();
            console.log(`✓ Email found (with label): "${data.email}"`);
            break;
          }
        }
        if (data.email) break;
      }
    }
  }

  // If still not found, look for emails near contact information
  if (!data.email && lines.length > 0) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();
      
      if (lowerLine.includes('contact') || lowerLine.includes('email') || lowerLine.includes('mail')) {
        // Look in nearby lines for an email
        const startIdx = Math.max(0, i - 2);
        const endIdx = Math.min(lines.length, i + 3);
        
        for (let j = startIdx; j < endIdx; j++) {
          const nearbyLine = lines[j];
          const emailMatch = nearbyLine.match(emailRegex);
          if (emailMatch && emailMatch[0]) {
            const email = emailMatch[0].toLowerCase().trim();
            const domain = email.split('@')[1];
            if (domain && !['example.com', 'email.com', 'test.com', 'domain.com'].includes(domain)) {
              data.email = email;
              console.log(`✓ Email found (near contact info): "${data.email}"`);
              break;
            }
          }
        }
        if (data.email) break;
      }
    }
  }

  if (!data.email) {
    console.log('❌ Email not found');
    console.log('  Attempted patterns: standard email regex, labeled patterns, contact proximity');
  }

  // ========== EXTRACT CONTACT NUMBER ==========
  console.log('🔍 Extracting contact number...');
  
  // Comprehensive phone number patterns - handles various formats
  const phonePatterns = [
    // International format: +1-234-567-8900, +91 1234567890
    /\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    // US format: (123) 456-7890, 123-456-7890, 123.456.7890
    /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    // Indian format: +91 98765 43210, 98765 43210, 9876543210
    /\+?91[-.\s]?\d{5}[-.\s]?\d{5}/g,
    // Generic 10-15 digit numbers
    /\b\d{10,15}\b/g,
    // Numbers with spaces: 123 456 7890
    /\d{3,4}\s+\d{3,4}\s+\d{3,4}/g
  ];
  
  // Look for phone patterns with labels first (more reliable)
  const phoneWithLabelPatterns = [
    /(?:phone|mobile|contact|tel|telephone|cell|mob|whatsapp)\s*[:=]?\s*([+\d\s\-().]+)/gi,
    /(?:ph|mob|tel)\s*[:=]?\s*([+\d\s\-().]+)/gi,
    /([+\d\s\-().]+)\s*(?:-\s*)?(?:phone|mobile|contact|tel|telephone|cell|mob|whatsapp)/gi
  ];
  
  for (const pattern of phoneWithLabelPatterns) {
    const matches = originalText.match(pattern);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        // Extract just the phone number part
        const phoneMatch = match.match(/[+\d\s\-().]+/);
        if (phoneMatch) {
          const cleaned = phoneMatch[0].replace(/[^\d+]/g, '');
          // Phone numbers should be 10-15 digits (including country code)
          if (cleaned.length >= 10 && cleaned.length <= 15) {
            data.contactNumber = cleaned;
            console.log(`✓ Contact found (with label): "${data.contactNumber}" (from: "${match}")`);
            break;
          }
        }
      }
      if (data.contactNumber) break;
    }
  }

  // If not found, look for standalone phone numbers
  if (!data.contactNumber) {
    for (const pattern of phonePatterns) {
      const matches = originalText.match(pattern);
      if (matches && matches.length > 0) {
        // Filter matches to find the most likely phone number
        for (const match of matches) {
          const cleaned = match.replace(/[^\d+]/g, '');
          
          // Phone numbers should be 10-15 digits
          if (cleaned.length >= 10 && cleaned.length <= 15) {
            // Skip if it looks like a date, year, or other number
            // Don't accept numbers that are clearly years (1900-2099)
            if (cleaned.length === 4 && /^[12]\d{3}$/.test(cleaned)) {
              continue; // Skip years
            }
            
            // Skip if it's part of an email address
            const beforeMatch = originalText.substring(Math.max(0, originalText.indexOf(match) - 5), originalText.indexOf(match));
            const afterMatch = originalText.substring(originalText.indexOf(match) + match.length, Math.min(originalText.length, originalText.indexOf(match) + match.length + 5));
            if (beforeMatch.includes('@') || afterMatch.includes('@') || beforeMatch.includes('.') && afterMatch.includes('.')) {
              continue; // Skip if it's part of an email
            }
            
            data.contactNumber = cleaned;
            console.log(`✓ Contact found (standalone): "${data.contactNumber}" (from: "${match}")`);
            break;
          }
        }
        if (data.contactNumber) break;
      }
    }
  }

  // Layout-specific contact extraction
  if (!data.contactNumber) {
    // In some layouts, contact might be in the header area
    const headerText = originalText.substring(0, Math.min(500, originalText.length));
    for (const pattern of phoneWithLabelPatterns) {
      const matches = headerText.match(pattern);
      if (matches && matches.length > 0) {
        for (const match of matches) {
          const phoneMatch = match.match(/[+\d\s\-().]+/);
          if (phoneMatch) {
            const cleaned = phoneMatch[0].replace(/[^\d+]/g, '');
            if (cleaned.length >= 10 && cleaned.length <= 15) {
              data.contactNumber = cleaned;
              console.log(`✓ Contact found (header area): "${data.contactNumber}" (from: "${match}")`);
              break;
            }
          }
        }
        if (data.contactNumber) break;
      }
    }
  }

  if (!data.contactNumber) {
    console.log('❌ Contact number not found');
    console.log('  Attempted patterns: labeled patterns, international formats, US formats, generic patterns, header area');
  }

  // ========== EXTRACT DATE OF BIRTH ==========
  console.log('🔍 Extracting date of birth...');
  const dobPatterns = [
    // Support prefixes like zDOB or —DOB or #DOB and various dash types
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born|birth)\s*[:\-=—–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/gi,
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born|birth)\s*[:\-=—–]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    // Catch cases where DOB is preceded by artifacts like "zDOB"
    /[a-z]?(?:dob|birth|born)\s*[:\-=—–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/gi
  ];
  
  for (const pattern of dobPatterns) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    const match = pattern.exec(originalText);
    if (match && (match[1] || match[0])) {
      data.dateOfBirth = (match[1] || match[0]).trim();
      console.log(`✓ DOB found: "${data.dateOfBirth}"`);
      break;
    }
  }

  // If DOB not found, look for any date that looks like a birth date (between 1940-2015)
  if (!data.dateOfBirth) {
    const datePattern = /\b(0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](19[4-9]\d|200[0-9]|201[0-5])\b/g;
    const dateMatches = originalText.match(datePattern);
    if (dateMatches && dateMatches.length > 0) {
      data.dateOfBirth = dateMatches[0].trim();
      console.log(`✓ DOB found (fallback): "${data.dateOfBirth}"`);
    }
  }

  if (!data.dateOfBirth) {
    console.log('❌ DOB not found');
  }

  // ========== EXTRACT EXPERIENCE ==========
  console.log('🔍 Extracting experience...');
  const experiencePatterns = [
    /(?:experience|exp|total\s*experience|years?\s*of\s*experience|work\s*experience)\s*[:]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:years?|yrs?|yr)/gi,
    /([0-9]+(?:\.[0-9]+)?)\s*(?:years?|yrs?|yr)\s*(?:of\s*)?(?:experience|exp)/gi,
    /(?:experience|exp)\s*[:]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:years?|yrs?|yr)/gi
  ];
  
  for (const pattern of experiencePatterns) {
    const match = originalText.match(pattern);
    if (match) {
      const expMatch = match[0].match(/([0-9]+(?:\.[0-9]+)?)/);
      if (expMatch) {
        data.experience = `${expMatch[1]} years`;
        console.log(`✓ Experience found: "${data.experience}"`);
        break;
      }
    }
  }

  if (!data.experience) {
    console.log('❌ Experience not found');
  }

  // ========== EXTRACT ROLE/POSITION ==========
  console.log('🔍 Extracting role/position...');
  const rolePatterns = [
    /(?:current\s*role|position|job\s*title|designation|role|title)\s*[:]?\s*([A-Za-z\s&]+(?:engineer|developer|scientist|analyst|manager|architect|specialist|consultant|lead|senior|junior|associate))/gi,
    /(?:software\s*engineer|data\s*scientist|full\s*stack|frontend|backend|devops|ml\s*engineer|ai\s*engineer|web\s*developer|mobile\s*developer)/gi,
    /(?:senior|junior|lead|principal)\s*(?:software\s*)?(?:engineer|developer|scientist|analyst|architect)/gi
  ];
  
  // Common roles to look for
  const commonRoles = [
    'Software Engineer', 'Software Developer', 'Full Stack Developer',
    'Frontend Developer', 'Backend Developer', 'Data Scientist',
    'Data Analyst', 'ML Engineer', 'AI Engineer', 'DevOps Engineer',
    'Mobile Developer', 'Web Developer', 'System Architect',
    'Product Manager', 'Project Manager', 'Tech Lead', 'Senior Engineer',
    'Junior Engineer', 'Associate Engineer'
  ];
  
  // First, try to find explicit role labels
  for (const pattern of rolePatterns) {
    const matches = originalText.match(pattern);
    if (matches && matches.length > 0) {
      // Take the first match and clean it up
      let role = matches[0].replace(/(?:current\s*role|position|job\s*title|designation|role|title)\s*[:]?\s*/gi, '').trim();
      if (role.length > 3 && role.length < 50) {
        // Capitalize properly
        role = role.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
        data.role = role;
        console.log(`✓ Role found (pattern): "${data.role}"`);
        break;
      }
    }
  }
  
  // If not found, search for common role keywords
  if (!data.role) {
    const textLower = originalText.toLowerCase();
    for (const commonRole of commonRoles) {
      const roleLower = commonRole.toLowerCase();
      // Look for the role in the first 2000 characters (usually in header/objective)
      if (textLower.substring(0, 2000).includes(roleLower)) {
        data.role = commonRole;
        console.log(`✓ Role found (common role): "${data.role}"`);
        break;
      }
    }
  }
  
  // If still not found, look for "Engineer", "Developer", "Scientist" etc. in first few lines
  if (!data.role) {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('engineer') || line.includes('developer') || line.includes('scientist') || 
          line.includes('analyst') || line.includes('architect') || line.includes('manager')) {
        // Try to extract a meaningful role from this line
        const words = lines[i].split(/\s+/);
        const roleWords = [];
        for (const word of words) {
          if (word.length > 2 && /^[A-Za-z]+$/.test(word)) {
            roleWords.push(word);
            if (word.toLowerCase().includes('engineer') || word.toLowerCase().includes('developer') || 
                word.toLowerCase().includes('scientist') || word.toLowerCase().includes('analyst')) {
              break;
            }
          }
        }
        if (roleWords.length > 0 && roleWords.length < 5) {
          data.role = roleWords.join(' ');
          console.log(`✓ Role found (keyword search): "${data.role}"`);
          break;
        }
      }
    }
  }
  
  // Strategy 4: Look for roles near objective/summary section
  if (!data.role) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      
      if (line.includes('objective') || line.includes('summary') || line.includes('profile') || line.includes('about')) {
        // Look for a role in the next few lines
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j];
          const words = nextLine.split(/\s+/);
          
          for (const word of words) {
            const lowerWord = word.toLowerCase();
            if (lowerWord.includes('engineer') || lowerWord.includes('developer') || 
                lowerWord.includes('scientist') || lowerWord.includes('analyst') ||
                lowerWord.includes('manager') || lowerWord.includes('architect') ||
                lowerWord.includes('consultant') || lowerWord.includes('specialist')) {
              // Extract the role from this line
              const roleMatch = nextLine.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*(?:\s+(?:engineer|developer|scientist|analyst|manager|architect|consultant|specialist|lead|senior|junior|associate))?)/);
              if (roleMatch && roleMatch[1]) {
                data.role = roleMatch[1].trim();
                console.log(`✓ Role found (near objective): "${data.role}"`);
                break;
              }
            }
          }
          if (data.role) break;
        }
        if (data.role) break;
      }
    }
  }
  
  // Strategy 5: Extract role from the first substantial line that looks like a title
  if (!data.role) {
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();
      
      // Skip if it looks like contact info
      if (lowerLine.includes('contact') || lowerLine.includes('email') || lowerLine.includes('phone') || 
          lowerLine.includes('linkedin') || lowerLine.includes('github')) {
        continue;
      }
      
      // Look for role keywords in the line
      const roleKeywords = ['engineer', 'developer', 'scientist', 'analyst', 'manager', 'architect', 
                           'consultant', 'specialist', 'lead', 'director', 'executive'];
      
      if (roleKeywords.some(keyword => lowerLine.includes(keyword))) {
        // Extract the role from the line
        const roleMatch = line.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]*)*(?:\s+(?:engineer|developer|scientist|analyst|manager|architect|consultant|specialist|lead|senior|junior|associate|director|executive))?)/);
        if (roleMatch && roleMatch[1]) {
          data.role = roleMatch[1].trim();
          console.log(`✓ Role found (title-like line): "${data.role}"`);
          break;
        }
      }
    }
  }

  if (!data.role) {
    console.log('❌ Role not found');
  }

  // ========== EXTRACT LOCATION ==========
  console.log('🔍 Extracting location...');
  const locationPatterns = [
    /(?:location|address|city|residence|residing\s*at|place|native)\s*[:\-=]?\s*([A-Za-z\s,]+(?:,\s*[A-Za-z\s]+){0,3})/gi,
    /(?:^|\n)\s*(?:lives\s*in|based\s*in|from|at)\s*([A-Za-z\s,]+)/i,
    // Pattern for common city, state/country format: "Delhi, India" or "New York, USA"
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/
  ];

  for (const pattern of locationPatterns) {
    const match = originalText.match(pattern);
    if (match && match[1]) {
      const loc = match[1].trim();
      // Filter out common false positives
      if (loc.length > 3 && loc.length < 100 && !loc.toLowerCase().includes('engineer') && !loc.toLowerCase().includes('developer')) {
        data.location = loc;
        console.log(`✓ Location found: "${data.location}"`);
        break;
      }
    }
  }

  // ========== EXTRACT LINKS ==========
  console.log('🔍 Extracting links...');
  // Improved patterns for full URLs and profiles
  const linkedinPatterns = [
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/gi,
    /(?:linkedin|lin)\s*[:\-=]?\s*([^\s\n\r,]+)/i
  ];
  const githubPatterns = [
    /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/gi,
    /(?:github|git)\s*[:\-=]?\s*([^\s\n\r,]+)/i
  ];
  const portfolioPattern = /(?:portfolio|website|personal\s*site|web)\s*[:\-=]?\s*(https?:\/\/[^\s\n\r,]+)/gi;

  for (const pattern of linkedinPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(originalText);
    if (match) {
      let link = (match[1] || match[0]).replace(/(?:linkedin|lin)\s*[:\-=]?\s*/i, '').trim();
      if (link.includes('linkedin.com')) {
        if (!link.startsWith('http')) link = 'https://' + link;
      } else if (link.length > 3 && !link.includes('@') && !link.includes('.') ) {
        link = 'https://www.linkedin.com/in/' + link;
      } else {
        continue;
      }
      data.links.linkedin = link;
      console.log(`✓ LinkedIn found: "${data.links.linkedin}"`);
      break;
    }
  }

  for (const pattern of githubPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(originalText);
    if (match) {
      let link = (match[1] || match[0]).replace(/(?:github|git)\s*[:\-=]?\s*/i, '').trim();
      if (link.includes('github.com')) {
        if (!link.startsWith('http')) link = 'https://' + link;
      } else if (link.length > 3 && !link.includes('@') && !link.includes('.') ) {
        link = 'https://github.com/' + link;
      } else {
        continue;
      }
      data.links.github = link;
      console.log(`✓ GitHub found: "${data.links.github}"`);
      break;
    }
  }

  const portfolioMatch = originalText.match(portfolioPattern);
  if (portfolioMatch) data.links.portfolio = portfolioMatch[1] || portfolioMatch[0];

  // ========== EXTRACT SKILLS ==========
  console.log('🔍 Extracting skills...');
  
  // Define skill section headers to look for
  const skillHeaders = ['skills', 'technical skills', 'technologies', 'competencies', 'core competencies', 'key skills', 'professional skills', 'areas of expertise', 'expertise'];
  
  // Find the start of the skills section
  let skillsStartIndex = -1;
  let skillsEndIndex = originalText.length;
  
  for (const header of skillHeaders) {
    const regex = new RegExp(`(${header})\s*[:\-=]?`, 'gi');
    const match = regex.exec(originalText);
    if (match) {
      skillsStartIndex = match.index + match[0].length;
      break;
    }
  }
  
  // If we found a skills section, find where it ends
  if (skillsStartIndex !== -1) {
    // Look for the next section header
    const nextSections = ['experience', 'work experience', 'employment', 'education', 'projects', 'certifications', 'achievements', 'awards', 'summary', 'objective'];
    for (const section of nextSections) {
      const sectionIndex = originalText.toLowerCase().indexOf(section, skillsStartIndex);
      if (sectionIndex !== -1 && sectionIndex < skillsEndIndex) {
        skillsEndIndex = sectionIndex;
      }
    }
    
    // Extract the skills section
    const skillsSection = originalText.substring(skillsStartIndex, skillsEndIndex).trim();
    
    // Split by common delimiters to extract individual skills
    const skillDelimiters = /[;,|\n\r\t]+/;
    let rawSkills = skillsSection.split(skillDelimiters);
    
    // Clean up and filter skills
    data.skills = rawSkills
      .map(skill => skill.trim())
      .filter(skill => skill.length > 1 && skill.length < 50) // Valid skill length
      .filter(skill => !skill.toLowerCase().includes('and') && !skill.toLowerCase().includes('or')) // Remove conjunctions
      .filter((skill, index, self) => self.indexOf(skill) === index); // Remove duplicates
    
    console.log(`✓ Skills found (${data.skills.length}):`, data.skills);
  }
  
  // If no skills section found, try to extract skills from the entire document
  if (data.skills.length === 0) {
    // Common technical skills to look for
    const techSkills = [
      'JavaScript', 'Python', 'Java', 'C++', 'C#', 'React', 'Angular', 'Vue', 'Node.js', 'HTML', 'CSS',
      'SQL', 'MongoDB', 'Express', 'Git', 'AWS', 'Docker', 'Kubernetes', 'Jenkins', 'Linux', 'MySQL',
      'PostgreSQL', 'PHP', 'Ruby', 'Go', 'Rust', 'Swift', 'Kotlin', '.NET', 'Spring', 'Bootstrap',
      'jQuery', 'SASS', 'TypeScript', 'Redux', 'GraphQL', 'REST', 'API', 'Machine Learning', 'AI',
      'Data Science', 'React Native', 'Flutter', 'Android', 'iOS', 'Azure', 'GCP', 'CI/CD', 'Agile',
      'Scrum', 'Testing', 'JUnit', 'Selenium', 'Jest', 'Webpack', 'Babel', 'Nginx', 'Apache'
    ];
    
    // Look for known skills in the text
    const foundSkills = [];
    for (const skill of techSkills) {
      if (originalText.toLowerCase().includes(skill.toLowerCase())) {
        foundSkills.push(skill);
      }
    }
    
    data.skills = [...new Set(foundSkills)]; // Remove duplicates
    if (data.skills.length > 0) {
      console.log(`✓ Skills found (from known skills list, ${data.skills.length}):`, data.skills);
    }
  }
  
  // ========== EXTRACT SUMMARY ==========
  console.log('🔍 Extracting summary...');
  const summaryPatterns = [
    /(?:summary|objective|professional\s*profile|about\s*me)\s*[:\-=]?\s*([\s\S]{30,1000}?(?=\n\s*(?:experience|skills|education|projects|work|employment|certifications|languages|hobbies|personal|$)))/gi,
    /(?:summary|objective|profile)\s*[:\-=]?\s*([^\n\r]+(?:\n[^\n\r]+){1,5})/gi
  ];

  for (const pattern of summaryPatterns) {
    const match = pattern.exec(originalText);
    if (match) {
      const summary = (match[1] || match[0]).replace(/(?:summary|objective|professional\s*profile|about\s*me)\s*[:\-=]?\s*/gi, '').trim();
      if (summary.length > 20) {
        data.summary = summary;
        console.log(`✓ Summary found (length: ${data.summary.length})`);
        break;
      }
    }
  }

  console.log(`\n📊 Final extracted data:`, JSON.stringify(data, null, 2));
  return data;
}

module.exports = {
  extractResumeData
};


