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
    role: ''
  };

  if (!text || text.length === 0) {
    console.log('⚠️  PDF text is empty');
    return data;
  }

  console.log(`📄 PDF text length: ${text.length} characters`);
  console.log(`📄 First 500 chars: ${text.substring(0, 500)}`);

  // Keep original text with newlines for better pattern matching
  const originalText = text;
  const lines = originalText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  
  console.log(`📄 Total lines: ${lines.length}`);
  console.log(`📄 First 10 lines:`, lines.slice(0, 10));

  // ========== EXTRACT NAME ==========
  console.log('🔍 Extracting name...');
  
  // Strategy 1: Look for "Name:" or "Full Name:" patterns (case insensitive)
  const namePatterns1 = [
    /(?:^|\n)\s*name\s*[:]\s*([^\n\r]+)/i,
    /(?:^|\n)\s*full\s*name\s*[:]\s*([^\n\r]+)/i,
    /name\s*[:]\s*([A-Za-z\s]+)/i,
    /full\s*name\s*[:]\s*([A-Za-z\s]+)/i
  ];
  
  for (const pattern of namePatterns1) {
    const match = originalText.match(pattern);
    if (match && match[1]) {
      data.name = match[1].trim();
      console.log(`✓ Name found (pattern 1): "${data.name}"`);
      break;
    }
  }

  // Strategy 2: Look for all-caps name at the start (common in resumes)
  // First check if first line is all caps (could be name even if single word)
  if (!data.name && lines.length > 0) {
    const firstLine = lines[0];
    // Check if first line is all uppercase letters (could be "DANISHALI" or "DANISH ALI")
    if (firstLine === firstLine.toUpperCase() && /^[A-Z]+$/.test(firstLine.replace(/\s/g, ''))) {
      // If it's a single word, try to split it intelligently (e.g., "DANISHALI" -> "DANISH ALI")
      if (firstLine.length > 5 && firstLine.length < 30) {
        // Try to detect if it's two names combined (common pattern)
        // Look for patterns like "DANISHALI" where we can split
        const splitPattern = /^([A-Z]{3,})([A-Z]{3,})$/;
        const splitMatch = firstLine.match(splitPattern);
        if (splitMatch) {
          data.name = `${splitMatch[1]} ${splitMatch[2]}`;
          console.log(`✓ Name found (all caps single word, split): "${data.name}"`);
        } else {
          data.name = firstLine;
          console.log(`✓ Name found (all caps first line): "${data.name}"`);
        }
      }
    }
  }

  // Strategy 2b: Look for all-caps name with spaces at the start
  if (!data.name) {
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      // Check if line is all uppercase and 2-4 words
      if (line === line.toUpperCase() && line.length > 5 && line.length < 50) {
        const words = line.split(/\s+/);
        if (words.length >= 2 && words.length <= 4 && /^[A-Z\s]+$/.test(line)) {
          data.name = line;
          console.log(`✓ Name found (all caps with spaces, line ${i}): "${data.name}"`);
          break;
        }
      }
    }
  }

  // Strategy 3: Look for capitalized words at the start (2-4 words, all capitalized)
  if (!data.name) {
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      const words = line.split(/\s+/);
      
      // Check if line has 2-4 words and all start with capital letters
      if (words.length >= 2 && words.length <= 4) {
        const allCapitalized = words.every(word => 
          word.length > 0 && /^[A-Z]/.test(word) && /^[A-Za-z]+$/.test(word)
        );
        if (allCapitalized && /^[A-Za-z\s]+$/.test(line)) {
          data.name = line;
          console.log(`✓ Name found (capitalized, line ${i}): "${data.name}"`);
          break;
        }
      }
    }
  }

  // Strategy 4: Look for common name patterns (First Last format)
  if (!data.name) {
    const namePattern = /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/m;
    const match = originalText.match(namePattern);
    if (match && match[1]) {
      data.name = match[1].trim();
      console.log(`✓ Name found (pattern 4): "${data.name}"`);
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
        const falsePositives = ['example.com', 'email.com', 'test.com', 'domain.com'];
        const domain = email.split('@')[1];
        return !falsePositives.some(fp => domain.includes(fp));
      });
    
    if (emailMatches.length > 0) {
      // Use the first valid email (could be enhanced to prioritize personal emails over company)
      data.email = emailMatches[0];
      console.log(`✓ Email found: "${data.email}"`);
    }
  }
  
  // If still not found, try patterns with labels
  if (!data.email) {
    const emailWithLabelPatterns = [
      /(?:email|e-mail|mail)\s*[:]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
      /(?:email|e-mail|mail)\s*[=]\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi
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

  if (!data.email) {
    console.log('❌ Email not found');
    console.log('  Attempted patterns: standard email regex, labeled patterns');
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
    /(?:ph|mob|tel)\s*[:=]?\s*([+\d\s\-().]+)/gi
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

  if (!data.contactNumber) {
    console.log('❌ Contact number not found');
    console.log('  Attempted patterns: labeled patterns, international formats, US formats, generic patterns');
  }

  // ========== EXTRACT DATE OF BIRTH ==========
  console.log('🔍 Extracting date of birth...');
  const dobPatterns = [
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born)\s*[:]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/gi,
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born)\s*[:]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/gi,
    /(?:born|birth)\s*[:]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4})/gi
  ];
  
  for (const pattern of dobPatterns) {
    const match = originalText.match(pattern);
    if (match) {
      const dateStr = (match[1] || match[0]).trim();
      if (dateStr) {
        data.dateOfBirth = dateStr;
        console.log(`✓ DOB found: "${data.dateOfBirth}"`);
        break;
      }
    }
  }

  // If DOB not found, look for any date that looks like a birth date (between 1940-2005)
  if (!data.dateOfBirth) {
    const datePattern = /\b(0?[1-9]|[12][0-9]|3[01])[\/\-\.](0?[1-9]|1[0-2])[\/\-\.](19[4-9]\d|200[0-5])\b/g;
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

  if (!data.role) {
    console.log('❌ Role not found');
  }

  console.log(`\n📊 Final extracted data:`, JSON.stringify(data, null, 2));
  return data;
}

module.exports = {
  extractResumeData
};
