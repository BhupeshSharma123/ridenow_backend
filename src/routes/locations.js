const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get saved locations
router.get('/saved', authenticateToken, (req, res) => {
  try {
    const locations = db.prepare(
      'SELECT * FROM saved_locations WHERE user_id = ? ORDER BY created_at ASC'
    ).all(req.userId);

    res.json({ locations });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add saved location
router.post('/saved', authenticateToken, (req, res) => {
  try {
    const { name, label, address, lat, lng } = req.body;

    if (!name || !address) {
      return res.status(400).json({ error: 'Name and address are required' });
    }

    const result = db.prepare(
      'INSERT INTO saved_locations (user_id, name, label, address, lat, lng) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, name, label || 'other', address, lat || 0, lng || 0);

    const location = db.prepare('SELECT * FROM saved_locations WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ location });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update saved location
router.put('/saved/:id', authenticateToken, (req, res) => {
  try {
    const { name, label, address, lat, lng } = req.body;

    db.prepare(`
      UPDATE saved_locations SET 
        name = COALESCE(?, name),
        label = COALESCE(?, label),
        address = COALESCE(?, address),
        lat = COALESCE(?, lat),
        lng = COALESCE(?, lng)
      WHERE id = ? AND user_id = ?
    `).run(name, label, address, lat, lng, req.params.id, req.userId);

    const location = db.prepare('SELECT * FROM saved_locations WHERE id = ?')
      .get(req.params.id);

    res.json({ location });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete saved location
router.delete('/saved/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM saved_locations WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId);
    res.json({ message: 'Location deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get recent locations
router.get('/recent', authenticateToken, (req, res) => {
  try {
    const locations = db.prepare(
      'SELECT * FROM recent_locations WHERE user_id = ? ORDER BY visited_at DESC LIMIT 10'
    ).all(req.userId);

    res.json({ locations });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add recent location
router.post('/recent', authenticateToken, (req, res) => {
  try {
    const { name, address, lat, lng } = req.body;

    db.prepare(
      'INSERT INTO recent_locations (user_id, name, address, lat, lng) VALUES (?, ?, ?, ?, ?)'
    ).run(req.userId, name, address, lat || 0, lng || 0);

    res.status(201).json({ message: 'Added to recents' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
