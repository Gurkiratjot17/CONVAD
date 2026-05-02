const { getPool } = require("../db/mysql");

/*
 * ContextSnapshotRepository
 *
 * Persists contextual snapshots used during ad selection.
 *
 * Purpose:
 * - Store the conversation context at the moment an ad decision is made
 * - Support explainability and audit trails
 * - Allow later evaluation of why specific ads were selected
 */
class ContextSnapshotRepository {

  /*
   * Inserts a new context snapshot for a conversation turn.
   *
   * Stored fields include:
   * - structured context JSON
   * - raw context text
   * - optional embedding data
   * - optional safety flags
   */
  async insertSnapshot({
    conversationId,
    turnIndex,
    contextJson,
    contextText,
    embeddingJson = null,
    safetyFlagsJson = null,
  }) {
    const pool = getPool();

    /*
     * Store JSON fields using MySQL JSON casting.
     *
     * This keeps context data structured and queryable while preserving
     * the exact state used during decision-making.
     */
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

  /*
   * Retrieves the latest context snapshot for a conversation.
   *
   * Useful for debugging, analytics, or reviewing the most recent
   * context used by the ad-selection system.
   */
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
