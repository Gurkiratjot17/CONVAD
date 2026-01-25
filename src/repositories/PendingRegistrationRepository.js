const { getPool } = require("../db/mysql");

class PendingRegistrationRepository {
  constructor() {
    this.pool = getPool();
  }

  async create({ email, passwordHash, name, otpHash, expiresAtMySql }) {
    const [res] = await this.pool.execute(
      `INSERT INTO pending_registrations
        (email, password_hash, name, otp_hash, otp_expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [email, passwordHash, name || null, otpHash, expiresAtMySql]
    );
    return res.insertId;
  }

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

  async markVerified(pendingId) {
    await this.pool.execute(
      `UPDATE pending_registrations
       SET verified_at = UTC_TIMESTAMP()
       WHERE pending_id = ? AND verified_at IS NULL`,
      [pendingId]
    );
  }

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
