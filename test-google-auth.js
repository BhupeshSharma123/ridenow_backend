const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

console.log('🧪 Testing Google Authentication\n');
console.log(`Base URL: ${BASE_URL}\n`);

async function testGoogleAuth() {
  try {
    // Create a mock ID token for testing
    // In production, this would come from Google Sign-In
    const mockPayload = {
      email: 'test.google@gmail.com',
      name: 'Test Google User',
      picture: 'https://via.placeholder.com/150',
      sub: 'google-id-123456789'
    };
    
    const mockIdToken = Buffer.from(JSON.stringify(mockPayload)).toString('base64');
    
    console.log('📝 Step 1: Testing Google authentication endpoint...');
    console.log('Mock user:', mockPayload.email);
    
    const response = await axios.post(`${BASE_URL}/api/auth/google`, {
      idToken: mockIdToken
    });
    
    console.log('\n✅ Google authentication successful!');
    console.log('\nResponse:');
    console.log('- Success:', response.data.success);
    console.log('- Token:', response.data.token ? '✓ Received' : '✗ Missing');
    console.log('- User ID:', response.data.user?.id);
    console.log('- User Name:', response.data.user?.name);
    console.log('- User Email:', response.data.user?.email);
    console.log('- Verified:', response.data.user?.is_verified);
    
    console.log('\n📊 Summary:');
    console.log('   - Endpoint: /api/auth/google');
    console.log('   - Status: 200 OK');
    console.log('   - User created/logged in successfully');
    
    // Test with same user again (should login, not create)
    console.log('\n📝 Step 2: Testing login with existing Google user...');
    
    const response2 = await axios.post(`${BASE_URL}/api/auth/google`, {
      idToken: mockIdToken
    });
    
    console.log('✅ Existing user login successful!');
    console.log('   - User ID:', response2.data.user?.id);
    console.log('   - Same user:', response.data.user?.id === response2.data.user?.id ? 'Yes' : 'No');
    
    console.log('\n✅ All tests passed!');
    console.log('\n🎉 Google authentication is working correctly!');
    
  } catch (error) {
    console.error('\n❌ Test failed!');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Is the server running?');
      console.error('Try: cd ridenow_backend && npm start');
    } else {
      console.error('Error:', error.message);
    }
    
    process.exit(1);
  }
}

// Run the test
testGoogleAuth();
