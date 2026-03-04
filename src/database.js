const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'ridenow.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    avatar_url TEXT,
    rating REAL DEFAULT 5.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    pickup_address TEXT NOT NULL,
    pickup_lat REAL NOT NULL,
    pickup_lng REAL NOT NULL,
    dest_address TEXT NOT NULL,
    dest_lat REAL NOT NULL,
    dest_lng REAL NOT NULL,
    driver_id INTEGER,
    status TEXT DEFAULT 'requested',
    vehicle_type TEXT DEFAULT 'sedan',
    fare REAL DEFAULT 0,
    distance_km REAL DEFAULT 0,
    duration_mins INTEGER DEFAULT 0,
    driver_name TEXT,
    driver_rating REAL,
    driver_phone TEXT,
    vehicle_model TEXT,
    vehicle_plate TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS saved_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    label TEXT DEFAULT 'other',
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS recent_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    last_four TEXT,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, approved, rejected
    rejection_reason TEXT,
    is_online INTEGER DEFAULT 0,
    current_lat REAL,
    current_lng REAL,
    total_rating REAL DEFAULT 5.0,
    total_rides INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER UNIQUE NOT NULL,
    type TEXT NOT NULL, -- bike, auto, car
    model TEXT NOT NULL,
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    color TEXT,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
  );

  CREATE TABLE IF NOT EXISTS driver_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    type TEXT NOT NULL, -- driving_license, rc, insurance, vehicle_photo, profile_photo
    file_path TEXT,
    status TEXT DEFAULT 'pending',
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
  );

  CREATE TABLE IF NOT EXISTS driver_bank_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER UNIQUE NOT NULL,
    account_name TEXT NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT NOT NULL,
    ifsc TEXT NOT NULL,
    upi_id TEXT,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
  );

  CREATE TABLE IF NOT EXISTS earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    ride_id INTEGER,
    type TEXT DEFAULT 'ride', -- ride, bonus, referral
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (ride_id) REFERENCES rides(id)
  );

  CREATE TABLE IF NOT EXISTS incentives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    driver_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    target INTEGER DEFAULT 1,
    progress INTEGER DEFAULT 0,
    reward REAL DEFAULT 0,
    is_completed INTEGER DEFAULT 0,
    FOREIGN KEY (driver_id) REFERENCES drivers(id)
  );
`);

module.exports = db;
