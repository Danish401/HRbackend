const express = require('express');
const router = express.Router();
<<<<<<< HEAD
const Resume = require('../models/Resume');
=======
const Email = require('../models/Resume'); // This is the Email model (default export)
>>>>>>> 2261d20c07656375006030a225906e77a010f55a

// Get all resumes
router.get('/', async (req, res) => {
  try {
<<<<<<< HEAD
    const resumes = await Resume.find().sort({ extractedAt: -1 });
=======
    const resumes = await Email.find().sort({ extractedAt: -1 });
>>>>>>> 2261d20c07656375006030a225906e77a010f55a
    res.json(resumes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single resume by ID
router.get('/:id', async (req, res) => {
  try {
<<<<<<< HEAD
    const resume = await Resume.findById(req.params.id);
=======
    const resume = await Email.findById(req.params.id);
>>>>>>> 2261d20c07656375006030a225906e77a010f55a
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

<<<<<<< HEAD
// Delete a resume
router.delete('/:id', async (req, res) => {
  try {
    const resume = await Resume.findByIdAndDelete(req.params.id);
=======
// Update resume name (kept for backward compatibility)
router.put('/:id/name', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    const resume = await Email.findByIdAndUpdate(
      req.params.id,
      { "attachmentData.name": name.trim() },
      { new: true, runValidators: true }
    );

    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    res.json({ 
      message: 'Name updated successfully',
      resume: resume
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update all resume details
router.put('/:id/details', async (req, res) => {
  try {
    const { 
      name, 
      email, 
      contactNumber, 
      dateOfBirth, 
      role, 
      location, 
      experience, 
      summary,
      links 
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    // Prepare update object for attachmentData
    const updateData = {
      "attachmentData.name": name.trim(),
      "attachmentData.email": email ? email.trim() : '',
      "attachmentData.contactNumber": contactNumber ? contactNumber.trim() : '',
      "attachmentData.dateOfBirth": dateOfBirth ? dateOfBirth.trim() : '',
      "attachmentData.role": role ? role.trim() : '',
      "attachmentData.location": location ? location.trim() : '',
      "attachmentData.experience": experience ? experience.trim() : '',
      "attachmentData.summary": summary ? summary.trim() : '',
      "attachmentData.links": {
        linkedin: links?.linkedin ? links.linkedin.trim() : '',
        github: links?.github ? links.github.trim() : '',
        portfolio: links?.portfolio ? links.portfolio.trim() : ''
      }
    };

    const resume = await Email.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }

    res.json({ 
      message: 'Resume details updated successfully',
      resume: resume
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a resume
router.delete('/:id', async (req, res) => {
  try {
    const resume = await Email.findByIdAndDelete(req.params.id);
>>>>>>> 2261d20c07656375006030a225906e77a010f55a
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json({ message: 'Resume deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get resume count
router.get('/stats/count', async (req, res) => {
  try {
<<<<<<< HEAD
    const count = await Resume.countDocuments();
=======
    const count = await Email.countDocuments();
>>>>>>> 2261d20c07656375006030a225906e77a010f55a
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
