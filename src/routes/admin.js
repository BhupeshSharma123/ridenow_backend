const express = require('express');
const db = require('../database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Admin authentication middleware
const authenticateAdmin = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin role required.' });
    }
    req.adminId = decoded.id;
    next();
  } catch (err) {
    res.status(400).json({ error: 'Invalid token.' });
  }
};

// Admin login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // For demo purposes, create default admin if doesn't exist
    let admin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
    
    if (!admin && email === 'admin@ridenow.com') {
      const hashedPassword = await bcrypt.hash(password || 'admin123', 10);
      const result = db.prepare(`
        INSERT INTO admins (email, password_hash, name, role, created_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(email, hashedPassword, 'Super Admin', 'admin');
      
      admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(result.lastInsertRowid);
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin' },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Dashboard stats
router.get('/dashboard', authenticateAdmin, (req, res) => {
  try {
    // Total users
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    // Total drivers
    const totalDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers').get();
    
    // Active drivers (online)
    const activeDrivers = db.prepare('SELECT COUNT(*) as count FROM drivers WHERE is_online = 1').get();
    
    // Total rides
    const totalRides = db.prepare('SELECT COUNT(*) as count FROM rides').get();
    
    // Today's rides
    const todayRides = db.prepare(`
      SELECT COUNT(*) as count FROM rides 
      WHERE DATE(created_at) = DATE('now')
    `).get();
    
    // Revenue (total fare from completed rides)
    const revenue = db.prepare(`
      SELECT COALESCE(SUM(fare), 0) as total FROM rides 
      WHERE status = 'completed'
    `).get();
    
    // Today's revenue
    const todayRevenue = db.prepare(`
      SELECT COALESCE(SUM(fare), 0) as total FROM rides 
      WHERE status = 'completed' AND DATE(created_at) = DATE('now')
    `).get();

    // Pending driver approvals
    const pendingDrivers = db.prepare(`
      SELECT COUNT(*) as count FROM drivers WHERE status = 'pending'
    `).get();

    // Recent rides
    const recentRides = db.prepare(`
      SELECT r.*, u.name as passenger_name, d.user_id as driver_user_id,
             du.name as driver_name
      FROM rides r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      stats: {
        totalUsers: totalUsers.count,
        totalDrivers: totalDrivers.count,
        activeDrivers: activeDrivers.count,
        totalRides: totalRides.count,
        todayRides: todayRides.count,
        revenue: revenue.total,
        todayRevenue: todayRevenue.total,
        pendingDrivers: pendingDrivers.count
      },
      recentRides
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users with pagination
router.get('/users', authenticateAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search;

    let query = 'SELECT id, name, email, phone, rating, is_verified, created_at FROM users';
    let countQuery = 'SELECT COUNT(*) as count FROM users';
    let params = [];

    if (search) {
      query += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      countQuery += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const searchParam = `%${search}%`;
      params = [searchParam, searchParam, searchParam];
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const users = db.prepare(query).all(...params);
    const total = db.prepare(countQuery).get(...(search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []));

    res.json({
      success: true,
      users,
      pagination: {
        total: total.count,
        page,
        limit,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', authenticateAdmin, (req, res) => {
  try {
    const userId = req.params.id;

    // Check if user exists
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete user's rides
    db.prepare('DELETE FROM rides WHERE user_id = ?').run(userId);
    
    // Delete user's saved locations
    db.prepare('DELETE FROM saved_locations WHERE user_id = ?').run(userId);
    
    // Delete user's recent locations
    db.prepare('DELETE FROM recent_locations WHERE user_id = ?').run(userId);
    
    // Delete user's payment methods
    db.prepare('DELETE FROM payment_methods WHERE user_id = ?').run(userId);

    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all drivers with pagination
router.get('/drivers', authenticateAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;

    let query = `
      SELECT d.*, u.name, u.email, u.phone, u.rating,
             v.type as vehicle_type, v.model as vehicle_model, 
             v.number as vehicle_plate, v.color as vehicle_color, v.year as vehicle_year,
             d.is_online as is_available
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vehicles v ON d.id = v.driver_id
    `;
    let countQuery = `
      SELECT COUNT(*) as count FROM drivers d
      JOIN users u ON d.user_id = u.id
    `;
    let params = [];
    let conditions = [];

    if (status) {
      conditions.push('d.status = ?');
      params.push(status);
    }

    if (search) {
      conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const drivers = db.prepare(query).all(...params);
    const total = db.prepare(countQuery).get(...params.slice(0, -2));

    res.json({
      success: true,
      drivers,
      pagination: {
        total: total.count,
        page,
        limit,
        pages: Math.ceil(total.count / limit)
      }
    });
  } catch (err) {
    console.error('Get drivers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve/Reject driver
router.put('/drivers/:id/status', authenticateAdmin, (req, res) => {
  try {
    const { status, rejection_reason } = req.body;
    const driverId = req.params.id;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    db.prepare(`
      UPDATE drivers 
      SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, rejection_reason || null, driverId);

    // Get driver info for notification
    const driver = db.prepare(`
      SELECT d.*, u.name, u.email FROM drivers d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `).get(driverId);

    if (driver) {
      // Here you could send email notification to driver
      console.log(`Driver ${driver.name} (${driver.email}) has been ${status}`);
    }

    res.json({
      success: true,
      message: `Driver ${status} successfully`
    });
  } catch (err) {
    console.error('Update driver status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete driver
router.delete('/drivers/:id', authenticateAdmin, (req, res) => {
  try {
    const driverId = req.params.id;

    // Check if driver exists
    const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Delete driver's rides
    db.prepare('DELETE FROM rides WHERE driver_id = ?').run(driverId);
    
    // Delete driver's earnings
    db.prepare('DELETE FROM earnings WHERE driver_id = ?').run(driverId);
    
    // Delete driver's incentives
    db.prepare('DELETE FROM incentives WHERE driver_id = ?').run(driverId);
    
    // Delete driver's documents
    db.prepare('DELETE FROM driver_documents WHERE driver_id = ?').run(driverId);
    
    // Delete driver's bank details
    db.prepare('DELETE FROM driver_bank_details WHERE driver_id = ?').run(driverId);
    
    // Delete driver's vehicle
    db.prepare('DELETE FROM vehicles WHERE driver_id = ?').run(driverId);

    // Delete the driver
    db.prepare('DELETE FROM drivers WHERE id = ?').run(driverId);

    res.json({
      success: true,
      message: 'Driver deleted successfully'
    });
  } catch (err) {
    console.error('Delete driver error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all rides with pagination and filters
router.get('/rides', authenticateAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;
    const dateFrom = req.query.dateFrom;
    const dateTo = req.query.dateTo;

    let query = `
      SELECT r.*, u.name as passenger_name, u.phone as passenger_phone,
             du.name as driver_name
      FROM rides r
      LEFT JOIN users u ON r.user_id = u.id
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN users du ON d.user_id = du.id
    `;
    let countQuery = 'SELECT COUNT(*) as count FROM rides r';
    let params = [];
    let conditions = [];

    if (status) {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (search) {
      countQuery += ' LEFT JOIN users u ON r.user_id = u.id LEFT JOIN drivers d ON r.driver_id = d.id LEFT JOIN users du ON d.user_id = du.id';
      conditions.push('(u.name LIKE ? OR du.name LIKE ?)');
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam);
    }

    if (dateFrom) {
      conditions.push('DATE(r.created_at) >= ?');
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push('DATE(r.created_at) <= ?');
      params.push(dateTo);
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      countQuery += whereClause;
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rides = db.prepare(query).all(...params);
    const total = db.prepare(countQuery).get(...params.slice(0, -2));

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
    console.error('Get rides error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get analytics
router.get('/analytics', authenticateAdmin, (req, res) => {
  try {
    const range = req.query.range || '7days';
    let days = 7;
    if (range === '30days') days = 30;
    if (range === '90days') days = 90;

    // Daily ride counts
    const dailyRides = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as rides
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    // Revenue by day
    const revenueData = db.prepare(`
      SELECT DATE(created_at) as date, COALESCE(SUM(fare), 0) as revenue
      FROM rides
      WHERE status = 'completed' AND created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    // Ride status distribution
    const statusDistribution = db.prepare(`
      SELECT status as name, COUNT(*) as value
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY status
    `).all();

    // Top routes
    const topRoutes = db.prepare(`
      SELECT pickup_address as pickup, dest_address as destination, COUNT(*) as count
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY pickup_address, dest_address
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // Summary stats
    const totalRides = db.prepare(`
      SELECT COUNT(*) as count FROM rides 
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(fare), 0) as revenue FROM rides 
      WHERE status = 'completed' AND created_at >= datetime('now', '-${days} days')
    `).get();

    const activeUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count FROM rides 
      WHERE created_at >= datetime('now', '-${days} days')
    `).get();

    const avgFare = totalRides.count > 0 
      ? (totalRevenue.revenue / totalRides.count).toFixed(2) 
      : '0.00';

    res.json({
      success: true,
      dailyRides,
      revenueData,
      statusDistribution,
      topRoutes,
      totalRides: totalRides.count,
      totalRevenue: totalRevenue.revenue.toFixed(2),
      activeUsers: activeUsers.count,
      avgFare
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get driver documents for approval
router.get('/drivers/:id/documents', authenticateAdmin, (req, res) => {
  try {
    const driverId = req.params.id;
    
    const documents = db.prepare(`
      SELECT * FROM driver_documents WHERE driver_id = ?
    `).all(driverId);

    const driver = db.prepare(`
      SELECT d.*, u.name, u.email FROM drivers d
      JOIN users u ON d.user_id = u.id
      WHERE d.id = ?
    `).get(driverId);

    res.json({
      success: true,
      driver,
      documents
    });
  } catch (err) {
    console.error('Get driver documents error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Approve/Reject driver document
router.put('/documents/:id/status', authenticateAdmin, (req, res) => {
  try {
    const { status, notes } = req.body;
    const documentId = req.params.id;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    db.prepare(`
      UPDATE driver_documents 
      SET status = ?, admin_notes = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, notes || null, documentId);

    res.json({
      success: true,
      message: `Document ${status} successfully`
    });
  } catch (err) {
    console.error('Update document status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get system settings
router.get('/settings', authenticateAdmin, (req, res) => {
  try {
    const settingsRows = db.prepare('SELECT key, value FROM system_settings').all();
    
    const settings = {
      base_fare: 35,
      per_km_rate: 15,
      per_minute_rate: 2,
      minimum_fare: 50,
      cancellation_fee: 50,
      commission_rate: 20
    };

    // Override with database values if they exist
    settingsRows.forEach(row => {
      settings[row.key] = parseFloat(row.value);
    });

    res.json({
      success: true,
      settings
    });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update system settings
router.put('/settings', authenticateAdmin, (req, res) => {
  try {
    const settings = req.body;
    
    // Save each setting to database
    const stmt = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);

    for (const [key, value] of Object.entries(settings)) {
      stmt.run(key, value.toString(), value.toString());
    }
    
    res.json({
      success: true,
      message: 'Settings updated successfully'
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;