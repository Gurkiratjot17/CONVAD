const crypto = require("crypto");
const { getPool } = require("../db/mysql");

class SessionService {
  constructor() {
    this.pool = getPool();
  }

  _hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  _toMySqlDate(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours()
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }

  generateToken() {
    // 32 bytes random -> 64 hex chars
    return crypto.randomBytes(32).toString("hex");
  }

  async createSession({ userId, ttlHours = 24 }) {
    const token = this.generateToken();
    const tokenHash = this._hashToken(token);

    const expires = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const [existingSession] = await this.pool.execute(
      `SELECT session_id FROM login_sessions WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    if (existingSession.length) {
      await this.pool.execute(
      `UPDATE login_sessions SET refresh_token_hash = ?, expires_at = ?, created_at = NOW() WHERE user_id = ?`,
      [tokenHash, this._toMySqlDate(expires), userId]
      );
    } else {
      await this.pool.execute(
      `INSERT INTO login_sessions (user_id, refresh_token_hash, expires_at)
       VALUES (?, ?, ?)`,
      [userId, tokenHash, this._toMySqlDate(expires)]
      );
    }

    return { token, expiresAt: expires.toISOString() };
  }

  async getSessionByToken(token) {
    const tokenHash = this._hashToken(token);

    const [rows] = await this.pool.execute(
      `SELECT session_id, user_id, expires_at
       FROM login_sessions
       WHERE refresh_token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    if (!rows.length) return null;

    const s = rows[0];
    const expiresAt = s.expires_at instanceof Date ? s.expires_at : new Date(s.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      // expired -> delete
      await this.pool.execute(`DELETE FROM login_sessions WHERE session_id = ?`, [s.session_id]);
      return null;
    }

    return { sessionId: s.session_id, userId: s.user_id, expiresAt: expiresAt.toISOString() };
  }

  async deleteSessionByToken(token) {
    const tokenHash = this._hashToken(token);
    await this.pool.execute(`DELETE FROM login_sessions WHERE refresh_token_hash = ?`, [tokenHash]);
  }
}

module.exports = SessionService;