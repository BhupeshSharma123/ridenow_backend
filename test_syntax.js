// Quick syntax test
try {
  require('./src/database');
  console.log('✅ database.js - OK');
} catch (e) {
  console.error('❌ database.js - ERROR:', e.message);
}

try {
  require('./src/utils/email');
  console.log('✅ email.js - OK');
} catch (e) {
  console.error('❌ email.js - ERROR:', e.message);
}

try {
  require('./src/routes/auth');
  console.log('✅ auth.js - OK');
} catch (e) {
  console.error('❌ auth.js - ERROR:', e.message);
}

console.log('\n✅ All files loaded successfully!');
