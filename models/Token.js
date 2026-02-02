const mongoose = require('mongoose');

const tokenSchema = new mongoose.Schema({
  accountEmail: { type: String, required: true, unique: true },
  accessToken: { type: String, required: true },
  refreshToken: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Token', tokenSchema);
