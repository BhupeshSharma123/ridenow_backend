const express = require('express');
const db = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Enhanced ride request with real driver matching
router.post('/request', authenticateToken, async (req, res) => {
  try {
    const {
      pickup_address, pickup_lat, pickup_lng,
      dest_address, dest_lat, dest_lng,
      vehicle_type = 'car',
      fare_estimate
    } = req.body;

    if (!pickup_address || !dest_address || !pickup_lat || !pickup_lng || !dest_lat || !dest_lng) {
      return res.status(400).json({ error: 'Complete pickup and destination information required' });
    }

    const io = req.app.get('io');
    const activeDriversMap = req.app.get('activeDrivers');

    // 1. Find available drivers within radius
    const availableDrivers = await findNearbyDrivers(pickup_lat, pickup_lng, vehicle_type, 10); // 10km radius

    if (availableDrivers.length === 0) {
      return res.status(404).json({ 
        error: 'No drivers available in your area',
        suggestion: 'Please try again in a few minutes or consider a different vehicle type'
      });
    }

    // 2. Calculate trip details
    const tripDistance = calculateDistance(pickup_lat, pickup_lng, dest_lat, dest_lng);
    const estimatedDuration = Math.round(tripDistance * 2.5 + 5); // More realistic duration
    const calculatedFare = calculateFare(tripDistance, estimatedDuration, vehicle_type);

    // 3. Create ride request
    const result = db.prepare(`
      INSERT INTO rides (
        user_id, pickup_address, pickup_lat, pickup_lng, 
        dest_address, dest_lat, dest_lng, status, vehicle_type, 
        fare, distance_km, duration_mins, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'searching', ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      req.userId, pickup_address, pickup_lat, pickup_lng,
      dest_address, dest_lat, dest_lng, vehicle_type,
      calculatedFare, parseFloat(tripDistance.toFixed(2)), estimatedDuration
    );

    const rideId = result.lastInsertRowid;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    const passenger = db.prepare('SELECT name, rating, phone FROM users WHERE id = ?').get(req.userId);

    // 4. Notify nearby drivers (sorted by distance)
    const notificationPromises = availableDrivers.slice(0, 5).map(async (driver, index) => {
      const driverSocketId = activeDriversMap.get(driver.id);
      if (driverSocketId) {
        // Add slight delay for each driver to prevent race conditions
        setTimeout(() => {
          io.to(driverSocketId).emit('new_ride_request', {
            ride: {
              ...ride,
              passenger_name: passenger.name,
              passenger_rating: passenger.rating,
              passenger_phone: passenger.phone,
              distance_to_pickup: driver.distance_to_pickup,
              estimated_arrival: Math.round(driver.distance_to_pickup * 2 + 2)
            }
          });
        }, index * 1000); // 1 second delay between notifications
      }
    });

    // 5. Set auto-cancel timer (5 minutes)
    setTimeout(async () => {
      const currentRide = db.prepare('SELECT status FROM rides WHERE id = ?').get(rideId);
      if (currentRide && currentRide.status === 'searching') {
        db.prepare("UPDATE rides SET status = 'cancelled', cancelled_reason = 'No driver found' WHERE id = ?").run(rideId);
        
        // Notify passenger
        const activeUsers = req.app.get('activeUsers');
        const passengerSocketId = activeUsers.get(req.userId);
        if (passengerSocketId) {
          io.to(passengerSocketId).emit('ride_cancelled', { 
            ride_id: rideId, 
            reason: 'No driver found',
            message: 'We couldn\'t find a driver for your ride. Please try again.'
          });
        }
      }
    }, 5 * 60 * 1000); // 5 minutes

    // 6. Add to recent locations
    try {
      db.prepare(`
        INSERT OR REPLACE INTO recent_locations (user_id, name, address, lat, lng, visited_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(req.userId, dest_address.split(',')[0], dest_address, dest_lat, dest_lng);
    } catch (e) {
      console.log('Recent location save error:', e);
    }

    res.status(201).json({ 
      success: true,
      ride,
      available_drivers: availableDrivers.length,
      estimated_wait_time: '2-5 minutes'
    });

  } catch (err) {
    console.error('Request ride error:', err);
    res.status(500).json({ error: 'Server error while requesting ride' });
  }
});

// Enhanced driver finder
async function findNearbyDrivers(pickup_lat, pickup_lng, vehicle_type, radius_km = 10) {
  const drivers = db.prepare(`
    SELECT 
      d.id, d.user_id, d.current_lat, d.current_lng, d.total_rating, d.total_rides,
      u.name, u.phone, u.rating as user_rating,
      v.model, v.number as plate, v.color, v.type
    FROM drivers d
    JOIN users u ON d.user_id = u.id
    JOIN vehicles v ON d.id = v.driver_id
    WHERE d.is_online = 1 
      AND d.status = 'approved' 
      AND v.type = ?
      AND d.current_lat IS NOT NULL 
      AND d.current_lng IS NOT NULL
  `).all(vehicle_type);

  const nearbyDrivers = drivers
    .map(driver => ({
      ...driver,
      distance_to_pickup: calculateDistance(
        pickup_lat, pickup_lng, 
        driver.current_lat, driver.current_lng
      )
    }))
    .filter(driver => driver.distance_to_pickup <= radius_km)
    .sort((a, b) => a.distance_to_pickup - b.distance_to_pickup);

  return nearbyDrivers;
}

// Enhanced fare calculation
function calculateFare(distance_km, duration_mins, vehicle_type) {
  const baseFares = {
    'bike': 15,
    'auto': 25,
    'car': 35,
    'suv': 50,
    'premium': 75
  };

  const perKmRates = {
    'bike': 8,
    'auto': 12,
    'car': 15,
    'suv': 20,
    'premium': 30
  };

  const perMinRates = {
    'bike': 1,
    'auto': 1.5,
    'car': 2,
    'suv': 2.5,
    'premium': 3
  };

  const baseFare = baseFares[vehicle_type] || baseFares['car'];
  const perKm = perKmRates[vehicle_type] || perKmRates['car'];
  const perMin = perMinRates[vehicle_type] || perMinRates['car'];

  // Add surge pricing during peak hours
  const hour = new Date().getHours();
  const isPeakHour = (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20);
  const surgeMultiplier = isPeakHour ? 1.3 : 1.0;

  const totalFare = (baseFare + (distance_km * perKm) + (duration_mins * perMin)) * surgeMultiplier;
  return Math.round(totalFare * 100) / 100; // Round to 2 decimal places
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999;
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Accept ride (by driver) - Enhanced
router.put('/:id/accept', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }
    
    if (ride.status !== 'searching') {
      return res.status(400).json({ error: 'Ride is no longer available' });
    }

    // Get driver info
    const driver = db.prepare(`
      SELECT d.*, u.name, u.phone, u.rating, v.model, v.number as plate, v.color
      FROM drivers d
      JOIN users u ON d.user_id = u.id
      JOIN vehicles v ON d.id = v.driver_id
      WHERE d.user_id = ?
    `).get(req.userId);

    if (!driver) {
      return res.status(403).json({ error: 'Driver not found' });
    }

    // Update ride with driver details
    db.prepare(`
      UPDATE rides SET 
        status = 'confirmed', 
        driver_id = ?, 
        driver_name = ?, 
        driver_rating = ?, 
        driver_phone = ?, 
        vehicle_model = ?, 
        vehicle_plate = ?,
        confirmed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      driver.id, driver.name, driver.rating, driver.phone, 
      driver.model, driver.plate, rideId
    );

    const updatedRide = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    // Notify passenger
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const passengerSocketId = activeUsers.get(ride.user_id);
    
    if (passengerSocketId) {
      io.to(passengerSocketId).emit('ride_accepted', { 
        ride: updatedRide,
        driver: {
          name: driver.name,
          phone: driver.phone,
          rating: driver.rating,
          vehicle: `${driver.color} ${driver.model}`,
          plate: driver.plate,
          location: {
            lat: driver.current_lat,
            lng: driver.current_lng
          }
        },
        estimated_arrival: Math.round(calculateDistance(
          driver.current_lat, driver.current_lng,
          ride.pickup_lat, ride.pickup_lng
        ) * 2 + 2)
      });
    }

    // Notify other drivers that ride is taken
    const activeDriversMap = req.app.get('activeDrivers');
    activeDriversMap.forEach((socketId, driverId) => {
      if (driverId !== driver.id) {
        io.to(socketId).emit('ride_taken', { ride_id: rideId });
      }
    });

    res.json({ 
      success: true,
      message: 'Ride accepted successfully', 
      ride: updatedRide 
    });

  } catch (err) {
    console.error('Accept ride error:', err);
    res.status(500).json({ error: 'Server error while accepting ride' });
  }
});

// Start ride (driver arrived at pickup)
router.put('/:id/start', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const { pickup_verification } = req.body;

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (ride.status !== 'confirmed') {
      return res.status(400).json({ error: 'Ride cannot be started' });
    }

    // Update ride status
    db.prepare(`
      UPDATE rides SET 
        status = 'in_progress', 
        started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(rideId);

    const updatedRide = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    // Notify passenger
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const passengerSocketId = activeUsers.get(ride.user_id);
    
    if (passengerSocketId) {
      io.to(passengerSocketId).emit('ride_started', { 
        ride: updatedRide,
        message: 'Your ride has started!'
      });
    }

    res.json({ 
      success: true,
      message: 'Ride started successfully', 
      ride: updatedRide 
    });

  } catch (err) {
    console.error('Start ride error:', err);
    res.status(500).json({ error: 'Server error while starting ride' });
  }
});

// Complete ride - Enhanced
router.put('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const { final_fare, rating, feedback } = req.body;

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    const actualFare = final_fare || ride.fare;

    // Update ride
    db.prepare(`
      UPDATE rides SET 
        status = 'completed', 
        completed_at = CURRENT_TIMESTAMP,
        final_fare = ?,
        passenger_rating = ?,
        passenger_feedback = ?
      WHERE id = ?
    `).run(actualFare, rating, feedback, rideId);

    // Update driver earnings and stats
    if (ride.driver_id) {
      const driverEarning = actualFare * 0.8; // 80% to driver, 20% platform fee
      
      db.prepare(`
        INSERT INTO earnings (driver_id, amount, ride_id, type, created_at) 
        VALUES (?, ?, ?, 'ride', CURRENT_TIMESTAMP)
      `).run(ride.driver_id, driverEarning, rideId);
      
      db.prepare(`
        UPDATE drivers SET 
          total_rides = total_rides + 1,
          total_rating = (total_rating * total_rides + ?) / (total_rides + 1)
        WHERE id = ?
      `).run(rating || 5, ride.driver_id);
    }

    const updatedRide = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    // Notify both passenger and driver
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const activeDriversMap = req.app.get('activeDrivers');
    
    const passengerSocketId = activeUsers.get(ride.user_id);
    if (passengerSocketId) {
      io.to(passengerSocketId).emit('ride_completed', { 
        ride: updatedRide,
        message: 'Ride completed successfully!',
        fare: actualFare
      });
    }

    const driverSocketId = activeDriversMap.get(ride.driver_id);
    if (driverSocketId) {
      io.to(driverSocketId).emit('ride_completed', { 
        ride: updatedRide,
        earning: actualFare * 0.8
      });
    }

    res.json({ 
      success: true,
      message: 'Ride completed successfully', 
      ride: updatedRide 
    });

  } catch (err) {
    console.error('Complete ride error:', err);
    res.status(500).json({ error: 'Server error while completing ride' });
  }
});

// Cancel ride - Enhanced
router.put('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const rideId = req.params.id;
    const { reason, cancelled_by } = req.body;

    const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    if (!['searching', 'confirmed'].includes(ride.status)) {
      return res.status(400).json({ error: 'Ride cannot be cancelled at this stage' });
    }

    // Calculate cancellation fee if applicable
    let cancellationFee = 0;
    if (ride.status === 'confirmed' && cancelled_by === 'passenger') {
      cancellationFee = Math.min(ride.fare * 0.1, 50); // 10% of fare or $50, whichever is less
    }

    db.prepare(`
      UPDATE rides SET 
        status = 'cancelled', 
        cancelled_at = CURRENT_TIMESTAMP,
        cancelled_by = ?,
        cancelled_reason = ?,
        cancellation_fee = ?
      WHERE id = ?
    `).run(cancelled_by, reason, cancellationFee, rideId);

    const updatedRide = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);

    // Notify relevant parties
    const io = req.app.get('io');
    const activeUsers = req.app.get('activeUsers');
    const activeDriversMap = req.app.get('activeDrivers');

    if (cancelled_by === 'passenger' && ride.driver_id) {
      const driverSocketId = activeDriversMap.get(ride.driver_id);
      if (driverSocketId) {
        io.to(driverSocketId).emit('ride_cancelled', { 
          ride: updatedRide,
          message: 'Passenger cancelled the ride'
        });
      }
    } else if (cancelled_by === 'driver') {
      const passengerSocketId = activeUsers.get(ride.user_id);
      if (passengerSocketId) {
        io.to(passengerSocketId).emit('ride_cancelled', { 
          ride: updatedRide,
          message: 'Driver cancelled the ride. We\'ll find you another driver.'
        });
      }
    }

    res.json({ 
      success: true,
      message: 'Ride cancelled successfully', 
      ride: updatedRide,
      cancellation_fee: cancellationFee
    });

  } catch (err) {
    console.error('Cancel ride error:', err);
    res.status(500).json({ error: 'Server error while cancelling ride' });
  }
});

// Get ride details
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const ride = db.prepare(`
      SELECT r.*, u.name as passenger_name, u.phone as passenger_phone
      FROM rides r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.id = ? AND (r.user_id = ? OR r.driver_id IN (
        SELECT id FROM drivers WHERE user_id = ?
      ))
    `).get(req.params.id, req.userId, req.userId);

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    res.json({ success: true, ride });
  } catch (err) {
    console.error('Get ride error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get ride history with filters
router.get('/', authenticateToken, (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

    let query = 'SELECT * FROM rides WHERE user_id = ?';
    let params = [req.userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    if (startDate) {
      query += ' AND DATE(created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      query += ' AND DATE(created_at) <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rides = db.prepare(query).all(...params);

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as count FROM rides WHERE user_id = ?';
    let countParams = [req.userId];

    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    if (startDate) {
      countQuery += ' AND DATE(created_at) >= ?';
      countParams.push(startDate);
    }

    if (endDate) {
      countQuery += ' AND DATE(created_at) <= ?';
      countParams.push(endDate);
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
    console.error('Get ride history error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get fare estimate
router.post('/estimate', authenticateToken, (req, res) => {
  try {
    const { pickup_lat, pickup_lng, dest_lat, dest_lng, vehicle_type = 'car' } = req.body;

    if (!pickup_lat || !pickup_lng || !dest_lat || !dest_lng) {
      return res.status(400).json({ error: 'Pickup and destination coordinates required' });
    }

    const distance = calculateDistance(pickup_lat, pickup_lng, dest_lat, dest_lng);
    const duration = Math.round(distance * 2.5 + 5);
    const fare = calculateFare(distance, duration, vehicle_type);

    // Check driver availability
    const availableDrivers = db.prepare(`
      SELECT COUNT(*) as count FROM drivers d
      JOIN vehicles v ON d.id = v.driver_id
      WHERE d.is_online = 1 AND d.status = 'approved' AND v.type = ?
    `).get(vehicle_type);

    res.json({
      success: true,
      estimate: {
        distance_km: Math.round(distance * 100) / 100,
        duration_mins: duration,
        fare: fare,
        vehicle_type: vehicle_type,
        available_drivers: availableDrivers.count,
        surge_active: false // You can implement surge logic here
      }
    });

  } catch (err) {
    console.error('Fare estimate error:', err);
    res.status(500).json({ error: 'Server error while calculating fare' });
  }
});

module.exports = router;
