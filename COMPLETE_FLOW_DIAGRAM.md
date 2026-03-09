# 🎯 Microsoft OAuth Automatic Refresh - Complete Flow

## 📊 Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    INITIAL SETUP (One-time)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  User visits login URL                 │
        │  http://localhost:5000/                │
        │         api/outlook-auth/login         │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Microsoft OAuth Page Opens            │
        │  - User signs in with Outlook account  │
        │  - Grants permissions                  │
        │  - Takes ~30 seconds                   │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Backend Receives Tokens               │
        │  ├─ Access Token (valid ~1 hour)       │
        │  └─ Refresh Token (valid 90 days)      │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Tokens Saved to MongoDB               │
        │  Collection: tokens                    │
        │  Document created for account          │
        └────────────────────────────────────────┘
                              │
                              ▼
                    ✅ READY FOR AUTO MODE

┌─────────────────────────────────────────────────────────────────┐
│              AUTOMATIC OPERATION (Every ~1 Hour)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  API Request Arrives                   │
        │  (e.g., fetch emails, check status)    │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Call getValidToken(accountEmail)      │
        │  Location: services/graphService.js    │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Check Database                        │
        │  Query: Token.findOne({accountEmail})  │
        └────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
                    ▼                   ▼
        ┌──────────────────┐  ┌──────────────────┐
        │ Token Missing    │  │ Token Found      │
        │                  │  │                  │
        │ Throw Error:     │  │ Validate Fields: │
        │ "Please auth"    │  │ - accessToken    │
        └──────────────────┘  │ - refreshToken   │
                              │ - expiresAt      │
                              └──────────────────┘
                                        │
                              ┌─────────┴─────────┐
                              │                   │
                              ▼                   ▼
                    ┌──────────────────┐  ┌──────────────────┐
                    │ Fields Missing   │  │ Fields Complete  │
                    │                  │  │                  │
                    │ Fallback Mode:   │  │ Check Expiry:    │
                    │ Use access token │  │ expiresAt > now? │
                    └──────────────────┘  └──────────────────┘
                                                    │
                                          ┌─────────┴─────────┐
                                          │                   │
                                          ▼                   ▼
                                ┌──────────────────┐  ┌──────────────────┐
                                │ Still Valid      │  │ Expired/Expiring │
                                │ (>5 min buffer)  │  │ (<5 min buffer)  │
                                │                  │  │                  │
                                │ Return token     │  │ TRIGGER REFRESH  │
                                │ Continue API call│  └──────────────────┘
                                └──────────────────┘            │
                                          ▲                     ▼
                                          │           ┌──────────────────┐
                                          │           │ Create MSAL Client│
                                          │           │ authority: common │
                                          │           │ or tenant-specific│
                                          │           └──────────────────┘
                                          │                     │
                                          │                     ▼
                                          │           ┌──────────────────┐
                                          │           │ Call Microsoft   │
                                          │           │ acquireTokenBy...│
                                          │           │ RefreshToken(req)│
                                          │           └──────────────────┘
                                          │                     │
                                          │           ┌─────────┴─────────┐
                                          │           │                   │
                                          │           ▼                   ▼
                                          │ ┌──────────────────┐  ┌──────────────────┐
                                          │ │ Success ✅        │  │ Failure ❌        │
                                          │ │ New access token  │  │ Check error type │
                                          │ │ + maybe new       │  │                  │
                                          │ │   refresh token   │  │ invalid_grant?   │
                                          │ └──────────────────┘  │ AADSTS70008?     │
                                          │           │           │ 401/403 status?  │
                                          │           │           └──────────────────┘
                                          │           │                     │
                                          │           │           ┌─────────┴─────────┐
                                          │           │           │                   │
                                          │           │           ▼                   ▼
                                          │           │ ┌──────────────────┐  ┌──────────────────┐
                                          │           │ │ Token Expired    │  │ Temporary Error  │
                                          │           │ │ Delete old token │  │ Keep old token   │
                                          │           │ │ Throw re-auth    │  │ Throw error      │
                                          │           │ │ error            │  │ Retry next time  │
                                          │           │ └──────────────────┘  └──────────────────┘
                                          │           │
                                          ▼           ▼
                                ┌──────────────────────────────────┐
                                │   Update Database                │
                                │                                  │
                                │ tokenRecord.accessToken = new    │
                                │ tokenRecord.refreshToken = new   │
                                │   (if Microsoft provided one)    │
                                │ tokenRecord.expiresAt = new      │
                                │ tokenRecord.updatedAt = now      │
                                │                                  │
                                │ Save to MongoDB                  │
                                └──────────────────────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────────────┐
                                │   Log Success                    │
                                │                                  │
                                │ "✅ Token refreshed successfully │
                                │  for user@outlook.com.           │
                                │  New expiry: 2024-03-09T15:05... │
                                │  (valid for ~59 minutes)"        │
                                └──────────────────────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────────────┐
                                │   Return New Access Token        │
                                │   to caller                      │
                                └──────────────────────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────────────┐
                                │   Continue Original API Request  │
                                │   Use fresh token to call        │
                                │   Microsoft Graph API            │
                                └──────────────────────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────────────┐
                                │   Fetch Emails / Perform Action  │
                                │   Process and save to database   │
                                │   Emit real-time notifications   │
                                └──────────────────────────────────┘
                                              │
                                              ▼
                                    ✅ REQUEST COMPLETE

┌─────────────────────────────────────────────────────────────────┐
│                AFTER 90 DAYS (Re-authorization)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Refresh Token Expires                 │
        │  (Happens after 90 days of inactivity) │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Next Auto-Refresh Attempt             │
        │  Calls Microsoft with expired token    │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Microsoft Returns Error               │
        │  {                                     │
        │    error: "invalid_grant",             │
        │    error_description:                  │
        │      "AADSTS70008: The refresh token   │
        │       has expired..."                  │
        │  }                                     │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Backend Detects Error                 │
        │  Checks: error === 'invalid_grant'     │
        │  Or: message includes 'AADSTS70008'    │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Clear Error Message Logged            │
        │  "❌ Refresh token has expired.         │
        │   User MUST re-authorize."             │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Delete Invalid Tokens                 │
        │  Token.deleteOne({accountEmail})       │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Throw User-Friendly Error             │
        │  "Authentication expired.              │
        │   Please re-authorize your Microsoft   │
        │   account."                            │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  User Sees Message in UI/Logs          │
        │  Clicks Login Link                     │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  User Re-authorizes (30 seconds)       │
        │  Same flow as initial setup            │
        └────────────────────────────────────────┘
                              │
                              ▼
        ┌────────────────────────────────────────┐
        │  Get New 90-Day Refresh Token          │
        │  Cycle repeats for another 90 days     │
        └────────────────────────────────────────┘
```

## 📈 Timeline View

```
Day 0: Initial Authorization
│
├─ 09:00:00 → User clicks login
│  └─ Signs in (30 seconds)
│     └─ Backend gets tokens
│        └─ Saves to DB
│
├─ 09:00:01 → First API call
│  └─ Token valid (59 min remaining)
│     └─ Proceeds immediately
│
├─ 09:55:00 → Token expiring soon (5 min buffer)
│  └─ Auto-refresh triggered
│     └─ New token obtained (500ms)
│        └─ Database updated
│           └─ API call proceeds
│
├─ 10:55:00 → Another auto-refresh
│  └─ Seamless, no interruption
│
├─ 11:55:00 → Another auto-refresh
│  └─ Continues working...
│
├─ ... (repeat every hour) ...
│
├─ Day 30: Still working perfectly
│  └─ Zero manual intervention
│
├─ Day 60: Still working perfectly
│  └─ Zero manual intervention
│
├─ Day 89: Still working perfectly
│  └─ Zero manual intervention
│
└─ Day 90: Refresh token expires
   │
   ├─ Next refresh attempt fails
   │  └─ Error detected
   │     └─ User notified
   │        └─ Re-authorize (30 seconds)
   │           └─ New 90-day cycle begins
```

## 🎯 Key Metrics

```
Manual Effort Required:
├─ Initial Setup: 30 seconds (one-time)
├─ Auto-Refresh: 0 seconds (automatic)
├─ Re-authorization: 30 seconds (every 90 days)
│
└─ Total Manual Time per Year: ~4 minutes
   └─ For 8,760 hours of operation
      └─ 99.99% hands-free operation!
```

## 🔍 What Happens Behind the Scenes

### Database Operations

```javascript
// Every successful refresh updates:
{
  _id: ObjectId("..."),
  accountEmail: "user@outlook.com",
  accessToken: "eyJ0eXAiOiJKV1QiLCJhbGc...",  // Updated
  refreshToken: "M.R3_BAY.CdG7...",        // Maybe updated
  expiresAt: ISODate("2024-03-09T15:05:00Z"), // Updated
  updatedAt: ISODate("2024-03-09T14:05:00Z")  // Updated
}
```

### Log Messages

**Normal Operation:**
```
🔄 Access token expired for user@outlook.com. 
   Expired at: 2024-03-09T14:00:00.000Z, 
   Now: 2024-03-09T14:05:00.000Z. 
   Attempting automatic refresh with refresh token...

✅ Token refreshed successfully for user@outlook.com. 
   New expiry: 2024-03-09T15:05:00.000Z 
   (valid for ~59 minutes)
```

**Needs Attention:**
```
❌ Error refreshing Outlook token: invalid_grant
   Error Code: invalid_grant
   Status Code: 401

❌ Refresh token for user@outlook.com has expired or been revoked.
   This happens after 90 days of inactivity or if user revoked access.
   User MUST re-authorize.
```

## 🎉 Summary

```
┌────────────────────────────────────────────┐
│  AUTHORIZE ONCE → WORKS FOR 90 DAYS → DONE │
└────────────────────────────────────────────┘

That's the beauty of automatic token refresh! ✨
```
