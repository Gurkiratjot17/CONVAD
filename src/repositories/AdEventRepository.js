// src/repositories/AdEventRepository.js
const { getPool } = require("../db/mysql");

class AdEventRepository {
  async logEvent({
    conversationId,
    snapshotId = null,
    adId = null,
    eventType,
    eventMeta = null,
  }) {
    const pool = getPool();
    const [res] = await pool.execute(
      `
      INSERT INTO ad_events
        (conversation_id, snapshot_id, ad_id, event_type, event_meta)
      VALUES (?, ?, ?, ?, CAST(? AS JSON))
      `,
      [
        conversationId,
        snapshotId,
        adId,
        String(eventType),
        eventMeta ? JSON.stringify(eventMeta) : null,
      ]
    );
    return res.insertId;
  }

  /**
   * NEW: Used by IntentPolicyGate for frequency caps.
   *
   * Returns:
   *  {
   *    totalAds: number,       // total impression_selected in this conversation
   *    lastAdTurn: number|null // latest turn_index (via snapshot join) if available
   *  }
   *
   * Notes:
   * - We try joining on the most likely snapshot table name:
   *     conversation_context_snapshots(snapshot_id, turn_index)
   * - If that table doesn't exist in your schema, we degrade gracefully:
   *     lastAdTurn = null (but totalAds still works)
   */
  async getConversationAdStats(conversationId) {
    const pool = getPool();

    // 1) Count impressions (should work regardless of snapshot table name)
    let totalAds = 0;
    try {
      const [countRows] = await pool.execute(
        `
        SELECT COUNT(*) AS c
        FROM ad_events
        WHERE conversation_id = ?
          AND event_type = 'impression_selected'
        `,
        [conversationId]
      );
      totalAds = Number(countRows?.[0]?.c) || 0;
    } catch (e) {
      console.warn("[AdEventRepository] getConversationAdStats count failed:", e?.message || e);
      totalAds = 0;
    }

    // 2) Get lastAdTurn using snapshot join (best signal)
    let lastAdTurn = null;

    // Try: conversation_context_snapshots
    try {
      const [rows] = await pool.execute(
        `
        SELECT MAX(ccs.turn_index) AS last_turn
        FROM ad_events ae
        JOIN conversation_context_snapshots ccs
          ON ccs.snapshot_id = ae.snapshot_id
        WHERE ae.conversation_id = ?
          AND ae.event_type = 'impression_selected'
        `,
        [conversationId]
      );

      const v = rows?.[0]?.last_turn;
      lastAdTurn = v === null || v === undefined ? null : Number(v);
      if (!Number.isFinite(lastAdTurn)) lastAdTurn = null;
    } catch (e1) {
      // Fallback: context_snapshots
      try {
        const [rows2] = await pool.execute(
          `
          SELECT MAX(cs.turn_index) AS last_turn
          FROM ad_events ae
          JOIN context_snapshots cs
            ON cs.snapshot_id = ae.snapshot_id
          WHERE ae.conversation_id = ?
            AND ae.event_type = 'impression_selected'
          `,
          [conversationId]
        );

        const v2 = rows2?.[0]?.last_turn;
        lastAdTurn = v2 === null || v2 === undefined ? null : Number(v2);
        if (!Number.isFinite(lastAdTurn)) lastAdTurn = null;
      } catch (e2) {
        // Degrade gracefully
        console.warn(
          "[AdEventRepository] getConversationAdStats lastAdTurn join failed (ok if snapshot table name differs):",
          e2?.message || e2
        );
        lastAdTurn = null;
      }
    }

    return { totalAds, lastAdTurn };
  }
}

module.exports = AdEventRepository;
