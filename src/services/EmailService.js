const nodemailer = require("nodemailer");
const path = require("path");

class EmailService {
  constructor() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
    this.smtpUser = SMTP_USER || null;
    this.mailFrom = MAIL_FROM || (SMTP_USER ? `CONVAD <${SMTP_USER}>` : "no-reply@example.com");

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      this.transporter = null;
      console.warn("[EmailService] SMTP not configured. Using DEV console OTP.");
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  _otpHtml({ otp, ttlMinutes = 10 }) {
  // Light, email-safe HTML (explicit white background so clients don't force dark panels)
  const code = String(otp);
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#ffffff;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:22px;color:#111827;">
        
        <div style="text-align:center;margin-bottom:14px;">
          <img src="cid:convadlogo" alt="CONVAD" style="height:44px;width:auto;display:inline-block;" />
        </div>

        <h2 style="margin:0 0 10px 0;font-size:18px;color:#111827;">Your verification code</h2>

        <p style="margin:0 0 16px 0;color:#374151;">
          Use the code below to verify your email. This code expires in <b>${ttlMinutes}</b> minutes.
        </p>

        <div style="text-align:center;margin:18px 0;">
          <div style="
            display:inline-block;
            padding:14px 18px;
            border-radius:12px;
            background:#f3f4f6;
            border:1px solid #e5e7eb;
            font-size:26px;
            letter-spacing:6px;
            font-weight:700;
            color:#111827;
          ">
            ${code}
          </div>
        </div>

        <p style="margin:16px 0 0 0;font-size:13px;color:#6b7280;">
          If you didn’t request this, you can ignore this email.
        </p>
      </div>
    </div>
  `;
}


  async sendOtp(email, otp) {
    const ttl = Number(process.env.OTP_TTL_MINUTES || 10);

    if (!this.transporter) {
      console.warn(`[DEV] OTP for ${email}: ${otp}`);
      return;
    }

    // Embed your local logo from /app/assets/CONVAD.png (served for UI too)
    const logoPath = path.join(__dirname, "..", "..", "app", "assets", "CONVAD.png");

    await this.transporter.sendMail({
      from: this.mailFrom,
      to: email,
      subject: "CONVAD verification code",
      text: `Your verification code is: ${otp}\n\nIt expires in ${ttl} minutes.\n\nIf you didn’t request this, ignore this email.`,
      html: this._otpHtml({ otp, ttlMinutes: ttl }),
      attachments: [
        {
          filename: "CONVAD.png",
          path: logoPath,
          cid: "convadlogo",
        },
      ],
    });
  }
}

module.exports = EmailService;
