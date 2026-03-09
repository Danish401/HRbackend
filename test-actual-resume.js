/**
 * Test with Actual Resume Data from User Report
 */

const { extractResumeData } = require('./services/pdfParser');

// Actual resume text from the user's error log
const actualResume = `
SUMMARY

SKILLS

EDUCATION

PERSONAL DETAILS

PROFESSIONAL EXPERIENCE

9045761043
adityaraghav86656@gmail.com
Gurugram (UP)

ADITYA RAGHAV

Web Designer

Creative Web Designer skilled in building responsive, user-friendly websites with HTML, CSS, JavaScript, Tailwind
CSS, and Bootstrap. Experienced in Figma and Adobe XD, blending design and technical expertise to deliver
intuitive, visually engaging interfaces that enhance user experience and brand identity.      
Date of Birth :
27/06/2002
Bachelor's Degree in Computer Application
2020 – 2023
`;

console.log('\n' + '='.repeat(60));
console.log('🧪 TESTING WITH ACTUAL RESUME DATA');
console.log('='.repeat(60) + '\n');

const result = extractResumeData(actualResume);

console.log('\n' + '='.repeat(60));
console.log('📊 EXTRACTION RESULTS');
console.log('='.repeat(60));
console.log(`Name: "${result.name}"`);
console.log(`Email: "${result.email}"`);
console.log(`Phone: "${result.contactNumber}"`);
console.log(`Role: "${result.role}"`);
console.log(`Location: "${result.location}"`);
console.log(`Skills: ${JSON.stringify(result.skills, null, 2)}`);
console.log('='.repeat(60) + '\n');

if (result.name === 'ADITYA RAGHAV') {
  console.log('✅ SUCCESS: Correctly extracted "ADITYA RAGHAV" as name!\n');
  process.exit(0);
} else {
  console.log(`❌ FAILED: Expected "ADITYA RAGHAV", got "${result.name}"\n`);
  process.exit(1);
}
