const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get payment methods
router.get('/', authenticateToken, (req, res) => {
  try {
    const methods = db.prepare(
      'SELECT * FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC, created_at ASC'
    ).all(req.userId);

    res.json({ methods });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add payment method
router.post('/', authenticateToken, (req, res) => {
  try {
    const { type, label, last_four, is_default } = req.body;

    if (!type || !label) {
      return res.status(400).json({ error: 'Type and label are required' });
    }

    // If setting as default, unset others
    if (is_default) {
      db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?')
        .run(req.userId);
    }

    const result = db.prepare(
      'INSERT INTO payment_methods (user_id, type, label, last_four, is_default) VALUES (?, ?, ?, ?, ?)'
    ).run(req.userId, type, label, last_four || null, is_default ? 1 : 0);

    const method = db.prepare('SELECT * FROM payment_methods WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json({ method });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Set default payment method
router.put('/:id/default', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?')
      .run(req.userId);
    db.prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId);

    res.json({ message: 'Default payment updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete payment method
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.userId);
    res.json({ message: 'Payment method deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
