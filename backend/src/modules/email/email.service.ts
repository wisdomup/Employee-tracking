import nodemailer from 'nodemailer';

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function getPasswordResetEmailTemplate(resetUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white; padding: 30px; text-align: center;
          border-radius: 10px 10px 0 0;
        }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button {
          display: inline-block; padding: 12px 30px;
          background-color: #3b82f6; color: white !important;
          text-decoration: none; border-radius: 5px;
          margin: 20px 0; font-weight: bold;
        }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>GPS Task Tracker</h1>
          <p>Password Reset Request</p>
        </div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>Hello,</p>
          <p>We received a request to reset your password. Click the button below:</p>
          <center><a href="${resetUrl}" class="button">Reset Password</a></center>
          <div class="warning">
            <strong>Security Notice:</strong>
            <ul>
              <li>This link expires in <strong>1 hour</strong></li>
              <li>If you didn't request this, ignore this email</li>
              <li>Never share this link with anyone</li>
            </ul>
          </div>
          <p>If the button doesn't work, copy and paste this link:</p>
          <p style="word-break:break-all;color:#666;font-size:12px;">${resetUrl}</p>
          <p>Best regards,<br>GPS Task Tracker Team</p>
        </div>
        <div class="footer">
          <p>This is an automated email, please do not reply.</p>
          <p>&copy; ${new Date().getFullYear()} GPS Task Tracker. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"GPS Task Tracker" <${process.env.SMTP_USER}>`,
    to: email,
    subject: 'Password Reset Request - GPS Task Tracker',
    html: getPasswordResetEmailTemplate(resetUrl),
  });
}
