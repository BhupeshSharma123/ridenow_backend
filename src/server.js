require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./database');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const rideRoutes = require('./routes/rides');
const locationRoutes = require('./routes/locations');
const paymentRoutes = require('./routes/payments');
const driverRoutes = require('./routes/drivers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/drivers', driverRoutes);

// Socket.IO Logic
const activeUsers = new Map(); // userId -> socketId
const activeDrivers = new Map(); // driverId -> socketId

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on('join', (userId) => {
    if (userId) {
      activeUsers.set(userId, socket.id);
      console.log(`User ${userId} joined with socket ${socket.id}`);
    }
  });

  socket.on('driver_online', (data) => {
    const { driverId, userId, lat, lng } = data;
    if (driverId) {
      activeDrivers.set(driverId, socket.id);
      if (userId) activeUsers.set(userId, socket.id);
      db.prepare('UPDATE drivers SET is_online = 1, current_lat = ?, current_lng = ? WHERE id = ?')
        .run(lat, lng, driverId);
      console.log(`Driver ${driverId} (User ${userId}) is online`);
    }
  });

  socket.on('disconnect', () => {
    // Remove from maps if needed
    for (const [uid, sid] of activeUsers.entries()) {
      if (sid === socket.id) {
        activeUsers.delete(uid);
        break;
      }
    }
    for (const [did, sid] of activeDrivers.entries()) {
      if (sid === socket.id) {
        activeDrivers.delete(did);
        break;
      }
    }
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Attach io and maps to app
app.set('io', io);
app.set('activeUsers', activeUsers);
app.set('activeDrivers', activeDrivers);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'RIDENOW API',
    version: '2.0.0 (Socket Ready)',
    timestamp: new Date().toISOString(),
  });
});
app.get("/", (req, res) => {
  res.send("RIDENOW Backend Running 🚀");
});
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║          RIDENOW REALTIME API        ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  🚀 Server: http://localhost:${PORT}      ║`);
  console.log(`  ║  ⚡ Socket: Enabled                  ║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
