const { extractResumeData } = require('./services/pdfParser');

// Test specifically for the 'Last Updated' issue
const problematicText = 'JOHN DOE\nLast Updated: Jan 2023\nSoftware Developer\nEmail: john.doe@example.com\nPhone: 1234567890';

console.log('Testing the specific "Last Updated" problem case...');
const result = extractResumeData(problematicText);

console.log('\nResults:');
console.log('Name extracted:', result.name);
console.log('Expected: JOHN DOE');
console.log('Status:', result.name === 'JOHN DOE' ? '✅ CORRECT' : '❌ INCORRECT');

// Another test case with 'Last Updated' at the beginning
const problematicText2 = 'Last Updated: Jan 2023\nJOHN DOE\nSoftware Developer\nEmail: john.doe@example.com';

console.log('\n\nTesting with "Last Updated" at beginning...');
const result2 = extractResumeData(problematicText2);

console.log('\nResults:');
console.log('Name extracted:', result2.name);
console.log('Expected: JOHN DOE (not "Last Updated: Jan 2023")');
console.log('Status:', result2.name === 'JOHN DOE' ? '✅ CORRECT' : '❌ INCORRECT');