const { getPool } = require("../db/mysql");

class MySqlConversationRepository {
  async saveConversation(conv) {
    const pool = getPool();

    // Upsert conversation
    await pool.execute(
      `
      INSERT INTO conversations (id, user_id, created_at, meta)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        meta = VALUES(meta)
      `,
      [
        conv.id,
        conv.userId,
        this._toMySqlDate(conv.createdAt),
        JSON.stringify(conv.meta || {}),
      ]
    );

    // Upsert messages
    for (const m of conv.messages || []) {
      await pool.execute(
        `
        INSERT INTO messages (id, conversation_id, role, content, timestamp, meta)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          content = VALUES(content),
          timestamp = VALUES(timestamp),
          meta = VALUES(meta)
        `,
        [
          m.id,
          conv.id,
          m.role,
          m.content,
          this._toMySqlDate(m.timestamp),
          JSON.stringify(m.meta || {}),
        ]
      );
    }
  }

  async loadConversation(conversationId) {
    const pool = getPool();

    const [convRows] = await pool.execute(
      `SELECT id, user_id, created_at, meta FROM conversations WHERE id = ? LIMIT 1`,
      [conversationId]
    );
    if (!convRows.length) return null;

    const conv = convRows[0];

    const [msgRows] = await pool.execute(
      `
      SELECT id, role, content, timestamp, meta
      FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
      `,
      [conversationId]
    );

    return {
      id: conv.id,
      userId: conv.user_id,
      createdAt: this._toIso(conv.created_at),
      meta: this._parseJson(conv.meta),
      messages: msgRows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: this._toIso(m.timestamp),
        meta: this._parseJson(m.meta),
      })),
    };
  }

  _parseJson(v) {
    if (v == null) return {};
    if (typeof v === "object") return v; // mysql2 may already parse JSON depending on config
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }

  _toIso(dt) {
    // dt may be Date or string depending on driver; normalize
    const d = dt instanceof Date ? dt : new Date(dt);
    return d.toISOString();
  }

  _toMySqlDate(isoOrDate) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    // MySQL DATETIME expects "YYYY-MM-DD HH:MM:SS"
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
      d.getUTCHours()
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
}

module.exports = MySqlConversationRepository;
