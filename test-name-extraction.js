/**
 * Test Name Extraction Fix
 * Tests that section headers are properly filtered out
 */

const { extractResumeData } = require('./services/pdfParser');

// Test case 1: Resume with SUMMARY at top (the reported issue)
const testResume1 = `
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

Creative Web Designer skilled in building responsive, user-friendly websites.
`;

// Test case 2: Resume with SKILLS at top
const testResume2 = `
SKILLS
• JavaScript • Python • React

EXPERIENCE
Software Engineer at Tech Corp

JOHN DOE
john@email.com
`;

// Test case 3: Normal resume (name at top)
const testResume3 = `
JANE SMITH
jane@email.com | +1-234-567-8900

SUMMARY
Experienced professional

EXPERIENCE
Senior Manager at ABC Corp
`;

console.log('\n' + '='.repeat(60));
console.log('🧪 TESTING NAME EXTRACTION FIX');
console.log('='.repeat(60) + '\n');

let passed = 0;
let failed = 0;

// Test 1
console.log('📝 TEST 1: Resume with SUMMARY section header');
console.log('-'.repeat(60));
const result1 = extractResumeData(testResume1);
if (result1.name === 'ADITYA RAGHAV') {
  console.log('✅ PASSED: Correctly extracted "ADITYA RAGHAV"');
  passed++;
} else {
  console.log(`❌ FAILED: Expected "ADITYA RAGHAV", got "${result1.name}"`);
  failed++;
}
console.log();

// Test 2
console.log('📝 TEST 2: Resume with SKILLS section header');
console.log('-'.repeat(60));
const result2 = extractResumeData(testResume2);
if (result2.name === 'JOHN DOE') {
  console.log('✅ PASSED: Correctly extracted "JOHN DOE"');
  passed++;
} else {
  console.log(`❌ FAILED: Expected "JOHN DOE", got "${result2.name}"`);
  failed++;
}
console.log();

// Test 3
console.log('📝 TEST 3: Normal resume with name at top');
console.log('-'.repeat(60));
const result3 = extractResumeData(testResume3);
if (result3.name === 'JANE SMITH') {
  console.log('✅ PASSED: Correctly extracted "JANE SMITH"');
  passed++;
} else {
  console.log(`❌ FAILED: Expected "JANE SMITH", got "${result3.name}"`);
  failed++;
}
console.log();

// Summary
console.log('='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 ALL TESTS PASSED! Name extraction is working correctly.\n');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the implementation.\n');
  process.exit(1);
}
