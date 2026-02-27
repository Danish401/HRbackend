const express = require('express');
const router = express.Router();
const outlookEmailService = require('../services/outlookEmailService');
const { checkTokenStatus } = require('../services/graphService');

// Get today's Outlook emails
router.get('/fetch-today', async (req, res) => {
  try {
    const userId = process.env.MS_GRAPH_USER_ID;
    if (!userId) {
      return res.status(400).json({ error: 'MS_GRAPH_USER_ID not configured' });
    }

    // Check token status first
    const tokenStatus = await checkTokenStatus(userId);
    if (tokenStatus.status !== 'valid') {
      return res.status(401).json({ 
        error: 'Authentication required', 
        tokenStatus: tokenStatus 
      });
    }

    // Fetch today's emails
    const result = await outlookEmailService.fetchTodaysOutlookMessages(userId, req.app.get('io'));
    
    res.json({
      message: 'Successfully fetched today\'s Outlook emails',
      userId: userId,
      result: result,
      fetchedAt: new Date()
    });
  } catch (error) {
    console.error('Error fetching today\'s Outlook emails:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for daily fetch with response
router.post('/trigger-daily-fetch', async (req, res) => {
  try {
    const userId = process.env.MS_GRAPH_USER_ID;
    if (!userId) {
      return res.status(400).json({ error: 'MS_GRAPH_USER_ID not configured' });
    }

    // Check token status first
    const tokenStatus = await checkTokenStatus(userId);
    if (tokenStatus.status !== 'valid') {
      return res.status(401).json({ 
        error: 'Authentication required', 
        tokenStatus: tokenStatus 
      });
    }

    // Fetch today's emails
    const result = await outlookEmailService.fetchTodaysOutlookMessages(userId, req.app.get('io'));
    
    res.json({
      success: true,
      message: 'Daily Outlook email fetch completed',
      userId: userId,
      result: result,
      triggeredAt: new Date()
    });
  } catch (error) {
    console.error('Error triggering daily Outlook fetch:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check status of daily email fetching
router.get('/status', async (req, res) => {
  try {
    const userId = process.env.MS_GRAPH_USER_ID;
    
    const config = {
      configured: !!process.env.MS_GRAPH_CLIENT_ID && !!process.env.MS_GRAPH_CLIENT_SECRET && !!userId,
      clientId: process.env.MS_GRAPH_CLIENT_ID ? '***' + process.env.MS_GRAPH_CLIENT_ID.slice(-4) : null,
      tenantId: process.env.MS_GRAPH_TENANT_ID,
      userId: userId,
      redirectUri: process.env.MS_GRAPH_REDIRECT_URI
    };

    let tokenStatus = null;
    if (userId) {
      tokenStatus = await checkTokenStatus(userId);
    }

    res.json({
      service: 'Daily Outlook Email Fetcher',
      config: config,
      tokenStatus: tokenStatus,
      status: config.configured && tokenStatus && tokenStatus.status === 'valid' ? 'active' : 'inactive',
      checkedAt: new Date()
    });
  } catch (error) {
    console.error('Error checking daily Outlook status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for real-time fetch
router.post('/trigger-realtime-fetch', async (req, res) => {
  try {
    const userId = process.env.MS_GRAPH_USER_ID;
    if (!userId) {
      return res.status(400).json({ error: 'MS_GRAPH_USER_ID not configured' });
    }

    // Check token status first
    const tokenStatus = await checkTokenStatus(userId);
    if (tokenStatus.status !== 'valid') {
      return res.status(401).json({ 
        error: 'Authentication required', 
        tokenStatus: tokenStatus 
      });
    }

    // Fetch today's emails
    const io = req.app.get('io');
    const result = await outlookEmailService.fetchTodaysOutlookMessages(userId, io);
    
    res.json({
      success: true,
      message: 'Real-time Outlook email fetch completed',
      userId: userId,
      result: result,
      triggeredAt: new Date()
    });
  } catch (error) {
    console.error('Error triggering real-time Outlook fetch:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;