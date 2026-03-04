const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

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

    // Insert user
    const result = db.prepare(
      'INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)'
    ).run(name, email, phone || '', passwordHash);

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
      token,
      user: { id: Number(userId), name, email, phone: phone || '' },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
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
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

module.exports = router;
