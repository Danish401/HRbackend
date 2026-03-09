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
    }
  };

  if (!text || text.length === 0) {
    console.log('⚠️  PDF text is empty');
    return data;
  }

  console.log(`📄 PDF raw text length: ${text.length} characters`);
  console.log(`📄 First 500 raw chars: ${text.substring(0, 500)}`);

  // ========== NORMALIZE TEXT FOR CONSISTENT LAYOUT HANDLING ==========
  // We keep newlines (layout signal) but normalize bullets, spaces and encodings.
  const originalText = text
    .replace(/\r\n/g, '\n')                 // normalize newlines
    .replace(/\u00A0/g, ' ')                // non‑breaking space -> normal space
    .replace(/[•●∙▪◦]/g, '•')               // normalize bullet symbols
    .replace(/[ \t]+/g, ' ')                // collapse multiple spaces
    .replace(/[ \t]*\n[ \t]*/g, '\n');      // trim each line's ends

  const lines = originalText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  console.log(`📄 Total lines: ${lines.length}`);
  console.log(`📄 First 10 lines:`, lines.slice(0, 10));

  // ========== EXTRACT NAME ==========
  console.log('🔍 Extracting name...');
  
  // Common resume section headers to IGNORE (case-insensitive)
  const sectionHeaders = [
    'SUMMARY', 'OBJECTIVE', 'SKILLS', 'EDUCATION', 'EXPERIENCE',
    'WORK EXPERIENCE', 'PROFESSIONAL EXPERIENCE', 'EMPLOYMENT',
    'PROJECTS', 'CERTIFICATIONS', 'AWARDS', 'PUBLICATIONS',
    'REFERENCES', 'HOBBIES', 'INTERESTS', 'LANGUAGES',
    'PERSONAL DETAILS', 'CONTACT', 'PROFILE', 'ABOUT',
    'TECHNICAL SKILLS', 'KEY SKILLS', 'CORE COMPETENCIES',
    'ACHIEVEMENTS', 'QUALIFICATIONS', 'TRAINING', 'COURSES'
  ];
  
  // Helper function to check if a line is a section header
  const isSectionHeader = (line) => {
    const normalized = line.trim().toUpperCase().replace(/[^A-Z]/g, '');
    return sectionHeaders.some(header => 
      normalized === header.replace(/[^A-Z]/g, '') ||
      normalized.includes(header.replace(/[^A-Z]/g, ''))
    );
  };
  
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
  // But SKIP section headers and common non-name text
  if (!data.name && lines.length > 0) {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const firstLine = lines[i];
      
      // Skip if it's a section header
      if (isSectionHeader(firstLine)) {
        console.log(`   Skipping section header: "${firstLine}"`);
        continue;
      }
      
      // Check if first line is all uppercase letters (could be "DANISHALI" or "DANISH ALI")
      if (
        firstLine === firstLine.toUpperCase() &&
        /^[A-Z]+$/.test(firstLine.replace(/\s/g, '')) &&
        !/RESUME|CURRICULUM|VITAE|CV/.test(firstLine) // avoid picking "RESUME" etc. as name
      ) {
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
          break;
        }
      }
    }
  }

  // Strategy 2b: Look for all-caps name with spaces at the start
  if (!data.name) {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i];
      
      // Skip section headers
      if (isSectionHeader(line)) {
        console.log(`   Skipping section header: "${line}"`);
        continue;
      }
      
      // Check if line is all uppercase and 2-4 words
      if (
        line === line.toUpperCase() &&
        line.length > 5 &&
        line.length < 50 &&
        !/RESUME|CURRICULUM|VITAE|CV/.test(line) &&           // avoid titles
        !/ENGINEER|DEVELOPER|MANAGER|ANALYST|DESIGNER/.test(line) // avoid role lines
      ) {
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
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i];
      
      // Skip section headers
      if (isSectionHeader(line)) {
        console.log(`   Skipping section header: "${line}"`);
        continue;
      }
      
      if (/resume|curriculum|vitae|cv/i.test(line)) continue; // skip obvious non-name titles
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
    const headerPortion = originalText.split('\n').slice(0, 20).join('\n');
    const namePattern = /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/m;
    const match = headerPortion.match(namePattern);
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
    // Final fallback: infer from header/contact-style lines (for very compact headers)
    const headerLines = lines.slice(0, Math.min(10, lines.length));
    const headerPhoneLike = /\+?\d[\d\s().-]{7,}/;
    for (const line of headerLines) {
      if (!headerPhoneLike.test(line)) continue;
      const matches = line.match(/[+\d\s().-]+/g) || [];
      for (const candidate of matches) {
        const cleaned = candidate.replace(/[^\d+]/g, '');
        if (cleaned.length >= 10 && cleaned.length <= 15) {
          data.contactNumber = cleaned;
          console.log(`✓ Contact inferred from header line: "${data.contactNumber}" (from: "${line}")`);
          break;
        }
      }
      if (data.contactNumber) break;
    }
  }

  if (!data.contactNumber) {
    console.log('❌ Contact number not found');
    console.log('  Attempted patterns: labeled patterns, international formats, US formats, generic patterns, header inference');
  }

  // ========== EXTRACT DATE OF BIRTH ==========
  console.log('🔍 Extracting date of birth...');
  const dobPatterns = [
    // Support prefixes like zDOB or —DOB or #DOB and various dash types
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born|birth)\s*[:\-=—–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.](?:19[4-9]\d|200[0-9]|201[0-5]))/gi,
    /(?:date\s*of\s*birth|dob|d\.o\.b\.|birth\s*date|born|birth)\s*[:\-=—–]?\s*([A-Za-z]+\s+\d{1,2},?\s+(?:19[4-9]\d|200[0-9]|201[0-5]))/gi,
    // Catch cases where DOB is preceded by artifacts like "zDOB"
    /[a-z]?(?:dob|birth|born)\s*[:\-=—–]?\s*([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.](?:19[4-9]\d|200[0-9]|201[0-5]))/gi
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
    let dateMatch;
    while ((dateMatch = datePattern.exec(originalText)) !== null) {
      const full = dateMatch[0];
      // Avoid dates that clearly look like employment ranges ("to", "-", "present") on same line
      const lineStart = originalText.lastIndexOf('\n', datePattern.lastIndex - full.length) + 1;
      const lineEnd = originalText.indexOf('\n', datePattern.lastIndex);
      const line = originalText.substring(
        lineStart === -1 ? 0 : lineStart,
        lineEnd === -1 ? originalText.length : lineEnd
      );
      if (/to\s+\d{2}|-\s*\d{2}|present|current/i.test(line)) {
        continue;
      }
      data.dateOfBirth = full.trim();
      console.log(`✓ DOB found (fallback): "${data.dateOfBirth}"`);
      break;
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
    /(?:current\s*role|position|job\s*title|designation|role|title)\s*[:]??\s*([A-Za-z\s&]+(?:engineer|developer|scientist|analyst|manager|architect|specialist|consultant|lead|senior|junior|associate))/gi,
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
      let role = matches[0].replace(/(?:current\s*role|position|job\s*title|designation|role|title)\s*[:]??\s*/gi, '').trim();
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
    
  // If still not found, look for job titles near the name (within first 15 lines)
  if (!data.role) {
    const jobTitleKeywords = [
      'engineer', 'developer', 'designer', 'manager', 'analyst',
      'architect', 'consultant', 'specialist', 'coordinator',
      'director', 'lead', 'senior', 'junior', 'intern'
    ];
      
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i].toLowerCase();
        
      // Skip section headers
      if (isSectionHeader(lines[i])) continue;
        
      for (const keyword of jobTitleKeywords) {
        if (line.includes(keyword) && lines[i].length < 60) {
          // This line might contain a job title
          const words = lines[i].split(/\s+/);
          // Try to extract a meaningful title (2-5 words)
          if (words.length >= 2 && words.length <= 5) {
            const potentialTitle = lines[i].trim();
            // Avoid contact info, locations, etc.
            if (!potentialTitle.includes('@') && !/^\d+$/.test(potentialTitle.replace(/\D/g, ''))) {
              data.role = potentialTitle;
              console.log(`✓ Role found (near name, line ${i}): "${data.role}"`);
              break;
            }
          }
        }
      }
      if (data.role) break;
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
      let loc = match[1].trim();
      // Filter out common false positives
      if (loc.length > 3 && loc.length < 100 && !loc.toLowerCase().includes('engineer') && !loc.toLowerCase().includes('developer')) {
        // Clean up brackets or array-like artifacts
        loc = loc.replace(/[\[\]]/g, '').replace(/Array\s*/i, '').trim();
        data.location = loc;
        console.log(`✓ Location found: "${data.location}"`);
        break;
      }
    }
  }

  // Fallback: infer location from header/contact lines (common "City, Country | Phone | Email" layout)
  if (!data.location) {
    const headerLines = lines.slice(0, Math.min(10, lines.length));
    const contactHints = [];

    // Collect candidate header lines that contain email or phone-like patterns
    const simplePhoneLike = /\d{6,}/;
    const emailLike = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

    for (const line of headerLines) {
      if (emailLike.test(line) || simplePhoneLike.test(line)) {
        contactHints.push(line);
      }
    }

    const candidateLines = contactHints.length > 0 ? contactHints : headerLines;

    for (const line of candidateLines) {
      // Split header segments on common separators
      const segments = line.split(/[|•·]/).map(s => s.trim()).filter(Boolean);
      for (const seg of segments) {
        const segLower = seg.toLowerCase();
        // Skip obvious non-location segments
        if (seg.includes('@')) continue;
        if (/\d{4,}/.test(seg)) continue; // likely phone/pincode
        if (segLower.includes('engineer') || segLower.includes('developer') || segLower.includes('resume')) continue;

        // Heuristic: 1-4 words, starting uppercase, maybe containing a comma
        const words = seg.split(/\s+/).filter(Boolean);
        const allWordsCapitalized = words.every(w => /^[A-Z][a-zA-Z.-]*$/.test(w));
        if (seg.includes(',') || (words.length >= 1 && words.length <= 4 && allWordsCapitalized)) {
          data.location = seg;
          console.log(`✓ Location inferred from header line: "${data.location}" (from: "${line}")`);
          break;
        }
      }
      if (data.location) break;
    }
  }

  // ========== EXTRACT LINKS ==========
  console.log('🔍 Extracting links...');

  // Helper to normalize raw URL-like strings
  const normalizeUrl = raw => {
    if (!raw) return '';
    let url = String(raw).trim();
    url = url.replace(/^[<([]+|[>)]*$/g, '');     // strip wrapping brackets
    url = url.replace(/[),.;]+$/g, '');           // strip trailing punctuation
    if (!url) return '';
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url.replace(/^www\./i, 'www.');
    }
    return url;
  };

  // 1) Collect ALL URL-like tokens once
  const allUrls = [];
  const urlRegex = /(?:https?:\/\/|www\.)[^\s)]+/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(originalText)) !== null) {
    const normalized = normalizeUrl(urlMatch[0]);
    if (!normalized) continue;
    allUrls.push({ url: normalized, index: urlMatch.index });
  }

  // Sort by position in text (top of resume first)
  allUrls.sort((a, b) => a.index - b.index);

  // 2) Classify URLs into LinkedIn / GitHub / Others
  const otherUrls = [];
  for (const { url } of allUrls) {
    if (/linkedin\.com/i.test(url)) {
      if (!data.links.linkedin) {
        data.links.linkedin = url;
        console.log(`✓ LinkedIn found (URL scan): "${data.links.linkedin}"`);
      }
    } else if (/github\.com/i.test(url)) {
      if (!data.links.github) {
        data.links.github = url;
        console.log(`✓ GitHub found (URL scan): "${data.links.github}"`);
      }
    } else {
      otherUrls.push(url);
    }
  }

  // 3) Label-based LinkedIn / GitHub (handles "LinkedIn: username" or "GitHub: user")
  if (!data.links.linkedin) {
    const linkedinLabelPattern = /(?:linkedin|lin)\s*[:\-=]?\s*([^\s\n\r,]+)/gi;
    let m;
    while ((m = linkedinLabelPattern.exec(originalText)) !== null) {
      let value = (m[1] || '').trim().replace(/[),.;]+$/g, '');
      if (!value) continue;
      if (value.includes('linkedin.com')) {
        data.links.linkedin = normalizeUrl(value);
      } else if (!value.includes('@')) {
        data.links.linkedin = normalizeUrl(`www.linkedin.com/in/${value}`);
      } else {
        continue;
      }
      console.log(`✓ LinkedIn found (label-based): "${data.links.linkedin}"`);
      break;
    }
  }

  if (!data.links.github) {
    const githubLabelPattern = /(?:github|git)\s*[:\-=]?\s*([^\s\n\r,]+)/gi;
    let m;
    while ((m = githubLabelPattern.exec(originalText)) !== null) {
      let value = (m[1] || '').trim().replace(/[),.;]+$/g, '');
      if (!value) continue;
      if (value.includes('github.com')) {
        data.links.github = normalizeUrl(value);
      } else if (!value.includes('@')) {
        data.links.github = normalizeUrl(`github.com/${value}`);
      } else {
        continue;
      }
      console.log(`✓ GitHub found (label-based): "${data.links.github}"`);
      break;
    }
  }

  // 4) Portfolio / personal website from explicit label
  const portfolioLabelPattern = /(?:portfolio|website|personal\s*site|web)\s*[:\-=]?\s*([^\s\n\r,]+)/gi;
  let portfolioMatch;
  while ((portfolioMatch = portfolioLabelPattern.exec(originalText)) !== null) {
    const raw = (portfolioMatch[1] || '').trim();
    const normalized = normalizeUrl(raw);
    if (normalized) {
      data.links.portfolio = normalized;
      console.log(`✓ Portfolio found (label-based): "${data.links.portfolio}"`);
      break;
    }
  }

  // 5) Fallback portfolio: first non-LinkedIn / non-GitHub URL (usually personal site)
  if (!data.links.portfolio && otherUrls.length > 0) {
    data.links.portfolio = otherUrls[0];
    console.log(`✓ Portfolio inferred from remaining URLs: "${data.links.portfolio}"`);
  }

  // ========== EXTRACT SKILLS ==========
  console.log('🔍 Extracting skills...');
  const skillsSectionPatterns = [
    /(?:skills|technical\s*skills|key\s*skills|skills\s*&\s*abilities)\s*[:\-=]?\s*([\s\S]{20,1200}?(?=\n\s*(?:experience|work\s*experience|employment|education|projects|certifications|languages|summary|objective|about\s*me|personal|$)))/gi
  ];

  let skillsBlock = '';
  for (const pattern of skillsSectionPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(originalText);
    if (match) {
      skillsBlock = (match[1] || '').trim();
      break;
    }
  }

  if (skillsBlock) {
    // Split on newlines, commas, and bullets
    const rawTokens = skillsBlock
      .split(/[\n,•·\-•]/)
      .map(t => t.trim())
      .filter(t => t.length > 1 && t.length <= 60);

    // Filter out obvious non-skill items
    const cleaned = Array.from(new Set(
      rawTokens.map(t => t.replace(/^[•\-–]+/, '').trim())
    )).filter(t => {
      const lower = t.toLowerCase();
      
      // Filter out section headers
      if (lower.startsWith('experience') || lower.startsWith('education') || lower.startsWith('summary')) return false;
      if (/\byears?\b/.test(lower)) return false;
      
      // Filter out contact information patterns
      if (/^\d{10}$/.test(t.replace(/\s/g, ''))) return false; // phone numbers
      if (t.includes('@') && t.includes('.')) return false; // emails
      if (/^[A-Za-z\s]+\([^)]+\)$/.test(t)) return false; // location with parentheses
      
      // Filter out generic resume phrases
      const genericPhrases = [
        'bachelor', 'master', 'degree', 'university', 'college',
        'company', 'inc', 'ltd', 'corporation',
        'january', 'february', 'march', 'april', 'may', 'june',
        'july', 'august', 'september', 'october', 'november', 'december',
        'present', 'current', 'full-time', 'part-time'
      ];
      
      if (genericPhrases.some(phrase => lower.includes(phrase))) return false;
      
      // Must contain at least one capital letter or be a known tech term
      const hasCapital = /[A-Z]/.test(t);
      const isCommonTech = /^(html|css|js|ts|sql|aws|azure|gcp|figma|xd|react|vue|angular|node|npm|git)$/i.test(t);
      
      if (!hasCapital && !isCommonTech) return false;
      
      return true;
    });

    if (cleaned.length > 0) {
      data.skills = cleaned;
      console.log(`✓ Skills found: ${data.skills.length} skills extracted`);
    }
  }

  // ========== EXTRACT EDUCATION ==========
  console.log('🔍 Extracting education...');
  const educationPatterns = [
    /(?:education|academic\s*background|qualifications|academic\s*qualifications)\s*[:\-=]?\s*([\s\S]{30,1600}?(?=\n\s*(?:experience|work\s*experience|projects|skills|technical\s*skills|certifications|summary|objective|about\s*me|personal|languages|$)))/gi
  ];

  for (const pattern of educationPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(originalText);
    if (match) {
      const eduText = (match[1] || '').trim();
      if (eduText.length > 20) {
        data.education = eduText;
        console.log(`✓ Education found (length: ${data.education.length})`);
        break;
      }
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

  // ========== NAME POST-PROCESSING USING EMAIL HEADER ==========
  // If name still missing, infer it from the line(s) above the email (very common layout)
  if (!data.name && data.email) {
    const emailLower = data.email.toLowerCase();
    let emailLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(emailLower)) {
        emailLineIndex = i;
        break;
      }
    }

    if (emailLineIndex > 0) {
      for (let offset = 1; offset <= 3; offset++) {
        const idx = emailLineIndex - offset;
        if (idx < 0) break;
        const candidate = lines[idx].trim();
        if (!candidate) continue;
        const candLower = candidate.toLowerCase();
        if (candidate.includes('@')) continue;
        if (/\d{3,}/.test(candidate)) continue;
        if (candLower.includes('resume') || candLower.includes('curriculum')) continue;

        const words = candidate.split(/\s+/).filter(Boolean);
        if (words.length >= 2 && words.length <= 4) {
          const allWordsNameLike = words.every(w => /^[A-Z][a-zA-Z'-]*$/.test(w));
          if (allWordsNameLike) {
            data.name = candidate;
            console.log(`✓ Name inferred from header above email: "${data.name}"`);
            break;
          }
        }
      }
    }
  }

  // Final name fallback: derive from email local-part (e.g. "john.doe_01" -> "John Doe")
  if (!data.name && data.email) {
    const localPart = data.email.split('@')[0];
    if (localPart && localPart.length > 2 && !/^\d+$/.test(localPart)) {
      const pieces = localPart
        .split(/[._\-]+/)
        .filter(Boolean)
        .slice(0, 4);
      if (pieces.length >= 1) {
        const candidate = pieces
          .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
          .join(' ');
        if (candidate.length > 2) {
          data.name = candidate;
          console.log(`✓ Name inferred from email local-part: "${data.name}"`);
        }
      }
    }
  }

  // ========== FINAL NORMALIZATION OF FIELDS ==========
  if (data.name) data.name = data.name.replace(/\s+/g, ' ').replace(/[\[\]]/g, '').trim();
  if (data.location) {
    data.location = data.location
      .replace(/[\[\]]/g, '')
      .replace(/Array\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (data.role) data.role = data.role.replace(/\s+/g, ' ').trim();
  if (data.dateOfBirth) data.dateOfBirth = data.dateOfBirth.trim();

  console.log(`\n📊 Final extracted data:`, JSON.stringify(data, null, 2));
  return data;
}

module.exports = {
  extractResumeData
};
