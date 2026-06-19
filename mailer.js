const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'mail.vectorbrainai.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendVerificationEmail(toEmail, fullName, token, baseUrl) {
  const verifyUrl = `${baseUrl}/verify?token=${token}`;
  await transporter.sendMail({
    from: `"VectorMatch AI" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Verify your VectorMatch AI account',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:linear-gradient(135deg,#0f0c29,#302b63);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;font-size:1.5rem;margin:0;font-weight:800">VectorMatch<span style="color:#00d4aa">.AI</span></h1>
        </div>
        <div style="padding:40px">
          <h2 style="font-size:1.2rem;color:#0f0c29;margin-bottom:12px">Hi ${fullName},</h2>
          <p style="color:#64748b;line-height:1.7;margin-bottom:28px">
            You're one step away from accessing your AI-powered career toolkit. Click the button below to verify your email and unlock your resume matcher, skills gap analysis, and 60–90 day career roadmap.
          </p>
          <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fff,#5128e0);color:#fff;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:700;font-size:1rem">
            ✅ Verify My Email
          </a>
          <p style="color:#94a3b8;font-size:0.82rem;margin-top:28px">
            This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      </div>
    `,
  });
}

async function sendMagicLinkEmail(toEmail, fullName, token, baseUrl) {
  const loginUrl = `${baseUrl}/verify?token=${token}`;
  await transporter.sendMail({
    from: `"VectorMatch AI" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: 'Your VectorMatch AI sign-in link',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
        <div style="background:linear-gradient(135deg,#0f0c29,#302b63);padding:32px 40px;text-align:center">
          <h1 style="color:#fff;font-size:1.5rem;margin:0;font-weight:800">VectorMatch<span style="color:#00d4aa">.AI</span></h1>
        </div>
        <div style="padding:40px">
          <h2 style="font-size:1.2rem;color:#0f0c29;margin-bottom:12px">Welcome back, ${fullName}! 👋</h2>
          <p style="color:#64748b;line-height:1.7;margin-bottom:28px">
            Click below to sign in and access your career dashboard — your existing resume and analysis history will be ready for you.
          </p>
          <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#6c3fff,#5128e0);color:#fff;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:700;font-size:1rem">
            🚀 Sign In to VectorMatch AI
          </a>
          <p style="color:#94a3b8;font-size:0.82rem;margin-top:28px">This link expires in 24 hours and can only be used once.</p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendMagicLinkEmail };
