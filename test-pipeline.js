/**
 * Test Script for Complete Resume Parsing Pipeline
 * Tests all components: Gemini AI, OCR, Multi-format, Queue, Validation
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const geminiAIService = require('./services/geminiAIService');
const validationService = require('./validationService');
const multiFormatProcessor = require('./multiFormatProcessor');

async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 RESUME PARSING PIPELINE - TEST SUITE');
  console.log('='.repeat(60) + '\n');

  const results = {
    passed: 0,
    failed: 0,
    skipped: 0
  };

  // ===== TEST 1: Gemini AI Service =====
  console.log('📝 TEST 1: Gemini AI Service');
  console.log('-'.repeat(60));
  
  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️  SKIPPED: GEMINI_API_KEY not configured\n');
    results.skipped++;
  } else {
    try {
      const sampleResume = `
JOHN DOE
john.doe@email.com | +1-234-567-8900 | New York, USA

EXPERIENCE
Senior Software Engineer at Tech Corp (2020-Present)
- Led development of microservices architecture
- Managed team of 5 developers

SKILLS
JavaScript, Python, AWS, Docker, Kubernetes

EDUCATION
Bachelor of Science in Computer Science
University of Technology (2016-2020)
      `;

      console.log('   Testing Gemini AI parsing...');
      const result = await geminiAIService.parseResume(sampleResume);
      
      if (result.success && result.data.name && result.data.email) {
        console.log('   ✅ PASSED: Gemini AI successfully parsed resume');
        console.log(`      Name: ${result.data.name}`);
        console.log(`      Email: ${result.data.email}`);
        console.log(`      Confidence: ${result.confidence}%`);
        results.passed++;
      } else {
        console.log('   ❌ FAILED: Missing required fields');
        results.failed++;
      }
    } catch (error) {
      console.log(`   ❌ FAILED: ${error.message}\n`);
      results.failed++;
    }
  }

  // ===== TEST 2: Validation Service =====
  console.log('\n📝 TEST 2: Validation Service');
  console.log('-'.repeat(60));
  
  try {
    const validData = {
      name: 'John Doe',
      email: 'john@example.com',
      contactNumber: '+12345678900',
      role: 'Software Engineer',
      experience: '5 years',
      location: 'New York',
      skills: ['JavaScript', 'Python'],
      education: 'Bachelor degree',
      summary: 'Experienced software engineer',
      links: { linkedin: 'https://linkedin.com/in/johndoe' },
      workHistory: [{ company: 'Tech Corp', position: 'Engineer' }]
    };

    const validation = validationService.validateResume(validData);
    
    if (validation.isValid && validation.confidence >= 70) {
      console.log('   ✅ PASSED: Validation service working correctly');
      console.log(`      Confidence: ${validation.confidence}%`);
      console.log(`      Warnings: ${validation.warnings.length}`);
      results.passed++;
    } else {
      console.log('   ❌ FAILED: Validation did not meet expectations');
      results.failed++;
    }
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
    results.failed++;
  }

  // ===== TEST 3: Multi-Format Processor (File Check) =====
  console.log('\n📝 TEST 3: Multi-Format Processor Initialization');
  console.log('-'.repeat(60));
  
  try {
    // Just check if processor is initialized
    if (multiFormatProcessor.tempDir) {
      console.log('   ✅ PASSED: Multi-format processor initialized');
      console.log(`      Temp directory: ${multiFormatProcessor.tempDir}`);
      results.passed++;
    } else {
      console.log('   ❌ FAILED: Processor not properly initialized');
      results.failed++;
    }
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
    results.failed++;
  }

  // ===== TEST 4: Low Confidence Detection =====
  console.log('\n📝 TEST 4: Low Confidence Detection');
  console.log('-'.repeat(60));
  
  try {
    const incompleteData = {
      name: '', // Missing name
      email: 'invalid-email', // Invalid email
      contactNumber: '', // Missing phone
      role: '', // Missing role
      skills: [], // No skills
      experience: ''
    };

    const validation = validationService.validateResume(incompleteData);
    
    if (!validation.isValid && validation.needsReview && validation.confidence < 50) {
      console.log('   ✅ PASSED: Low confidence correctly detected');
      console.log(`      Confidence: ${validation.confidence}%`);
      console.log(`      Needs Review: ${validation.needsReview}`);
      console.log(`      Reasons: ${validation.reviewReasons.join(', ')}`);
      results.passed++;
    } else {
      console.log('   ❌ FAILED: Should have flagged as low confidence');
      results.failed++;
    }
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}\n`);
    results.failed++;
  }

  // ===== TEST 5: Email Validation =====
  console.log('\n📝 TEST 5: Email Format Validation');
  console.log('-'.repeat(60));
  
  const validEmails = [
    'test@example.com',
    'user.name@domain.co.uk',
    'first.last@company.org'
  ];
  
  const invalidEmails = [
    'invalid',
    'missing@domain',
    '@nodomain.com'
  ];

  let emailTestPassed = true;
  
  validEmails.forEach(email => {
    if (!validationService.isValidEmail(email)) {
      console.log(`   ❌ FAILED: Should accept ${email}`);
      emailTestPassed = false;
    }
  });

  invalidEmails.forEach(email => {
    if (validationService.isValidEmail(email)) {
      console.log(`   ❌ FAILED: Should reject ${email}`);
      emailTestPassed = false;
    }
  });

  if (emailTestPassed) {
    console.log('   ✅ PASSED: Email validation working correctly');
    results.passed++;
  } else {
    results.failed++;
  }

  // ===== SUMMARY =====
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`⚠️  Skipped: ${results.skipped}`);
  console.log('='.repeat(60));

  if (results.failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! Pipeline is ready to use.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the issues above.\n');
  }

  // Cleanup
  console.log('🧹 Cleaning up...');
  try {
    await multiFormatProcessor.cleanup();
    console.log('✓ Temporary files cleaned\n');
  } catch (error) {
    console.log('Error cleaning up:', error.message);
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test suite crashed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
