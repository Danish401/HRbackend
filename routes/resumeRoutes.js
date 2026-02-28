const express = require('express');
const router = express.Router();
const Resume = require('../models/Resume');

// Get all resumes
router.get('/', async (req, res) => {
  try {
    const resumes = await Resume.find().sort({ extractedAt: -1 });
    res.json(resumes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single resume by ID
router.get('/:id', async (req, res) => {
  try {
    const resume = await Resume.findById(req.params.id);
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a resume
router.delete('/:id', async (req, res) => {
  try {
    const resume = await Resume.findByIdAndDelete(req.params.id);
    if (!resume) {
      return res.status(404).json({ error: 'Resume not found' });
    }
    res.json({ message: 'Resume deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update resume details
router.put('/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Build update object for attachmentData
    const updateObj = {};
    
    // Fields that can be updated
    const updatableFields = [
      'name', 'email', 'contactNumber', 'dateOfBirth', 
      'role', 'location', 'experience', 'summary'
    ];
    
    // Check each field in request body
    for (const [key, value] of Object.entries(req.body)) {
      if (updatableFields.includes(key)) {
        updateObj[`attachmentData.${key}`] = value;
      }
    }
    
    // Handle nested links separately
    if (req.body.links) {
      if (typeof req.body.links === 'object') {
        if (req.body.links.linkedin !== undefined) {
          updateObj['attachmentData.links.linkedin'] = req.body.links.linkedin;
        }
        if (req.body.links.github !== undefined) {
          updateObj['attachmentData.links.github'] = req.body.links.github;
        }
        if (req.body.links.portfolio !== undefined) {
          updateObj['attachmentData.links.portfolio'] = req.body.links.portfolio;
        }
      }
    }
    
    // Also handle links fields passed as flattened keys (like 'links.linkedin')
    if (req.body['links.linkedin'] !== undefined) {
      updateObj['attachmentData.links.linkedin'] = req.body['links.linkedin'];
    }
    if (req.body['links.github'] !== undefined) {
      updateObj['attachmentData.links.github'] = req.body['links.github'];
    }
    if (req.body['links.portfolio'] !== undefined) {
      updateObj['attachmentData.links.portfolio'] = req.body['links.portfolio'];
    }
    
    // Find and update the resume
    const resume = await Resume.findByIdAndUpdate(
      id,
      { $set: updateObj },
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
    console.error('Error updating resume:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get resume count
router.get('/stats/count', async (req, res) => {
  try {
    const count = await Resume.countDocuments();
    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
