const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Simulated driver data
const DRIVERS = [
  { name: 'Alex Johnson', rating: 4.9, phone: '+1-555-0101', model: 'Tesla Model 3', plate: 'ABC 1234' },
  { name: 'Sarah Williams', rating: 4.8, phone: '+1-555-0102', model: 'BMW 5 Series', plate: 'XYZ 5678' },
  { name: 'Michael Chen', rating: 4.7, phone: '+1-555-0103', model: 'Mercedes E-Class', plate: 'DEF 9012' },
  { name: 'Emily Davis', rating: 4.9, phone: '+1-555-0104', model: 'Audi A6', plate: 'GHI 3456' },
  { name: 'James Wilson', rating: 4.6, phone: '+1-555-0105', model: 'Toyota Camry', plate: 'JKL 7890' },
];

// Request a ride
router.post('/request', authenticateToken, (req, res) => {
  try {
    const {
      pickup_address, pickup_lat, pickup_lng,
      dest_address, dest_lat, dest_lng,
      vehicle_type,
    } = req.body;

    if (!pickup_address || !dest_address) {
      return res.status(400).json({ error: 'Pickup and destination are required' });
    }

    const io = req.app.get('io');
    const activeDriversMap = req.app.get('activeDrivers');

    // 1. Find the closest online & approved driver (within 5km)
    const availableDrivers = db.prepare(`
      SELECT d.*, v.model, v.number as plate, u.name, u.phone, u.rating as user_rating
      FROM drivers d
      JOIN vehicles v ON d.id = v.driver_id
      JOIN users u ON d.user_id = u.id
      WHERE d.is_online = 1 AND d.status = 'approved' AND v.type = ?
    `).all(vehicle_type || 'car');

    let assignedDriver = null;
    let minDistance = 5.1; // 5km limit

    for (const d of availableDrivers) {
      const dist = calculateDistance(pickup_lat, pickup_lng, d.current_lat, d.current_lng);
      if (dist < minDistance) {
        minDistance = dist;
        assignedDriver = d;
      }
    }

    if (!assignedDriver) {
      return res.status(404).json({ error: 'No drivers available in your area' });
    }

    // 2. Calculate trip stats
    const tripDist = calculateDistance(pickup_lat, pickup_lng, dest_lat, dest_lng);
    const duration = Math.round(tripDist * 3);
    const multipliers = { bike: 0.5, auto: 0.7, car: 1.0, suv: 1.5 };
    const multiplier = multipliers[assignedDriver.type] || 1.0;
    const fare = parseFloat(((20 + tripDist * 12 + duration * 2) * multiplier).toFixed(2));

    // 3. Create Ride Record
    const result = db.prepare(`
      INSERT INTO rides (user_id, pickup_address, pickup_lat, pickup_lng, dest_address, dest_lat, dest_lng,
        status, vehicle_type, fare, distance_km, duration_mins, driver_id, driver_name, driver_rating, driver_phone,
      vehicle_model, vehicle_plate)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'searching', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.userId, pickup_address, pickup_lat, pickup_lng,
    dest_address, dest_lat, dest_lng,
    vehicle_type || 'car', fare, parseFloat(tripDist.toFixed(1)), duration,
    assignedDriver.id, assignedDriver.name, assignedDriver.user_rating, assignedDriver.phone, assignedDriver.model, assignedDriver.plate
  );

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(result.lastInsertRowid);
    const passenger = db.prepare('SELECT name, rating FROM users WHERE id = ?').get(req.userId);

    // 4. Notify Driver via Socket
    const driverSocketId = activeDriversMap.get(assignedDriver.id);
    if (driverSocketId) {
      io.to(driverSocketId).emit('new_ride_request', { 
        ride: {
          ...ride,
          passenger_name: passenger.name,
          passenger_rating: passenger.rating
        }
      });
    }

    // Add to recent locations
    db.prepare(`
      INSERT INTO recent_locations (user_id, name, address, lat, lng)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.userId, dest_address.split(',')[0], dest_address, dest_lat, dest_lng);

    res.status(201).json({ ride });
  } catch (err) {
    console.error('Request ride error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Get ride by ID
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare('SELECT * FROM rides WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.userId);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    res.json({ ride });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept ride (by driver)
router.put('/:id/accept', authenticateToken, (req, res) => {
  try {
    const rideId = req.params.id;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'searching') return res.status(400).json({ error: 'Ride is no longer available' });

    db.prepare("UPDATE rides SET status = 'confirmed' WHERE id = ?").run(rideId);

    const updatedRide = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    // Notify Passenger via Socket
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const passengerSocketId = activeUsers.get(ride.user_id);
    
    if (passengerSocketId) {
      io.to(passengerSocketId).emit('ride_accepted', { ride: updatedRide });
    }

    res.json({ message: 'Ride accepted', ride: updatedRide });
  } catch (err) {
    console.error('Accept ride error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Cancel ride
router.put('/:id/cancel', authenticateToken, (req, res) => {
  try {
    db.prepare("UPDATE rides SET status = 'cancelled' WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.userId);

    res.json({ message: 'Ride cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Complete ride
router.put('/:id/complete', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(req.params.id);
    if (!ride) return res.status(404).json({ error: 'Ride not found' });

    db.prepare("UPDATE rides SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(req.params.id);

    // If there's a driver, credit their earnings
    if (ride.driver_id) {
      db.prepare('INSERT INTO earnings (driver_id, amount, ride_id, type) VALUES (?, ?, ?, ?)')
        .run(ride.driver_id, ride.fare, ride.id, 'ride');
      
      db.prepare('UPDATE drivers SET total_rides = total_rides + 1 WHERE id = ?').run(ride.driver_id);
    }

    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const passengerSocketId = activeUsers.get(ride.user_id);
    if (passengerSocketId) {
      io.to(passengerSocketId).emit('ride_completed', { ride_id: ride.id });
    }

    res.json({ message: 'Ride completed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get ride history
router.get('/', authenticateToken, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const rides = db.prepare(
      'SELECT * FROM rides WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(req.userId, limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM rides WHERE user_id = ?')
      .get(req.userId);

    res.json({ rides, total: total.count, page, limit });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
