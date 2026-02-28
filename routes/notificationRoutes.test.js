const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const notificationRoutes = require('./notificationRoutes');
const { Resume } = require('../models/Resume');
const Email = require('../models/Resume');

// Mock the authentication middleware
jest.mock('../middleware/auth', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'mockUserId' };
    next();
  }
}));

describe('Notification Routes', () => {
  let app;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationRoutes);

    // Connect to a test database
    await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/test_resume_db', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  beforeEach(async () => {
    // Clear collections before each test
    await Resume.deleteMany({});
    await Email.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  describe('GET /api/notifications/birthdays/today', () => {
    it('should return today\'s birthday notifications', async () => {
      // Create test data with today's birthday
      const today = new Date();
      const day = today.getDate();
      const month = today.getMonth() + 1;
      const monthNames = [
        "January", "February", "March", "April", "May", "June", 
        "July", "August", "September", "October", "November", "December"
      ];
      const monthName = monthNames[today.getMonth()];
      const dob = `${day}/${monthName.toLowerCase()}`;

      await Resume.create({
        name: 'John Doe',
        contactNumber: '+1234567890',
        dateOfBirth: dob
      });

      const response = await request(app)
        .get('/api/notifications/birthdays/today')
        .expect(200);

      expect(response.body).toHaveProperty('count');
      expect(response.body).toHaveProperty('birthdays');
      expect(response.body).toHaveProperty('date');
      expect(response.body.count).toBeGreaterThan(0);
      expect(response.body.birthdays[0].name).toBe('John Doe');
      expect(response.body.birthdays[0].phone).toBe('+1234567890');
    });

    it('should return empty array when no birthdays today', async () => {
      await Resume.create({
        name: 'Jane Smith',
        contactNumber: '+0987654321',
        dateOfBirth: '01/January'
      });

      const response = await request(app)
        .get('/api/notifications/birthdays/today')
        .expect(200);

      expect(response.body.count).toBe(0);
      expect(response.body.birthdays).toHaveLength(0);
    });
  });
});