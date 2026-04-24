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

    // Normalize to avoid case drift bugs (you use IMPRESSION_RENDERED)
    const et = String(eventType || "").trim().toUpperCase();

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
        et,
        eventMeta ? JSON.stringify(eventMeta) : null,
      ]
    );
    return res.insertId;
  }

  /**
   * Used by IntentPolicyGate for frequency caps (ROLLING WINDOW).
   *
   * Caps are based on what the user actually saw:
   *   event_type = 'IMPRESSION_RENDERED'
   *
   * Params:
   *  - opts.minTurnIndex: if provided, count only renders with turn_index >= minTurnIndex
   *
   * Returns:
   *  {
   *    totalRenderedAdsWindow: number,
   *    lastRenderedTurn: number|null,
   *    lastRenderedAt: string|null
   *  }
   *
   * Notes:
   * - Best path uses snapshot join to filter by turn_index.
   * - If snapshot join isn't available, we degrade gracefully:
   *     - window count falls back to counting all renders (still safe, just less precise)
   *     - lastRenderedTurn may be null
   */
  async getConversationAdStats(conversationId, opts = {}) {
    const pool = getPool();
    const RENDERED_EVENT = "IMPRESSION_RENDERED";
    const minTurnIndex =
      opts && opts.minTurnIndex != null ? Number(opts.minTurnIndex) : null;

    // 1) Latest render timestamp (no joins needed)
    let lastRenderedAt = null;
    try {
      const [rows] = await pool.execute(
        `
        SELECT MAX(created_at) AS last_at
        FROM ad_events
        WHERE conversation_id = ?
          AND event_type = ?
        `,
        [conversationId, RENDERED_EVENT]
      );
      lastRenderedAt = rows?.[0]?.last_at || null;
    } catch (e) {
      console.warn(
        "[AdEventRepository] getConversationAdStats lastRenderedAt failed:",
        e?.message || e
      );
      lastRenderedAt = null;
    }

    // 2) Window count + last turn (prefer snapshot join so window is truly "last N turns")
    let totalRenderedAdsWindow = 0;
    let lastRenderedTurn = null;

    // Try: conversation_context_snapshots
    try {
      const [rows] = await pool.execute(
        `
        SELECT
          COUNT(*) AS c,
          MAX(ccs.turn_index) AS last_turn
        FROM ad_events ae
        JOIN conversation_context_snapshots ccs
          ON ccs.snapshot_id = ae.snapshot_id
        WHERE ae.conversation_id = ?
          AND ae.event_type = ?
          AND (? IS NULL OR ccs.turn_index >= ?)
        `,
        [conversationId, RENDERED_EVENT, minTurnIndex, minTurnIndex]
      );

      totalRenderedAdsWindow = Number(rows?.[0]?.c) || 0;

      const v = rows?.[0]?.last_turn;
      lastRenderedTurn = v === null || v === undefined ? null : Number(v);
      if (!Number.isFinite(lastRenderedTurn)) lastRenderedTurn = null;
    } catch (e1) {
      // Fallback: context_snapshots
      try {
        const [rows2] = await pool.execute(
          `
          SELECT
            COUNT(*) AS c,
            MAX(cs.turn_index) AS last_turn
          FROM ad_events ae
          JOIN context_snapshots cs
            ON cs.snapshot_id = ae.snapshot_id
          WHERE ae.conversation_id = ?
            AND ae.event_type = ?
            AND (? IS NULL OR cs.turn_index >= ?)
          `,
          [conversationId, RENDERED_EVENT, minTurnIndex, minTurnIndex]
        );

        totalRenderedAdsWindow = Number(rows2?.[0]?.c) || 0;

        const v2 = rows2?.[0]?.last_turn;
        lastRenderedTurn = v2 === null || v2 === undefined ? null : Number(v2);
        if (!Number.isFinite(lastRenderedTurn)) lastRenderedTurn = null;
      } catch (e2) {
        // Degrade gracefully: count without turn window (still prevents "stuck forever")
        try {
          const [countRows] = await pool.execute(
            `
            SELECT COUNT(*) AS c
            FROM ad_events
            WHERE conversation_id = ?
              AND event_type = ?
            `,
            [conversationId, RENDERED_EVENT]
          );
          totalRenderedAdsWindow = Number(countRows?.[0]?.c) || 0;
        } catch (e3) {
          console.warn(
            "[AdEventRepository] getConversationAdStats fallback count failed:",
            e3?.message || e3
          );
          totalRenderedAdsWindow = 0;
        }

        console.warn(
          "[AdEventRepository] getConversationAdStats snapshot join failed (ok if snapshot table name differs):",
          e2?.message || e2
        );
        lastRenderedTurn = null;
      }
    }

    return { totalRenderedAdsWindow, lastRenderedTurn, lastRenderedAt };
  }
}

module.exports = AdEventRepository;