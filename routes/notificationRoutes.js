const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { Resume } = require('../models/Resume'); // Named export is Resume model
const Email = require('../models/Resume'); // Default export is Email model

/**
 * Get today's birthday notifications
 */
router.get('/birthdays/today', authenticate, async (req, res) => {
  try {
    const today = new Date();
    const day = today.getDate();
    const month = today.getMonth() + 1; // 1-12
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const monthName = monthNames[today.getMonth()];

    // Get both Email records and direct Resume records
    const [emails, resumes] = await Promise.all([
      Email.find({ hasAttachment: true }),
      Resume.find({})
    ]);
    
    // Combine and normalize data
    const allPeople = [
      ...emails.map(e => ({
        _id: e._id,
        name: e.attachmentData?.name || 'Unknown Name',
        phone: e.attachmentData?.contactNumber || 'No Phone',
        dob: e.attachmentData?.dateOfBirth,
        source: 'Email'
      })),
      ...resumes.map(r => ({
        _id: r._id,
        name: r.name || 'Unknown Name',
        phone: r.contactNumber || 'No Phone',
        dob: r.dateOfBirth,
        source: 'Upload'
      }))
    ];
    
    const birthdayPeople = allPeople.filter(person => {
      const dob = person.dob;
      if (!dob) return false;
      
      // Convert to lowercase for case-insensitive comparison
      const dobLower = dob.toLowerCase();
      
      // Get today's date components
      const dayStr = String(day).padStart(2, '0');
      const monthStr = String(month).padStart(2, '0');
      
      // Check various date formats
      const datePatterns = [
        // DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, DD-MM-YY
        `${dayStr}/${monthStr}/`,
        `${dayStr}-${monthStr}-`,
        // MM/DD/YYYY, MM/DD/YY, MM-DD-YYYY, MM-DD-YY
        `${monthStr}/${dayStr}/`,
        `${monthStr}-${dayStr}-`,
        // DD/MM, DD-MM, MM/DD, MM-DD
        `${dayStr}/${monthStr}`,
        `${dayStr}-${monthStr}`,
        `${monthStr}/${dayStr}`,
        `${monthStr}-${dayStr}`,
        // Numeric without separators
        `${dayStr}${monthStr}`,
        `${monthStr}${dayStr}`,
        // Day and month name combinations
        `${dayStr} ${monthName.toLowerCase()}`,
        `${monthName.toLowerCase()} ${dayStr}`,
        `${day} ${monthName.toLowerCase()}`,
        `${monthName.toLowerCase()} ${day}`
      ];
      
      // Check if any pattern matches the date of birth
      for (const pattern of datePatterns) {
        if (dobLower.includes(pattern.toLowerCase())) {
          return true;
        }
      }
      
      // Additional check for spelled out dates
      const dayOrdinal = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`;
      if (dobLower.includes(dayOrdinal.toLowerCase()) && dobLower.includes(monthName.toLowerCase())) {
        return true;
      }
      
      return false;
    });

    res.json({
      count: birthdayPeople.length,
      birthdays: birthdayPeople,
      date: today.toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error fetching birthday notifications:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;