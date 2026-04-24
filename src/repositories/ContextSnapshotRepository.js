const { getPool } = require("../db/mysql");

class ContextSnapshotRepository {
  async insertSnapshot({
    conversationId,
    turnIndex,
    contextJson,
    contextText,
    embeddingJson = null,
    safetyFlagsJson = null,
  }) {
    const pool = getPool();
    const [res] = await pool.execute(
      `
      INSERT INTO conversation_context_snapshots
        (conversation_id, turn_index, context_json, context_text, embedding_json, safety_flags_json)
      VALUES (?, ?, CAST(? AS JSON), ?, CAST(? AS JSON), CAST(? AS JSON))
      `,
      [
        conversationId,
        Number(turnIndex),
        JSON.stringify(contextJson || {}),
        String(contextText || ""),
        embeddingJson ? JSON.stringify(embeddingJson) : null,
        safetyFlagsJson ? JSON.stringify(safetyFlagsJson) : null,
      ]
    );
    return res.insertId;
  }

  async getLatestSnapshot(conversationId) {
    const pool = getPool();
    const [rows] = await pool.execute(
      `
      SELECT snapshot_id, conversation_id, turn_index, context_json, context_text, embedding_json, safety_flags_json, created_at
      FROM conversation_context_snapshots
      WHERE conversation_id = ?
      ORDER BY snapshot_id DESC
      LIMIT 1
      `,
      [conversationId]
    );
    if (!rows.length) return null;
    return rows[0];
  }
}

module.exports = ContextSnapshotRepository;
