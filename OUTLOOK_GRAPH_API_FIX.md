# Outlook Graph API 401 Error Fix

This document describes the fixes implemented to resolve the Outlook Graph API 401 Unauthorized error for personal Outlook accounts like `danishali700@outlook.com`.

## Problem

The Outlook Graph API was returning 401 Unauthorized errors when trying to fetch emails for personal Outlook accounts (@outlook.com). This was happening because:

1. Personal accounts sometimes have expired or invalid tokens
2. The token refresh mechanism wasn't handling 401 errors properly
3. No proper error recovery was in place

## Solutions Implemented

### 1. Enhanced Token Validation
- Added `checkTokenStatus()` function to verify token validity before API calls
- Improved token refresh logic in `getValidToken()` to handle various error scenarios
- Added proper handling for `invalid_grant` errors

### 2. Automatic 401 Error Recovery
- Updated `fetchOutlookMessages()` to catch 401 errors and automatically refresh tokens
- Added retry mechanism after token refresh
- Better error messaging for debugging

### 3. Route Registration
- Added `/api/outlook` routes for managing Outlook email fetching
- Included endpoints for fetching today's emails, checking status, and triggering manual fetches

### 4. Service Integration
- Updated email service to use the enhanced `outlookEmailService` instead of basic `graphService`
- Changed polling to use the improved daily fetch functionality

### 5. Diagnostic Tool
- Created `fix-outlook-401.js` script to diagnose and fix token issues

## New API Endpoints

- `GET /api/outlook/fetch-today` - Fetch today's Outlook emails
- `POST /api/outlook/trigger-daily-fetch` - Manually trigger daily fetch
- `GET /api/outlook/status` - Check Outlook integration status
- `POST /api/outlook/trigger-realtime-fetch` - Trigger real-time fetch

## How to Use

### To fix token issues:
```bash
cd backend
node scripts/fix-outlook-401.js
```

### To manually trigger Outlook email fetch:
```bash
curl -X POST http://localhost:5000/api/outlook/trigger-daily-fetch \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

### To check Outlook status:
```bash
curl -X GET http://localhost:5000/api/outlook/status \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

## Environment Variables Required

Make sure these are set in your `.env` file:
- `MS_GRAPH_CLIENT_ID` - Your Azure AD Application Client ID
- `MS_GRAPH_CLIENT_SECRET` - Your Azure AD Application Client Secret
- `MS_GRAPH_USER_ID` - The Outlook email address to monitor (e.g., danishali700@outlook.com)
- `MS_GRAPH_TENANT_ID` - Usually 'common' for multi-tenant apps
- `MS_GRAPH_REDIRECT_URI` - Your app's redirect URI

## Troubleshooting

If you still encounter 401 errors:

1. Make sure your Outlook account is properly authorized:
   - Visit `http://localhost:5000/api/outlook-auth/login`
   - Complete the OAuth flow

2. Check your Azure AD App Registration:
   - Ensure 'Mail.Read' permission is granted
   - Ensure 'Contacts.Read' permission is granted (if needed)
   - Admin consent may be required for some permissions

3. Verify your credentials in `.env` file

4. Run the diagnostic script to clean up token issues:
   ```bash
   node scripts/fix-outlook-401.js
   ```