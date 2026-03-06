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
             v.type as vehicle_type, v.model, v.number as plate
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

    if (!['approved', 'rejected'].includes(status)) {
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

// Get all rides with pagination and filters
router.get('/rides', authenticateAdmin, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

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

    if (startDate) {
      conditions.push('DATE(r.created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('DATE(r.created_at) <= ?');
      params.push(endDate);
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

// Get ride analytics
router.get('/analytics/rides', authenticateAdmin, (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;

    // Daily ride counts for the last N days
    const dailyRides = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    // Ride status distribution
    const statusDistribution = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY status
    `).all();

    // Revenue by day
    const dailyRevenue = db.prepare(`
      SELECT DATE(created_at) as date, COALESCE(SUM(fare), 0) as revenue
      FROM rides
      WHERE status = 'completed' AND created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    // Top routes
    const topRoutes = db.prepare(`
      SELECT pickup_address, dest_address, COUNT(*) as count
      FROM rides
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY pickup_address, dest_address
      ORDER BY count DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      analytics: {
        dailyRides,
        statusDistribution,
        dailyRevenue,
        topRoutes
      }
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

// System settings
router.get('/settings', authenticateAdmin, (req, res) => {
  try {
    // Mock settings - in real app, these would be in a settings table
    const settings = {
      app_name: 'RIDENOW',
      commission_rate: 20, // 20%
      base_fare: 35,
      per_km_rate: 15,
      per_minute_rate: 2,
      surge_multiplier: 1.5,
      max_search_radius: 10, // km
      ride_timeout: 300, // 5 minutes
      cancellation_fee: 50,
      driver_approval_required: true,
      email_notifications: true,
      sms_notifications: false
    };

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
    
    // In a real app, you'd save these to a settings table
    // For now, just return success
    
    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;