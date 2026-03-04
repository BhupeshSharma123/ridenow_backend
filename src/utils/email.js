const nodemailer = require('nodemailer');

// For development/demo, we can use Ethereal (test account) 
// or let the user configure their own SMTP.
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
  port: process.env.EMAIL_PORT || 587,
  auth: {
    user: process.env.EMAIL_USER || 'mock_user@ridenow.com',
    pass: process.env.EMAIL_PASS || 'mock_pass',
  },
});

const sendEmail = async (to, subject, html) => {
  try {
    // If we're using mock credentials, let's just log it to console
    if (!process.env.EMAIL_USER) {
      console.log('--- EMAIL SIMULATION ---');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('Content:', html);
      console.log('------------------------');
      return true;
    }

    const info = await transporter.sendMail({
      from: '"RIDENOW" <no-reply@ridenow.com>',
      to,
      subject,
      html,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

const sendVerificationEmail = async (email, token) => {
  const url = `${process.env.APP_URL || 'https://ridenow-backend-mkv6.onrender.com'}/api/auth/verify-email/${token}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #007BFF;">Verify your email - RIDENOW</h2>
      <p>Hello,</p>
      <p>Please click the button below to verify your email address and activate your RIDENOW account:</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${url}" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">VERIFY EMAIL NOW</a>
      </div>
      <p>If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #666;">${url}</p>
      <p>This link will expire in 24 hours.</p>
      <p>Best regards,<br>The RIDENOW Team</p>
    </div>
  `;
  return sendEmail(email, 'Verify your email - RIDENOW', html);
};

const sendResetPasswordEmail = async (email, token) => {
  const html = `
    <h1>Reset your password</h1>
    <p>Your password reset token is: <strong>${token}</strong></p>
    <p>Alternatively, click the link below to reset your password:</p>
    <p>(URL for web if applicable, otherwise enter the code in the app)</p>
    <p>This token will expire in 1 hour.</p>
  `;
  return sendEmail(email, 'Reset your password - RIDENOW', html);
};

module.exports = {
  sendVerificationEmail,
  sendResetPasswordEmail,
};
