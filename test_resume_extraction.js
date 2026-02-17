const { extractResumeData } = require('./services/pdfParser');

// Test cases for different resume formats
const testCases = [
  {
    name: "Standard resume with name label",
    text: "Name: John Smith\nEmail: john.smith@gmail.com\nPhone: +1-234-567-8900\nSoftware Engineer",
    expected: { name: "John Smith" }
  },
  {
    name: "All caps name at top",
    text: "JOHN SMITH\nSoftware Engineer\njohn.smith@gmail.com\n(123) 456-7890",
    expected: { name: "JOHN SMITH" }
  },
  {
    name: "Capitalized name at top",
    text: "John Smith\nSoftware Engineer\njohn.smith@gmail.com\n(123) 456-7890",
    expected: { name: "John Smith" }
  },
  {
    name: "Combined name (potential issue case)",
    text: "JOHNSMITH\nSoftware Engineer\njohn.smith@gmail.com\n(123) 456-7890",
    expected: { name: "JOHN SMITH" }
  },
  {
    name: "Resume with 'Last Updated' issue",
    text: "JOHN DOE\nLast Updated: Jan 2023\nSoftware Developer\nEmail: john.doe@example.com\nPhone: 1234567890",
    expected: { name: "JOHN DOE" }
  },
  {
    name: "Name after contact info",
    text: "Contact: john.doe@gmail.com\nPhone: 123-456-7890\nJohn Doe\nSenior Developer",
    expected: { name: "John Doe" }
  }
];

console.log("🧪 Testing resume extraction improvements...\n");

let passedTests = 0;
let totalTests = testCases.length;

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`);
  
  const result = extractResumeData(testCase.text);
  const nameFound = result.name && result.name.trim() !== '';
  
  console.log(`  Input: "${testCase.text.substring(0, 50)}..."`);
  console.log(`  Expected name: "${testCase.expected.name}"`);
  console.log(`  Extracted name: "${result.name}"`);
  console.log(`  Status: ${nameFound ? '✅ PASS' : '❌ FAIL'}`);
  
  if (nameFound) {
    passedTests++;
  }
  
  console.log('');
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 All tests passed!');
} else {
  console.log(`⚠️  ${totalTests - passedTests} tests failed.`);
}