// Script to create admin user
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'ridenow.db'));

async function setupAdmin() {
  console.log('\n🔧 Setting up admin user...\n');
  
  // Admin credentials
  const email = 'admin@ridenow.com';
  const password = 'admin123';
  const name = 'Admin User';
  
  try {
    // Check if admin already exists
    const existingAdmin = db.prepare('SELECT * FROM admins WHERE email = ?').get(email);
    
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!');
      console.log('\n═══════════════════════════════════');
      console.log('Existing Admin Credentials:');
      console.log('═══════════════════════════════════');
      console.log('Email:    ', email);
      console.log('Password: ', password);
      console.log('═══════════════════════════════════\n');
      return;
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('✓ Password hashed');
    
    // Insert admin user
    const result = db.prepare(`
      INSERT INTO admins (email, password_hash, name, role, created_at, updated_at) 
      VALUES (?, ?, ?, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(email, hashedPassword, name);
    
    console.log('✓ Admin user created successfully!\n');
    console.log('═══════════════════════════════════');
    console.log('Login Credentials:');
    console.log('═══════════════════════════════════');
    console.log('Email:    ', email);
    console.log('Password: ', password);
    console.log('═══════════════════════════════════');
    console.log('\n⚠️  IMPORTANT: Change this password after first login!');
    console.log('🌐 Admin Panel: http://localhost:3000\n');
    
  } catch (error) {
    console.error('❌ Error setting up admin:', error.message);
  } finally {
    db.close();
  }
}

setupAdmin();
