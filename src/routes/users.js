const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get user profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const user = db.prepare(
      'SELECT id, name, email, phone, avatar_url, rating, created_at FROM users WHERE id = ?'
    ).get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get ride stats
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_rides,
        COALESCE(SUM(fare), 0) as total_spent,
        COALESCE(SUM(distance_km), 0) as total_distance
      FROM rides WHERE user_id = ? AND status = 'completed'
    `).get(req.userId);

    res.json({ user, stats });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user profile
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const { name, phone, avatar_url } = req.body;

    db.prepare(
      'UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), avatar_url = COALESCE(?, avatar_url) WHERE id = ?'
    ).run(name, phone, avatar_url, req.userId);

    const user = db.prepare(
      'SELECT id, name, email, phone, avatar_url, rating FROM users WHERE id = ?'
    ).get(req.userId);

    res.json({ user });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
