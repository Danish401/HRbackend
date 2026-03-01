#!/usr/bin/env node
/**
 * Lists all Outlook tokens stored in MongoDB.
 * Use this to verify which email is authorized and fix MS_GRAPH_USER_ID mismatch.
 *
 * Run: node scripts/list-outlook-tokens.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Token = require('../models/Token');

async function listTokens() {
  console.log('🔍 Outlook Token Diagnostic\n');
  console.log('MS_GRAPH_USER_ID from .env:', process.env.MS_GRAPH_USER_ID || '(not set)');
  console.log('MS_GRAPH_REDIRECT_URI:', process.env.MS_GRAPH_REDIRECT_URI || '(default localhost)');
  console.log('');

  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/resumeextractor');
    console.log('✅ Connected to MongoDB\n');

    const tokens = await Token.find({}).select('accountEmail expiresAt updatedAt').lean();
    
    if (tokens.length === 0) {
      console.log('❌ No Outlook tokens found in database.\n');
      console.log('👉 Authorize your account:');
      const baseUrl = process.env.MS_GRAPH_REDIRECT_URI 
        ? process.env.MS_GRAPH_REDIRECT_URI.replace('/api/outlook-auth/callback', '')
        : `http://localhost:${process.env.PORT || 5000}`;
      console.log(`   ${baseUrl}/api/outlook-auth/login`);
      return;
    }

    console.log(`📋 Found ${tokens.length} token(s):\n`);
    const configuredId = (process.env.MS_GRAPH_USER_ID || '').toLowerCase();
    
    for (const t of tokens) {
      const email = t.accountEmail;
      const matches = email === configuredId;
      const status = matches ? '✅ MATCHES MS_GRAPH_USER_ID' : '⚠️  MISMATCH (update .env)';
      console.log(`   • ${email}`);
      console.log(`     Expires: ${t.expiresAt}`);
      console.log(`     ${status}\n`);
    }

    if (configuredId && !tokens.some(t => t.accountEmail === configuredId)) {
      console.log('⚠️  Your MS_GRAPH_USER_ID does not match any stored token!\n');
      console.log('   Fix: Update MS_GRAPH_USER_ID in .env to match the email you authorized:');
      console.log(`   MS_GRAPH_USER_ID=${tokens[0].accountEmail}\n`);
      console.log('   Or re-authorize using the correct email:');
      const baseUrl = process.env.MS_GRAPH_REDIRECT_URI 
        ? process.env.MS_GRAPH_REDIRECT_URI.replace('/api/outlook-auth/callback', '')
        : `http://localhost:${process.env.PORT || 5000}`;
      console.log(`   ${baseUrl}/api/outlook-auth/login`);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Done.');
  }
}

listTokens();
