const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database');
const { generateToken } = require('../middleware/auth');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { sendVerificationEmail, sendResetPasswordEmail } = require('../utils/email');

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

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Insert user
    const result = db.prepare(
      'INSERT INTO users (name, email, phone, password_hash, verification_token, is_verified) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, email, phone || '', passwordHash, verificationToken, 0);

    const userId = Number(result.lastInsertRowid);
    const token = generateToken(userId);

    // Send verification email
    await sendVerificationEmail(email, verificationToken);

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
      token,
      user: { id: userId, name, email, phone: phone || '', is_verified: false },
      message: 'Registration successful. Please verify your email.'
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Resend Verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_verified) return res.status(400).json({ error: 'User already verified' });

    const verificationToken = user.verification_token || crypto.randomBytes(32).toString('hex');
    if (!user.verification_token) {
      db.prepare('UPDATE users SET verification_token = ? WHERE id = ?').run(verificationToken, user.id);
    }

    await sendVerificationEmail(email, verificationToken);
    res.json({ message: 'Verification email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify Email
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);

    if (!user) {
      return res.status(400).send('<h1>Invalid or expired verification token</h1>');
    }

    db.prepare('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);

    res.send('<h1>Email Verified!</h1><p>You can now log in to the app.</p>');
  } catch (err) {
    res.status(500).send('<h1>Server error</h1>');
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
