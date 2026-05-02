const crypto = require("crypto");
const { getPool } = require("../db/mysql");

/*
 * SessionService
 *
 * Manages user authentication sessions using refresh tokens.
 *
 * Responsibilities:
 * - Generate secure session tokens
 * - Store hashed tokens in the database
 * - Validate active sessions
 * - Expire and delete sessions
 */
class SessionService {
  constructor() {
    /*
     * Shared MySQL connection pool for session persistence.
     */
    this.pool = getPool();
  }

  /*
   * Hashes a raw token using SHA-256 before storing or comparing.
   *
   * Important:
   * - Raw tokens are NEVER stored in the database.
   * - Only hashed versions are persisted (security best practice).
   */
  _hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

   /*
   * Converts a JavaScript Date object into MySQL datetime format (UTC).
   */
  _toMySqlDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours()
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  /*
   * Generates a cryptographically secure random token.
   *
   * - 32 bytes → 64-character hex string
   * - Used as a refresh/session token
   */
  generateToken() {
    // 32 bytes random -> 64 hex chars
    return crypto.randomBytes(32).toString("hex");
  }

   /*
   * Creates or updates a user session.
   *
   * Behaviour:
   * - If a session already exists → update token + expiry
   * - Otherwise → create a new session row
   *
   * Returns:
   * - raw token (sent to client)
   * - expiry timestamp
   */
  async createSession({ userId, ttlHours = 24 }) {
     /*
     * Generate a new secure token and hash it before storage.
     */
    const token = this.generateToken();
    const tokenHash = this._hashToken(token);

      /*
     * Calculate expiration time based on TTL.
     */
    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    /*
     * Check if a session already exists for this user.
     * (Current design: one active session per user)
     */
    const [existingSession] = await this.pool.execute(
      `SELECT session_id FROM login_sessions WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (existingSession.length) {
      /*
       * Update existing session:
       * - Replace token hash
       * - Refresh expiry
       * - Update creation timestamp
       */
      await this.pool.execute(
      `UPDATE login_sessions SET refresh_token_hash = ?, expires_at = ?, created_at = NOW() WHERE user_id = ?`,
      [tokenHash, this._toMySqlDate(expires), userId]
      );
    } else {

       /*
       * Create new session record.
       */
      await this.pool.execute(
      `INSERT INTO login_sessions (user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [userId, tokenHash, this._toMySqlDate(expires)]
      );
    }

       /*
     * Return raw token to client (only time it is exposed).
     */
    return { token, expiresAt: expires.toISOString() };
  }


    /*
   * Retrieves and validates a session using the raw token.
   *
   * Steps:
   * - Hash incoming token
   * - Look up matching session
   * - Check expiry
   * - Delete if expired
   */
  async getSessionByToken(token) {

     /*
     * Hash token to match stored hash.
     */
    const tokenHash = this._hashToken(token);

    const [rows] = await this.pool.execute(
      `SELECT session_id, user_id, expires_at
       FROM login_sessions
       WHERE refresh_token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

     /*
     * No matching session → invalid token.
     */
    if (!rows.length) return null;

    const s = rows[0];

    /*
     * Normalize expiry date (handle both Date and string).
     */
    const expiresAt = s.expires_at instanceof Date ? s.expires_at : new Date(s.expires_at);

    /*
     * If expired:
     * - delete session from DB
     * - treat as invalid
     */
    if (expiresAt.getTime() <= Date.now()) {
      // expired -> delete
      await this.pool.execute(`DELETE FROM login_sessions WHERE session_id = ?`, [s.session_id]);
      return null;
    }

    /*
     * Return valid session details.
     */
    return { sessionId: s.session_id, userId: s.user_id, expiresAt: expiresAt.toISOString() };
  }

  /*
   * Deletes a session using the raw token.
   *
   * Used for:
   * - Logout
   * - Token invalidation
   */
  async deleteSessionByToken(token) {
    const tokenHash = this._hashToken(token);
    await this.pool.execute(`DELETE FROM login_sessions WHERE refresh_token_hash = ?`, [tokenHash]);
  }
}

module.exports = SessionService;