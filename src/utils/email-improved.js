const nodemailer = require('nodemailer');

// Create reusable transporter with connection pooling for better performance
let transporter = null;

const createTransporter = () => {
  if (transporter) return transporter;

  const config = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    pool: true, // Use connection pooling
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000, // 1 second between messages
    rateLimit: 5, // Max 5 messages per rateDelta
    tls: {
      rejectUnauthorized: false, // Accept self-signed certificates
    },
  };

  // Check if we have valid credentials
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  Email credentials not configured. Emails will be logged to console only.');
    return null;
  }

  transporter = nodemailer.createTransport(config);

  // Verify connection configuration
  transporter.verify((error, success) => {
    if (error) {
      console.error('❌ Email transporter verification failed:', error.message);
      transporter = null;
    } else {
      console.log('✅ Email server is ready to send messages');
    }
  });

  return transporter;
};

const sendEmail = async (to, subject, html, retries = 3) => {
  // If no transporter or mock mode, log to console
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log('\n📧 ===== EMAIL SIMULATION =====');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Content:', html.substring(0, 200) + '...');
    console.log('==============================\n');
    return { success: true, simulated: true };
  }

  const emailTransporter = createTransporter();
  
  if (!emailTransporter) {
    console.error('❌ Email transporter not available');
    return { success: false, error: 'Email service not configured' };
  }

  // Retry logic for better reliability
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const info = await emailTransporter.sendMail({
        from: `"RIDENOW" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
        priority: 'high', // Mark as high priority
      });

      console.log(`✅ Email sent successfully to ${to} (Message ID: ${info.messageId})`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error(`❌ Email send attempt ${attempt}/${retries} failed:`, error.message);
      
      if (attempt === retries) {
        return { success: false, error: error.message };
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return { success: false, error: 'Max retries exceeded' };
};

const sendOtpEmail = async (email, otp) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>RIDENOW - Verification Code</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">RIDENOW</h1>
                  <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 14px; opacity: 0.9;">Your Ride, Your Way</p>
                </td>
              </tr>
              
              <!-- Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="margin: 0 0 20px 0; color: #333333; font-size: 24px; font-weight: 600;">Verify Your Email</h2>
                  <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                    Thank you for signing up! Please use the verification code below to complete your registration:
                  </p>
                  
                  <!-- OTP Box -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding: 20px 0;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 25px; display: inline-block;">
                          <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #ffffff; font-family: 'Courier New', monospace;">${otp}</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <p style="margin: 30px 0 0 0; color: #666666; font-size: 14px; line-height: 1.5;">
                    This code will expire in <strong>10 minutes</strong>. If you didn't request this code, please ignore this email.
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f9f9f9; padding: 20px 30px; border-top: 1px solid #eeeeee;">
                  <p style="margin: 0; color: #999999; font-size: 12px; text-align: center;">
                    © ${new Date().getFullYear()} RIDENOW. All rights reserved.<br>
                    This is an automated message, please do not reply.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail(email, '🔐 Your RIDENOW Verification Code', html);
};

const sendVerificationEmail = async (email, token) => {
  const url = `${process.env.APP_URL || 'http://localhost:3000'}/api/auth/verify-email/${token}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px;">RIDENOW</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px; text-align: center;">
                  <h2 style="margin: 0 0 20px 0; color: #333333;">Verify Your Email</h2>
                  <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px;">
                    Click the button below to verify your email address:
                  </p>
                  <a href="${url}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                    Verify Email
                  </a>
                  <p style="margin: 30px 0 0 0; color: #999999; font-size: 12px;">
                    Link expires in 24 hours
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail(email, '✉️ Verify Your RIDENOW Account', html);
};

const sendResetPasswordEmail = async (email, token) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0;">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
              <tr>
                <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px;">RIDENOW</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 40px 30px;">
                  <h2 style="margin: 0 0 20px 0; color: #333333;">Reset Your Password</h2>
                  <p style="margin: 0 0 20px 0; color: #666666; font-size: 16px;">
                    Your password reset code is:
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding: 20px 0;">
                        <div style="background-color: #f5f5f5; border-radius: 8px; padding: 20px; display: inline-block;">
                          <span style="font-size: 28px; font-weight: 700; letter-spacing: 5px; color: #667eea; font-family: 'Courier New', monospace;">${token}</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                  <p style="margin: 20px 0 0 0; color: #666666; font-size: 14px;">
                    Enter this code in the app to reset your password. This code expires in 1 hour.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendEmail(email, '🔑 Reset Your RIDENOW Password', html);
};

// Graceful shutdown
process.on('SIGTERM', () => {
  if (transporter) {
    transporter.close();
    console.log('📧 Email transporter closed');
  }
});

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
  sendOtpEmail,
  createTransporter, // Export for testing
};
