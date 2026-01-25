const nodemailer = require("nodemailer");

class EmailService {
  constructor() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
    this.mailFrom = MAIL_FROM || "no-reply@example.com";

    // If you don’t have SMTP configured yet, fail loudly (better than silent “works on my machine”)
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465, // true for 465, false for 587
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }

  async sendOtp(email, otp) {
    if (!this.transporter) {
      // For dev: log OTP so you can test flow without SMTP
      console.warn(`[DEV] OTP for ${email}: ${otp}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.mailFrom,
      to: email,
      subject: "Your verification code",
      text: `Your verification code is: ${otp}\n\nIt expires in ${process.env.OTP_TTL_MINUTES || 10} minutes.`,
    });
  }
}

module.exports = EmailService;
