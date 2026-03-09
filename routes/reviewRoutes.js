const express = require('express');
const router = express.Router();
const Email = require('../models/Resume');

/**
 * Review Dashboard Routes
 * For manually reviewing low-confidence resume extractions
 */

// GET /api/review/resumes - Get all resumes needing review
router.get('/resumes', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status = 'pending',
      sortBy = 'receivedAt',
      order = 'desc'
    } = req.query;

    const query = {
      'attachmentData.processingMetadata.needsReview': true
    };

    // Filter by review status if provided
    if (status === 'approved') {
      query['attachmentData.processingMetadata.reviewStatus'] = 'approved';
    } else if (status === 'rejected') {
      query['attachmentData.processingMetadata.reviewStatus'] = 'rejected';
    } else {
      query['attachmentData.processingMetadata.reviewStatus'] = { $exists: false };
    }

    const resumes = await Email.find(query)
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    const total = await Email.countDocuments(query);

    res.json({
      success: true,
      data: resumes,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        hasNext: page < Math.ceil(total / parseInt(limit)),
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Error fetching review resumes:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/review/resumes/:id - Get specific resume for review
router.get('/resumes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const resume = await Email.findById(id).lean();
    
    if (!resume) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found'
      });
    }

    res.json({
      success: true,
      data: resume
    });

  } catch (error) {
    console.error('Error fetching resume:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PUT /api/review/resumes/:id/approve - Approve a resume
router.put('/resumes/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewerName, notes } = req.body;

    const resume = await Email.findById(id);
    
    if (!resume) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found'
      });
    }

    // Update with approval
    resume.attachmentData.processingMetadata.reviewStatus = 'approved';
    resume.attachmentData.processingMetadata.reviewedBy = reviewerName || 'System';
    resume.attachmentData.processingMetadata.reviewedAt = new Date();
    resume.attachmentData.processingMetadata.reviewNotes = notes || '';
    resume.attachmentData.processingMetadata.needsReview = false;

    await resume.save();

    res.json({
      success: true,
      message: 'Resume approved successfully',
      data: resume
    });

  } catch (error) {
    console.error('Error approving resume:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PUT /api/review/resumes/:id/reject - Reject a resume
router.put('/resumes/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewerName, reason, notes } = req.body;

    const resume = await Email.findById(id);
    
    if (!resume) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found'
      });
    }

    // Update with rejection
    resume.attachmentData.processingMetadata.reviewStatus = 'rejected';
    resume.attachmentData.processingMetadata.reviewedBy = reviewerName || 'System';
    resume.attachmentData.processingMetadata.reviewedAt = new Date();
    resume.attachmentData.processingMetadata.rejectionReason = reason || '';
    resume.attachmentData.processingMetadata.reviewNotes = notes || '';
    resume.attachmentData.processingMetadata.needsReview = false;

    await resume.save();

    res.json({
      success: true,
      message: 'Resume rejected',
      data: resume
    });

  } catch (error) {
    console.error('Error rejecting resume:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PUT /api/review/resumes/:id/update - Manually update extracted data
router.put('/resumes/:id/update', async (req, res) => {
  try {
    const { id } = req.params;
    const { updates } = req.body; // Object with fields to update

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Updates object is required'
      });
    }

    const resume = await Email.findById(id);
    
    if (!resume) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found'
      });
    }

    // Merge updates into attachmentData
    const allowedFields = [
      'name', 'email', 'contactNumber', 'dateOfBirth',
      'experience', 'role', 'location', 'skills',
      'education', 'summary', 'links', 'workHistory', 'certifications'
    ];

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        resume.attachmentData[key] = updates[key];
      }
    });

    // Mark as reviewed
    resume.attachmentData.processingMetadata.reviewStatus = 'approved';
    resume.attachmentData.processingMetadata.reviewedAt = new Date();
    resume.attachmentData.processingMetadata.needsReview = false;
    resume.attachmentData.processingMetadata.manuallyEdited = true;

    await resume.save();

    res.json({
      success: true,
      message: 'Resume updated successfully',
      data: resume
    });

  } catch (error) {
    console.error('Error updating resume:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/review/stats - Get review statistics
router.get('/stats', async (req, res) => {
  try {
    const [
      pendingCount,
      approvedCount,
      rejectedCount,
      totalCount
    ] = await Promise.all([
      Email.countDocuments({
        'attachmentData.processingMetadata.needsReview': true,
        'attachmentData.processingMetadata.reviewStatus': { $exists: false }
      }),
      Email.countDocuments({
        'attachmentData.processingMetadata.reviewStatus': 'approved'
      }),
      Email.countDocuments({
        'attachmentData.processingMetadata.reviewStatus': 'rejected'
      }),
      Email.countDocuments({
        'attachmentData.processingMetadata.needsReview': true
      })
    ]);

    const avgConfidence = await Email.aggregate([
      {
        $match: {
          'attachmentData.processingMetadata.needsReview': true
        }
      },
      {
        $group: {
          _id: null,
          avgConfidence: { $avg: '$attachmentData.processingMetadata.confidence' }
        }
      }
    ]);

    res.json({
      success: true,
      stats: {
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount,
        total: totalCount,
        avgConfidence: avgConfidence[0]?.avgConfidence || 0
      }
    });

  } catch (error) {
    console.error('Error fetching review stats:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/review/resumes/:id - Delete a resume
router.delete('/resumes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await Email.findByIdAndDelete(id);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Resume not found'
      });
    }

    res.json({
      success: true,
      message: 'Resume deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting resume:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
