/**
 * Migration Script: Add OTP fields to existing database
 * Run this once to update your existing database schema
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'ridenow.db'));

console.log('Starting migration to OTP system...');

try {
  // Check if columns already exist
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const columnNames = tableInfo.map(col => col.name);

  const columnsToAdd = [];
  
  if (!columnNames.includes('is_verified')) {
    columnsToAdd.push('is_verified INTEGER DEFAULT 0');
  }
  
  if (!columnNames.includes('otp_code')) {
    columnsToAdd.push('otp_code TEXT');
  }
  
  if (!columnNames.includes('otp_expiry')) {
    columnsToAdd.push('otp_expiry DATETIME');
  }
  
  if (!columnNames.includes('reset_token')) {
    columnsToAdd.push('reset_token TEXT');
  }
  
  if (!columnNames.includes('reset_token_expiry')) {
    columnsToAdd.push('reset_token_expiry DATETIME');
  }

  // Add missing columns
  for (const column of columnsToAdd) {
    const sql = `ALTER TABLE users ADD COLUMN ${column}`;
    console.log(`Adding column: ${column}`);
    db.exec(sql);
  }

  // Remove old verification_token column if it exists
  if (columnNames.includes('verification_token')) {
    console.log('Note: verification_token column exists but cannot be dropped in SQLite.');
    console.log('It will be ignored. Consider recreating the table if needed.');
  }

  console.log('✅ Migration completed successfully!');
  console.log('');
  console.log('Summary:');
  console.log('- Added OTP fields (otp_code, otp_expiry)');
  console.log('- Added verification status field (is_verified)');
  console.log('- Added password reset fields (reset_token, reset_token_expiry)');
  console.log('');
  console.log('You can now restart your server.');

} catch (error) {
  console.error('❌ Migration failed:', error.message);
  process.exit(1);
} finally {
  db.close();
}
