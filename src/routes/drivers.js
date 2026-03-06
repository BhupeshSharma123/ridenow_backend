const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ storage });

const router = express.Router();

// Get driver role status
router.get('/status', authenticateToken, (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) {
      return res.json({ registered: false });
    }
    
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE driver_id = ?').get(driver.id);
    const bank = db.prepare('SELECT * FROM driver_bank_details WHERE driver_id = ?').get(driver.id);
    const docs = db.prepare('SELECT * FROM driver_documents WHERE driver_id = ?').all(driver.id);

    res.json({
      registered: true,
      status: driver.status,
      driverId: driver.id,
      rejectionReason: driver.rejection_reason,
      hasVehicle: !!vehicle,
      hasBank: !!bank,
      documentsCount: docs.length
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Register as driver
router.post('/register', authenticateToken, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    if (existing) {
      return res.status(400).json({ error: 'Already registered as driver' });
    }

    const result = db.prepare(
      'INSERT INTO drivers (user_id, status) VALUES (?, ?)'
    ).run(req.userId, 'approved');

    res.status(201).json({ id: Number(result.lastInsertRowid), status: 'approved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update vehicle details
router.post('/vehicle', authenticateToken, (req, res) => {
  try {
    const { type, model, number, year, color } = req.body;
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    db.prepare(`
      INSERT OR REPLACE INTO vehicles (driver_id, type, model, number, year, color)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(driver.id, type, model, number, year, color);

    res.json({ message: 'Vehicle details saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update bank details
router.post('/bank', authenticateToken, (req, res) => {
  try {
    const { account_name, bank_name, account_number, ifsc, upi_id } = req.body;
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    db.prepare(`
      INSERT OR REPLACE INTO driver_bank_details (driver_id, account_name, bank_name, account_number, ifsc, upi_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(driver.id, account_name, bank_name, account_number, ifsc, upi_id);

    res.json({ message: 'Bank details saved' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Upload document
router.post('/documents', authenticateToken, upload.single('file'), (req, res) => {
  try {
    const { type } = req.body;
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    db.prepare(`
      INSERT INTO driver_documents (driver_id, type, file_path, status)
      VALUES (?, ?, ?, ?)
    `).run(driver.id, type, req.file.path.replace(/\\/g, '/'), 'pending');

    res.json({ message: 'Document uploaded', path: req.file.path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Toggle Online Status
router.put('/online', authenticateToken, (req, res) => {
  try {
    const { is_online, lat, lng } = req.body;
    const driver = db.prepare('SELECT id, status FROM drivers WHERE user_id = ?').get(req.userId);
    
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    if (driver.status !== 'approved') return res.status(403).json({ error: 'Driver not approved yet' });

    db.prepare('UPDATE drivers SET is_online = ?, current_lat = ?, current_lng = ? WHERE id = ?')
      .run(is_online ? 1 : 0, lat || null, lng || null, driver.id);

    res.json({ is_online: !!is_online });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Driver Dashboard
router.get('/dashboard', authenticateToken, (req, res) => {
  try {
    const driver = db.prepare('SELECT * FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const todayStart = new Date();
    todayStart.setHours(0,0,0,0);
    const isoToday = todayStart.toISOString();

    const stats = db.prepare(`
      SELECT 
        SUM(CASE WHEN created_at >= ? THEN amount ELSE 0 END) as today_earnings,
        COUNT(CASE WHEN created_at >= ? AND type = 'ride' THEN 1 END) as today_rides
      FROM earnings 
      WHERE driver_id = ?
    `).get(isoToday, isoToday, driver.id);

    const totalEarnings = db.prepare('SELECT SUM(amount) as total FROM earnings WHERE driver_id = ?').get(driver.id);

    res.json({
      status: driver.status,
      isOnline: !!driver.is_online,
      rating: driver.total_rating,
      todayEarnings: stats.today_earnings || 0,
      todayRides: stats.today_rides || 0,
      totalEarnings: totalEarnings.total || 0,
      walletBalance: totalEarnings.total || 0 // Mock balance same as earnings for now
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Earnings History
router.get('/earnings', authenticateToken, (req, res) => {
  try {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    const history = db.prepare(`
      SELECT * FROM earnings WHERE driver_id = ? ORDER BY created_at DESC
    `).all(driver.id);

    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get Incentives
router.get('/incentives', authenticateToken, (req, res) => {
  try {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });

    // Seed mock incentives if none exist
    const count = db.prepare('SELECT COUNT(*) as count FROM incentives WHERE driver_id = ?').get(driver.id);
    if (count.count === 0) {
      db.prepare(`
        INSERT INTO incentives (driver_id, title, description, target, progress, reward)
        VALUES 
        (?, 'Daily Quest', 'Complete 10 rides today', 10, 3, 500),
        (?, 'Weekly Goal', 'Earn ₹5000 this week', 5000, 1200, 1000)
      `).run(driver.id, driver.id);
    }

    const list = db.prepare('SELECT * FROM incentives WHERE driver_id = ?').all(driver.id);
    res.json({ incentives: list });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update driver location (for real-time tracking)
router.put('/location', authenticateToken, (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    db.prepare(`
      UPDATE drivers 
      SET current_lat = ?, current_lng = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(lat, lng, driver.id);

    // Broadcast location to active rides
    const activeRide = db.prepare(`
      SELECT id, user_id FROM rides 
      WHERE driver_id = ? AND status IN ('confirmed', 'in_progress')
    `).get(driver.id);

    if (activeRide) {
      const io = req.app.get('io');
      const activeUsers = req.app.get('activeUsers');
      const passengerSocketId = activeUsers.get(activeRide.user_id);
      
      if (passengerSocketId) {
        io.to(passengerSocketId).emit('driver_location_update', {
          ride_id: activeRide.id,
          location: { lat, lng }
        });
      }
    }

    res.json({ success: true, message: 'Location updated' });
  } catch (err) {
    console.error('Update location error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get driver's ride history
router.get('/rides', authenticateToken, (req, res) => {
  try {
    const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(req.userId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status;

    let query = `
      SELECT r.*, u.name as passenger_name, u.phone as passenger_phone
      FROM rides r
      JOIN users u ON r.user_id = u.id
      WHERE r.driver_id = ?
    `;
    let params = [driver.id];

    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rides = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as count FROM rides WHERE driver_id = ?';
    let countParams = [driver.id];

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    const total = db.prepare(countQuery).get(...countParams);

    res.json({
      success: true,
      rides,
      pagination: {
        total: total.count,
        page,
        limit,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (err) {
    console.error('Driver rides error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
