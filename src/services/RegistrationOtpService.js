const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("./SessionService");
const EmailService = require("./EmailService");
const { generateOtp6, hashOtp } = require("../utils/otp");

/*
 * Validates email format before registration begins.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/*
 * Enforces minimum password complexity for account creation.
 */
function isStrongPassword(password) {
  if (typeof password !== "string") return false;
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

/*
 * RegistrationOtpService
 *
 * Handles email-verified user registration.
 *
 * Responsibilities:
 * - Validate registration input
 * - Store pending registrations
 * - Generate and resend OTPs
 * - Verify OTPs
 * - Create final user accounts and sessions
 */
class RegistrationOtpService {
  constructor() {
     /*
     * Database connection pool and supporting services.
     */
    this.pool = getPool();
    this.sessions = new SessionService();
    this.email = new EmailService();
  }

    /*
   * Centralised OTP and terms configuration.
   *
   * Environment variables allow behaviour to be adjusted without code changes.
   */
  _cfg() {
    return {
      ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
      maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
      lockMinutes: Number(process.env.OTP_LOCK_MINUTES || 15),

      resendMinSeconds: Number(process.env.OTP_RESEND_MIN_SECONDS || 30),
      resendMax: Number(process.env.OTP_RESEND_MAX || 5),

      termsVersion: String(process.env.TERMS_VERSION || "v1"),
    };
  }

   /*
   * Converts JavaScript Date objects into MySQL datetime format.
   */
  _toMySqlDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours()
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

   /*
   * Starts the registration process by validating details,
   * storing a pending registration, and sending an OTP.
   */
  async start({ firstName, lastName, email, password, acceptTerms }) {
     /*
     * Required input validation.
     */
    if (!email || !password) throw new Error("email and password are required");
    if (!acceptTerms) throw new Error("you must accept the terms and conditions");

    /*
     * Normalise and validate email/password before database operations.
     */
    const cleanEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) throw new Error("invalid email format");
    if (!isStrongPassword(password)) {
      throw new Error(
        "password must be at least 8 characters and include uppercase, lowercase, number, and symbol"
      );
    }

     /*
     * Prevent duplicate registration for an existing account.
     */
    const [existing] = await this.pool.execute(
      `SELECT user_id FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );
    if (existing.length) throw new Error("email already registered");

    /*
     * Hash password before storing it in the pending registration table.
     */
    const passwordHash = await bcrypt.hash(String(password), 10);

    /*
     * Generate OTP and store only its hash.
     */
    const otp = generateOtp6();
    const otpHash = hashOtp(otp);

    /*
     * Calculate OTP expiry timestamp.
     */
    const { ttlMinutes, termsVersion } = this._cfg();
    const expires = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const expiresSql = this._toMySqlDate(expires);

     // One pending row per email (UNIQUE(email))
    /*
     * Insert or refresh the pending registration for this email.
     *
     * This allows a user to restart registration without creating duplicate
     * pending rows.
     */
    await this.pool.execute(
      `INSERT INTO pending_registrations
        (first_name, last_name, email, password_hash, otp_hash, otp_expires_at,
         attempts, locked_until, verified_at, created_at, terms_accepted_at, terms_version,
         last_otp_sent_at, resend_count)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, CURRENT_TIMESTAMP, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), 0)
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
         terms_version = VALUES(terms_version),
         last_otp_sent_at = UTC_TIMESTAMP(),
         resend_count = 0`,
      [firstName || null, lastName || null, cleanEmail, passwordHash, otpHash, expiresSql, termsVersion]
    );

     /*
     * Retrieve pending registration ID for frontend verification flow.
     */
    const [rows] = await this.pool.execute(
      `SELECT pending_id FROM pending_registrations WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );

    const pendingId = rows[0].pending_id;

     /*
     * Send OTP to the user's email address.
     */
    await this.email.sendOtp(cleanEmail, otp);

    return { pendingId, expiresAt: expires.toISOString() };
  }

  /*
   * Sends a new OTP for an existing pending registration.
   */
  async resend({ pendingId }) {
    if (!pendingId) throw new Error("pendingId is required");

    const { ttlMinutes, resendMinSeconds, resendMax } = this._cfg();

      /*
     * Load pending registration state needed for resend checks.
     */
    const [rows] = await this.pool.execute(
      `SELECT pending_id, email, verified_at, locked_until,
              last_otp_sent_at, resend_count
       FROM pending_registrations
       WHERE pending_id = ?
       LIMIT 1`,
      [pendingId]
    );

    if (!rows.length) throw new Error("invalid pendingId");

    const p = rows[0];

     /*
     * Do not resend OTPs for already verified registrations.
     */
    if (p.verified_at) throw new Error("already verified");

    const now = Date.now();

     /*
     * Respect lockout period caused by too many failed verification attempts.
     */
    if (p.locked_until) {
      const lockedUntil = p.locked_until instanceof Date ? p.locked_until : new Date(p.locked_until);
      if (lockedUntil.getTime() > now) throw new Error("too many attempts, try later");
    }

    // rate-limit: minimum seconds between resends
    if (p.last_otp_sent_at) {
      const lastSent = p.last_otp_sent_at instanceof Date ? p.last_otp_sent_at : new Date(p.last_otp_sent_at);
      const diffSec = Math.floor((now - lastSent.getTime()) / 1000);
      if (diffSec < resendMinSeconds) {
        throw new Error(`Please wait ${resendMinSeconds - diffSec}s before resending`);
      }
    }

    // rate-limit: max resends
    const count = Number(p.resend_count || 0);
    if (count >= resendMax) {
      throw new Error("resend limit reached, please try again later");
    }

    const otp = generateOtp6();
    const otpHash = hashOtp(otp);
    const expires = new Date(now + ttlMinutes * 60 * 1000);

    /*
     * Store new OTP hash and increment resend counter.
     */
    await this.pool.execute(
      `UPDATE pending_registrations
       SET otp_hash = ?,
           otp_expires_at = ?,
           last_otp_sent_at = UTC_TIMESTAMP(),
           resend_count = resend_count + 1
       WHERE pending_id = ? AND verified_at IS NULL`,
      [otpHash, this._toMySqlDate(expires), p.pending_id]
    );

     /*
     * Send the newly generated OTP.
     */
    await this.email.sendOtp(p.email, otp);

    return { pendingId: p.pending_id, expiresAt: expires.toISOString() };
  }

   /*
   * Verifies the submitted OTP and creates the final user account.
   */
  async verify({ pendingId, otp }) {
    if (!pendingId || !otp) throw new Error("pendingId and otp are required");

      /*
     * Load pending registration details needed for OTP validation and account creation.
     */
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

     /*
     * Prevent repeated verification after account creation.
     */
    if (p.verified_at) throw new Error("already verified");

    const now = Date.now();

     /*
     * Block verification attempts during lockout.
     */
    if (p.locked_until) {
      const lockedUntil = p.locked_until instanceof Date ? p.locked_until : new Date(p.locked_until);
      if (lockedUntil.getTime() > now) throw new Error("too many attempts, try later");
    }

    /*
     * Reject expired OTPs.
     */
    const exp = p.otp_expires_at instanceof Date ? p.otp_expires_at : new Date(p.otp_expires_at);
    if (exp.getTime() <= now) throw new Error("otp expired");

     /*
     * Compare submitted OTP hash with stored OTP hash.
     */
    const inputHash = hashOtp(otp);
    if (inputHash !== p.otp_hash) {
      const { maxAttempts, lockMinutes } = this._cfg();
      const nextAttempts = Number(p.attempts || 0) + 1;

      /*
       * Lock account temporarily after too many failed attempts.
       */
      let lockUntilSql = null;
      if (nextAttempts >= maxAttempts) {
        lockUntilSql = this._toMySqlDate(new Date(now + lockMinutes * 60 * 1000));
      }

         /*
       * Update attempt count and optionally set lockout timestamp.
       */
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

      /*
     * Account creation is transactional so users and authentication records
     * are created consistently.
     */
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();

         /*
       * Re-check email uniqueness inside the transaction to avoid race conditions.
       */
      const [existing] = await conn.execute(
        `SELECT user_id FROM users WHERE email = ? LIMIT 1`,
        [p.email]
      );
      if (existing.length) throw new Error("email already registered");

        /*
       * Create user profile record.
       */
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

      /*
       * Store authentication credentials separately from user profile data.
       */
      await conn.execute(
        `INSERT INTO user_auth (user_id, password_hash, created_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [userId, p.password_hash]
      );


     /*
       * Mark the pending registration as verified.
       */
      await conn.execute(
        `UPDATE pending_registrations
         SET verified_at = UTC_TIMESTAMP()
         WHERE pending_id = ? AND verified_at IS NULL`,
        [p.pending_id]
      );

        /*
       * Commit account creation before creating the login session.
       */
      await conn.commit();

      /*
       * Create authenticated session after successful verification.
       */
      const { token, expiresAt } = await this.sessions.createSession({ userId });
      return { userId, token, expiresAt };
    } catch (e) {
       /*
       * Roll back if any part of account creation fails.
       */
      await conn.rollback();
      throw e;
    } finally {
       /*
       * Always release the database connection back to the pool.
       */
      conn.release();
    }
  }
}

module.exports = RegistrationOtpService;
