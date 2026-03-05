# OTP System Setup Guide

## Overview

The email verification system has been upgraded from link-based verification to OTP (One-Time Password) verification for better security and user experience.

## What Changed?

### Old System (Link-based)
- User registers → Verification link sent to email
- User clicks link → Email verified
- Required web browser access

### New System (OTP-based)
- User registers → 6-digit OTP sent to email
- User enters OTP in app → Email verified
- Works entirely within the app

## Setup Instructions

### Option 1: Fresh Installation

If you're starting fresh or want to recreate the database:

```bash
# Delete old database
rm ridenow.db ridenow.db-shm ridenow.db-wal

# Start server (will create new database with OTP support)
npm start
```

### Option 2: Migrate Existing Database

If you have existing users and want to keep them:

```bash
# Run migration script
node migrate_to_otp.js

# Start server
npm start
```

## Testing the OTP System

### Development Mode (No Email Service)

By default, if you don't configure email credentials, OTPs will be logged to the console:

1. Start the server:
   ```bash
   npm start
   ```

2. Register a new user from the app

3. Check your terminal - you'll see:
   ```
   --- EMAIL SIMULATION ---
   To: user@example.com
   Subject: Your RIDENOW Verification Code
   Content: [HTML with OTP]
   ------------------------
   OTP for user@example.com: 123456
   ```

4. Use the OTP shown in the console to verify

### Production Mode (With Email Service)

Configure your `.env` file with real email credentials:

```env
# Gmail Example
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# SendGrid Example
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_USER=apikey
EMAIL_PASS=your-sendgrid-api-key

# App URL
APP_URL=https://your-backend-url.com
```

**Note for Gmail**: You need to use an "App Password", not your regular password:
1. Enable 2-Factor Authentication on your Google account
2. Go to Google Account → Security → App Passwords
3. Generate a new app password for "Mail"
4. Use that password in EMAIL_PASS

## API Endpoints

### Send OTP
```http
POST /api/auth/send-otp
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "OTP sent to your email"
}
```

### Verify OTP
```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "email": "user@example.com",
  "otp": "123456"
}
```

**Success Response:**
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

**Error Response:**
```json
{
  "error": "Invalid OTP"
}
```

## Database Schema Changes

The `users` table now includes:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  rating REAL DEFAULT 5.0,
  is_verified INTEGER DEFAULT 0,        -- NEW
  otp_code TEXT,                        -- NEW
  otp_expiry DATETIME,                  -- NEW
  reset_token TEXT,                     -- NEW
  reset_token_expiry DATETIME,          -- NEW
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Security Features

1. **Time-Limited OTPs**: Each OTP expires after 10 minutes
2. **One-Time Use**: OTP is cleared after successful verification
3. **Secure Generation**: Uses cryptographically secure random numbers
4. **No Reuse**: Old OTPs cannot be reused after expiration

## Troubleshooting

### Problem: "User not found" error
**Solution**: Make sure the user is registered before sending OTP

### Problem: "OTP expired" error
**Solution**: OTPs are valid for 10 minutes only. Request a new one.

### Problem: "Invalid OTP" error
**Solution**: 
- Check for typos in the OTP
- Make sure you're using the latest OTP (if you requested multiple)
- OTP is case-sensitive (though we only use numbers)

### Problem: Not receiving OTP emails
**Solution**:
- In development: Check console logs for the OTP
- In production: 
  - Verify EMAIL_* environment variables are set correctly
  - Check spam/junk folder
  - Verify email service credentials are valid

### Problem: Migration script fails
**Solution**: 
- If it says "column already exists", you're already migrated!
- If other errors, try the fresh installation method instead

## Testing Checklist

- [ ] Register new user
- [ ] Receive OTP (console or email)
- [ ] Verify with correct OTP
- [ ] Try expired OTP (wait 10+ minutes)
- [ ] Try invalid OTP
- [ ] Resend OTP functionality
- [ ] Login with unverified account
- [ ] Login with verified account

## Support

If you encounter issues:
1. Check the console logs for detailed error messages
2. Verify your database has the new OTP fields
3. Test with console logging first before configuring email
4. Make sure both frontend and backend are updated

## Next Steps

After setup:
1. Test the OTP flow thoroughly
2. Configure production email service
3. Consider adding rate limiting to prevent OTP spam
4. Monitor OTP delivery success rates
5. Set up email templates for better branding
