const { getPool } = require("../db/mysql");

/*
 * PendingRegistrationRepository
 *
 * Handles database operations for pending user registrations.
 *
 * Purpose:
 * - Store users before OTP verification
 * - Track OTP expiry and verification attempts
 * - Support account lockout after repeated failed OTP attempts
 */
class PendingRegistrationRepository {
  constructor() {
    /*
     * Reuse shared MySQL connection pool.
     */
    this.pool = getPool();
  }

  /*
   * Creates a pending registration record.
   */
  async create({ email, passwordHash, name, otpHash, expiresAtMySql }) {
    const [res] = await this.pool.execute(
      `INSERT INTO pending_registrations
        (email, password_hash, name, otp_hash, otp_expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [email, passwordHash, name || null, otpHash, expiresAtMySql]
    );
    return res.insertId;
  }

  /*
   * Finds a pending registration by ID.
   */
  async findById(pendingId) {
    const [rows] = await this.pool.execute(
      `SELECT pending_id, email, password_hash, name,
              otp_hash, otp_expires_at, attempts, locked_until, verified_at
       FROM pending_registrations
       WHERE pending_id = ?
       LIMIT 1`,
      [pendingId]
    );
    return rows[0] || null;
  }

  /*
   * Marks a pending registration as verified.
   */
  async markVerified(pendingId) {
    await this.pool.execute(
      `UPDATE pending_registrations
       SET verified_at = UTC_TIMESTAMP()
       WHERE pending_id = ? AND verified_at IS NULL`,
      [pendingId]
    );
  }

   /*
   * Increments failed OTP attempt count.
   *
   * If the user reaches the maximum attempt threshold,
   * locked_until can be set to temporarily prevent further attempts.
   */
  async incrementAttemptsAndMaybeLock(pendingId, maxAttempts, lockUntilMySqlOrNull) {
    if (lockUntilMySqlOrNull) {
      await this.pool.execute(
        `UPDATE pending_registrations
         SET attempts = attempts + 1, locked_until = ?
         WHERE pending_id = ?`,
        [lockUntilMySqlOrNull, pendingId]
      );
      return;
    }
    await this.pool.execute(
      `UPDATE pending_registrations 
       SET attempts = attempts + 1
       WHERE pending_id = ?`,
      [pendingId]
    );
  }

  /*
   * Updates OTP hash and expiry time.
   *
   * Also resets failed attempts and lockout state so a new OTP starts
   * a fresh verification window.
   */
  async updateOtp(pendingId, otpHash, expiresAtMySql) {
    await this.pool.execute(
      `UPDATE pending_registrations
       SET otp_hash = ?, otp_expires_at = ?, attempts = 0, locked_until = NULL
       WHERE pending_id = ? AND verified_at IS NULL`,
      [otpHash, expiresAtMySql, pendingId]
    );
  }
}

module.exports = PendingRegistrationRepository;
