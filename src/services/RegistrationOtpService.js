const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("./SessionService");
const EmailService = require("./EmailService");
const { generateOtp6, hashOtp } = require("../utils/otp");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function isStrongPassword(password) {
  if (typeof password !== "string") return false;

  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const hasLength = password.length >= 8;

  return hasUpper && hasLower && hasNumber && hasSymbol && hasLength;
}

class RegistrationOtpService {
  constructor() {
    this.pool = getPool();
    this.sessions = new SessionService();
    this.email = new EmailService();
  }

  _cfg() {
    return {
      ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
      maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
      lockMinutes: Number(process.env.OTP_LOCK_MINUTES || 15),
    };
  }

  _toMySqlDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours()
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  async start({ firstName, lastName, email, password, acceptTerms }) {
    // firstName/lastName should be optional
    if (!email || !password) throw new Error("email and password are required");
    if (!acceptTerms) throw new Error("you must accept the terms and conditions");

    const cleanEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) throw new Error("invalid email format");
    if (!isStrongPassword(password)) {
      throw new Error(
        "password must be at least 8 characters and include uppercase, lowercase, number, and symbol"
      );
    }

    // email already registered?
    const [existing] = await this.pool.execute(
      `SELECT user_id FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );
    if (existing.length) throw new Error("email already registered");

    const passwordHash = await bcrypt.hash(String(password), 10);

    const otp = generateOtp6();
    const otpHash = hashOtp(otp);

    const { ttlMinutes } = this._cfg();
    const expires = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const expiresSql = this._toMySqlDate(expires);

    // One pending row per email (requires UNIQUE(email))
    await this.pool.execute(
      `INSERT INTO pending_registrations
        (first_name, last_name, email, password_hash, otp_hash, otp_expires_at,
         attempts, locked_until, verified_at, created_at, terms_accepted_at, terms_version)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, CURRENT_TIMESTAMP, UTC_TIMESTAMP(), 'v1')
       ON DUPLICATE KEY UPDATE
         first_name = VALUES(first_name),
         last_name = VALUES(last_name),
         password_hash = VALUES(password_hash),
         otp_hash = VALUES(otp_hash),
         otp_expires_at = VALUES(otp_expires_at),
         attempts = 0,
         locked_until = NULL,
         verified_at = NULL,
         created_at = CURRENT_TIMESTAMP,
         terms_accepted_at = UTC_TIMESTAMP(),
         terms_version = 'v1'`,
      [firstName || null, lastName || null, cleanEmail, passwordHash, otpHash, expiresSql]
    );

    // Get pending_id reliably for both insert and update cases
    const [rows] = await this.pool.execute(
      `SELECT pending_id FROM pending_registrations WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );

    const pendingId = rows[0].pending_id;

    await this.email.sendOtp(cleanEmail, otp);

    return { pendingId, expiresAt: expires.toISOString() };
  }

  async verify({ pendingId, otp }) {
    if (!pendingId || !otp) throw new Error("pendingId and otp are required");

    const [rows] = await this.pool.execute(
      `SELECT pending_id, first_name, last_name, email, password_hash,
              otp_hash, otp_expires_at, attempts, locked_until, verified_at,
              terms_accepted_at, terms_version
       FROM pending_registrations
       WHERE pending_id = ?
       LIMIT 1`,
      [pendingId]
    );

    if (!rows.length) throw new Error("invalid pendingId");

    const p = rows[0];
    if (p.verified_at) throw new Error("already verified");

    const now = Date.now();

    if (p.locked_until) {
      const lockedUntil = p.locked_until instanceof Date ? p.locked_until : new Date(p.locked_until);
      if (lockedUntil.getTime() > now) throw new Error("too many attempts, try later");
    }

    const exp = p.otp_expires_at instanceof Date ? p.otp_expires_at : new Date(p.otp_expires_at);
    if (exp.getTime() <= now) throw new Error("otp expired");

    const inputHash = hashOtp(otp);
    if (inputHash !== p.otp_hash) {
      const { maxAttempts, lockMinutes } = this._cfg();
      const nextAttempts = Number(p.attempts || 0) + 1;

      let lockUntilSql = null;
      if (nextAttempts >= maxAttempts) {
        lockUntilSql = this._toMySqlDate(new Date(now + lockMinutes * 60 * 1000));
      }

      if (lockUntilSql) {
        await this.pool.execute(
          `UPDATE pending_registrations
           SET attempts = attempts + 1, locked_until = ?
           WHERE pending_id = ?`,
          [lockUntilSql, p.pending_id]
        );
      } else {
        await this.pool.execute(
          `UPDATE pending_registrations
           SET attempts = attempts + 1
           WHERE pending_id = ?`,
          [p.pending_id]
        );
      }

      throw new Error("invalid otp");
    }

    // Correct OTP: create user + user_auth atomically
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

      // re-check email not taken (race safety)
      const [existing] = await conn.execute(
        `SELECT user_id FROM users WHERE email = ? LIMIT 1`,
        [p.email]
      );
      if (existing.length) throw new Error("email already registered");

      const [userRes] = await conn.execute(
        `INSERT INTO users (first_name, last_name, email, created_at, terms_accepted_at, terms_version)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
        [
          p.first_name || null,
          p.last_name || null,
          p.email,
          p.terms_accepted_at || null,
          p.terms_version || "v1",
        ]
      );

      const userId = userRes.insertId;

      await conn.execute(
        `INSERT INTO user_auth (user_id, password_hash, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [userId, p.password_hash]
      );

      await conn.execute(
        `UPDATE pending_registrations
         SET verified_at = UTC_TIMESTAMP()
         WHERE pending_id = ? AND verified_at IS NULL`,
        [p.pending_id]
      );

      await conn.commit();

      const { token, expiresAt } = await this.sessions.createSession({ userId });
      return { userId, token, expiresAt };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
}

module.exports = RegistrationOtpService;
