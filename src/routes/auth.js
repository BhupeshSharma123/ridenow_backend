const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { generateToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { sendOtpEmail, sendResetPasswordEmail } = require('../utils/email');

const router = express.Router();

// Google Sign In
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'ID Token required' });

    // Verify Google ID Token
    // Note: In real production, you MUST provide GOOGLE_CLIENT_ID as an env variable.
    // For now, we allow verification if client ID is set, or we mock it for development.
    let payload;
    if (process.env.GOOGLE_CLIENT_ID && idToken.includes('.')) {
      try {
        const ticket = await client.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (e) {
        console.error('Real Google token verification failed:', e);
        return res.status(401).json({ error: 'Invalid Google token' });
      }
    } else {
      // MOCK verification for development environment
      console.warn('Using MOCK Google verification.');
      try {
        if (idToken && idToken.includes('.')) {
          payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
        } else {
          // Absolute fallback for completely mock tokens
          payload = {
            email: 'demo-user@google.com',
            name: 'Demo Google User',
            picture: 'https://via.placeholder.com/150',
            sub: 'mock-google-id-' + Date.now()
          };
        }
      } catch (e) {
        payload = {
          email: 'demo-user@google.com',
          name: 'Demo Google User',
          picture: 'https://via.placeholder.com/150',
          sub: 'mock-google-id-' + Date.now()
        };
      }
    }

    const { email, name, picture, sub: googleId } = payload;

    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      // Create new user for Google login
      // We set a random password as Google users won't use traditional password login normally
      const randomPassword = crypto.randomBytes(16).toString('hex');
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(randomPassword, salt);

      const result = db.prepare(
        'INSERT INTO users (name, email, password_hash, avatar_url, is_verified) VALUES (?, ?, ?, ?, ?)'
      ).run(name, email, passwordHash, picture, 1); // Google users are pre-verified

      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      
      const userId = Number(result.lastInsertRowid);

      // Create default resources
      db.prepare('INSERT INTO payment_methods (user_id, type, label, is_default) VALUES (?, ?, ?, ?)').run(userId, 'wallet', 'RIDENOW Wallet', 1);
      db.prepare('INSERT INTO saved_locations (user_id, name, label, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)').run(userId, 'Home', 'home', 'Set your home address', 0, 0);
      db.prepare('INSERT INTO saved_locations (user_id, name, label, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)').run(userId, 'Work', 'work', 'Set your work address', 0, 0);
    } else {
      // If user exists but not verified, mark as verified if logging with Google
      if (!user.is_verified) {
        db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(user.id);
        user.is_verified = 1;
      }
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        rating: user.rating,
        is_verified: true,
        avatar_url: picture || user.avatar_url,
      }
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Google authentication failed' });
  }
});

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    // Check if user exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user (without OTP initially)
    const result = db.prepare(
      'INSERT INTO users (name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, ?)'
    ).run(name, email, phone || '', passwordHash, 0);

    const userId = Number(result.lastInsertRowid);
    const token = generateToken(userId);

    // Create default payment methods
    db.prepare(
      'INSERT INTO payment_methods (user_id, type, label, is_default) VALUES (?, ?, ?, ?)'
    ).run(userId, 'wallet', 'RIDENOW Wallet', 1);

    // Create default saved locations
    db.prepare(
      'INSERT INTO saved_locations (user_id, name, label, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, 'Home', 'home', 'Set your home address', 0, 0);

    db.prepare(
      'INSERT INTO saved_locations (user_id, name, label, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userId, 'Work', 'work', 'Set your work address', 0, 0);

    res.status(201).json({
      success: true,
      token,
      user: { id: userId, name, email, phone: phone || '', is_verified: false },
      message: 'Registration successful. Please verify your email with OTP.'
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Send OTP
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Save OTP to database
    db.prepare('UPDATE users SET otp_code = ?, otp_expiry = ? WHERE id = ?')
      .run(otp, expiry, user.id);

    // Send OTP email
    await sendOtpEmail(email, otp);

    console.log(`OTP for ${email}: ${otp}`); // For development/testing

    res.json({ 
      success: true,
      message: 'OTP sent to your email' 
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: 'Server error sending OTP' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.is_verified) {
      return res.status(400).json({ error: 'Email already verified' });
    }

    // Check if OTP exists and is not expired
    if (!user.otp_code || !user.otp_expiry) {
      return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
    }

    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    // Verify OTP
    if (user.otp_code !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark user as verified and clear OTP
    db.prepare('UPDATE users SET is_verified = 1, otp_code = NULL, otp_expiry = NULL WHERE id = ?')
      .run(user.id);

    res.json({ 
      success: true,
      message: 'Email verified successfully' 
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Server error verifying OTP' });
  }
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'No account with that email' });

    const resetToken = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
    const expiry = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    db.prepare('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?')
      .run(resetToken, expiry, user.id);

    await sendResetPasswordEmail(email, resetToken);
    res.json({ message: 'Password reset code sent to email' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND reset_token = ?').get(email, token);

    if (!user || new Date(user.reset_token_expiry) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?')
      .run(passwordHash, user.id);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user.id);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        rating: user.rating,
        is_verified: !!user.is_verified,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

module.exports = router;
