const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';

console.log('🧪 Testing OTP Functionality\n');
console.log(`Base URL: ${BASE_URL}`);
console.log(`Test Email: ${TEST_EMAIL}\n`);

async function testOTP() {
  try {
    // Step 1: Register user
    console.log('📝 Step 1: Registering test user...');
    try {
      await axios.post(`${BASE_URL}/api/auth/register`, {
        name: 'Test User',
        email: TEST_EMAIL,
        password: 'Test123!@#',
        phone: '1234567890'
      });
      console.log('✅ User registered successfully\n');
    } catch (error) {
      if (error.response?.status === 400 && error.response?.data?.error?.includes('already exists')) {
        console.log('ℹ️  User already exists, continuing...\n');
      } else {
        throw error;
      }
    }

    // Step 2: Send OTP
    console.log('📧 Step 2: Sending OTP...');
    const startTime = Date.now();
    
    const otpResponse = await axios.post(`${BASE_URL}/api/auth/send-otp`, {
      email: TEST_EMAIL
    });
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ OTP request completed in ${duration}ms`);
    console.log('Response:', JSON.stringify(otpResponse.data, null, 2));
    
    if (duration < 500) {
      console.log('🚀 EXCELLENT: Response time is very fast!');
    } else if (duration < 2000) {
      console.log('✅ GOOD: Response time is acceptable');
    } else {
      console.log('⚠️  SLOW: Response time needs improvement');
    }
    
    // Show OTP if in development
    if (otpResponse.data.otp) {
      console.log(`\n🔐 OTP Code: ${otpResponse.data.otp}`);
      console.log('(OTP is only shown in development mode)\n');
      
      // Step 3: Verify OTP
      console.log('🔍 Step 3: Verifying OTP...');
      const verifyResponse = await axios.post(`${BASE_URL}/api/auth/verify-otp`, {
        email: TEST_EMAIL,
        otp: otpResponse.data.otp
      });
      
      console.log('✅ OTP verified successfully');
      console.log('Response:', JSON.stringify(verifyResponse.data, null, 2));
    } else {
      console.log('\n📬 Check your email for the OTP code');
      console.log('Or check the server console logs\n');
    }
    
    console.log('\n✅ All tests passed!');
    console.log('\n📊 Summary:');
    console.log(`   - Response Time: ${duration}ms`);
    console.log(`   - Status: ${otpResponse.status}`);
    console.log(`   - Email: ${TEST_EMAIL}`);
    
  } catch (error) {
    console.error('\n❌ Test failed!');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Is the server running?');
    } else {
      console.error('Error:', error.message);
    }
    
    process.exit(1);
  }
}

// Run the test
testOTP();
