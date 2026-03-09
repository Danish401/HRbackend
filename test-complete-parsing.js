/**
 * Test Complete Resume Parsing with New Fields
 * Tests Gemini AI parsing with all required UI fields
 */

require('dotenv').config();
const geminiAIService = require('./services/geminiAIService');
const validationService = require('./services/validationService');

async function runCompleteTest() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 COMPLETE RESUME PARSING TEST - ALL UI FIELDS');
  console.log('='.repeat(80) + '\n');

  // Sample resume text (similar to Aditya's resume)
  const sampleResume = `
ADITYA RAGHAV
Web Designer

adityaraghav86656@gmail.com | +91 9045761043 | Gurugram, India
LinkedIn: https://www.linkedin.com/in/adityaraghav
GitHub: https://github.com/adityaraghav
Portfolio: https://adityaraghav.design

PROFESSIONAL SUMMARY
Creative Web Designer skilled in building responsive, user-friendly websites with 
HTML, CSS, JavaScript, Tailwind CSS, and Bootstrap. Experienced in Figma and Adobe XD, 
blending design and technical expertise to deliver intuitive, visually engaging 
interfaces that enhance user experience and brand identity.

EXPERIENCE
2.5 years of experience in web design and development

SKILLS
• HTML5 • CSS3 • JavaScript • Tailwind CSS • Bootstrap • React.js
• Figma • Adobe XD • Photoshop • Illustrator • Git • Responsive Design
• UI/UX Design • Wireframing • Prototyping • Cross-browser Compatibility

EDUCATION
Bachelor's Degree in Computer Application
2020 – 2023

PERSONAL DETAILS
Date of Birth: 27/06/2002
Languages: English, Hindi
Notice Period: 30 days
Current Salary: INR 6 LPA
`;

  console.log('📄 Testing with sample resume...\n');

  if (!process.env.GEMINI_API_KEY) {
    console.log('⚠️  GEMINI_API_KEY not configured!');
    console.log('   Please add your API key to backend/.env');
    console.log('   Get one from: https://makersuite.google.com/app/apikey\n');
    
    // Test validation service instead
    console.log('📝 Testing validation service only...\n');
    
    const mockData = {
      fullName: 'ADITYA RAGHAV',
      firstName: 'ADITYA',
      lastName: 'RAGHAV',
      email: 'adityaraghav86656@gmail.com',
      contactNumber: '+91 9045761043',
      currentRole: 'Web Designer',
      experience: '2.5',
      dateOfBirth: '27/06/2002',
      location: 'Gurugram, India',
      currentSalary: 'INR 6 LPA',
      noticePeriod: '30 days',
      linkedInProfile: 'https://www.linkedin.com/in/adityaraghav',
      githubProfile: 'https://github.com/adityaraghav',
      portfolioWebsite: 'https://adityaraghav.design',
      professionalSummary: 'Creative Web Designer...',
      skills: ['HTML5', 'CSS3', 'JavaScript', 'Tailwind CSS', 'Figma'],
      education: "Bachelor's Degree in Computer Application",
      workHistory: [],
      certifications: []
    };
    
    const validation = validationService.validateResume(mockData);
    console.log('✅ Validation Result:');
    console.log(`   Confidence: ${validation.confidence}%`);
    console.log(`   Needs Review: ${validation.needsReview}`);
    console.log(`   Warnings: ${validation.warnings.length}\n`);
    
    return;
  }

  try {
    console.log('🤖 Step 1: Sending to Gemini AI...\n');
    
    const result = await geminiAIService.parseResume(sampleResume);
    
    console.log('\n✅ Step 2: Gemini AI Response Received!\n');
    console.log('='.repeat(80));
    console.log('📊 EXTRACTED DATA FOR UI');
    console.log('='.repeat(80));
    
    const data = result.data;
    
    // Display all fields needed for UI
    console.log('\n👤 NAME INFORMATION:');
    console.log(`   Full Name: "${data.fullName}"`);
    console.log(`   First Name: "${data.firstName}"`);
    console.log(`   Last Name: "${data.lastName}"`);
    
    console.log('\n📞 CONTACT INFORMATION:');
    console.log(`   Email: "${data.email}"`);
    console.log(`   Phone: "${data.contactNumber}"`);
    console.log(`   Location: "${data.location}"`);
    
    console.log('\n💼 PROFESSIONAL INFORMATION:');
    console.log(`   Current Role: "${data.currentRole}"`);
    console.log(`   Experience: "${data.experience} years"`);
    console.log(`   Notice Period: "${data.noticePeriod || 'Not specified'}"`);
    console.log(`   Current Salary: "${data.currentSalary || 'Not specified'}"`);
    
    console.log('\n🎂 PERSONAL INFORMATION:');
    console.log(`   Date of Birth: "${data.dateOfBirth}"`);
    
    console.log('\n🔗 PROFESSIONAL LINKS:');
    console.log(`   LinkedIn: "${data.linkedInProfile || 'Not provided'}"`);
    console.log(`   GitHub: "${data.githubProfile || 'Not provided'}"`);
    console.log(`   Portfolio: "${data.portfolioWebsite || 'Not provided'}"`);
    
    console.log('\n📝 SUMMARY:');
    console.log(`   Professional Summary: "${data.professionalSummary?.substring(0, 100)}..."`);
    
    console.log('\n🛠️ SKILLS:');
    console.log(`   Total Skills: ${data.skills.length}`);
    console.log(`   Top Skills: ${data.skills.slice(0, 5).join(', ')}`);
    
    console.log('\n🎓 EDUCATION:');
    console.log(`   Education: "${data.education}"`);
    
    console.log('\n='.repeat(80));
    console.log('📈 VALIDATION RESULTS');
    console.log('='.repeat(80));
    
    const validation = validationService.validateResume(data);
    console.log(`\n✅ Confidence Score: ${validation.confidence}%`);
    console.log(`✅ Valid: ${validation.isValid ? 'YES' : 'NO'}`);
    console.log(`✅ Needs Review: ${validation.needsReview ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`⚠️  Warnings: ${validation.warnings.length}`);
    
    if (validation.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      validation.warnings.forEach((w, i) => console.log(`   ${i+1}. ${w}`));
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🎯 TEST RESULTS');
    console.log('='.repeat(80));
    
    // Check if all critical fields are present
    const criticalFields = [
      'fullName', 'firstName', 'lastName', 'email', 'contactNumber',
      'currentRole', 'experience', 'location'
    ];
    
    let allPresent = true;
    criticalFields.forEach(field => {
      if (!data[field] || data[field].length === 0) {
        console.log(`❌ Missing: ${field}`);
        allPresent = false;
      } else {
        console.log(`✅ Present: ${field}`);
      }
    });
    
    console.log('\n' + '='.repeat(80));
    
    if (allPresent && validation.confidence >= 70) {
      console.log('\n🎉 SUCCESS! All critical fields extracted correctly!');
      console.log('   The resume is ready for UI display.\n');
    } else if (allPresent) {
      console.log('\n⚠️  PARTIAL SUCCESS - Fields extracted but confidence is low');
      console.log('   Manual review may be needed.\n');
    } else {
      console.log('\n❌ FAILED - Some critical fields are missing');
      console.log('   Please check the extraction logic.\n');
    }
    
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error(`Error: ${error.message}`);
    console.error('\n💡 This could be due to:');
    console.error('   1. Invalid Gemini API key');
    console.error('   2. Network connectivity issues');
    console.error('   3. Rate limiting from Google API');
    console.error('\n   Falling back to pattern-based extraction...\n');
    
    // Try fallback
    const fallbackResult = await geminiAIService._fallbackExtraction(sampleResume);
    console.log('✅ Fallback extraction completed');
    console.log(`   Confidence: ${fallbackResult.confidence}%`);
    console.log(`   Source: ${fallbackResult.source}\n`);
  }
}

// Run the test
runCompleteTest().catch(error => {
  console.error('\n❌ Test crashed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
