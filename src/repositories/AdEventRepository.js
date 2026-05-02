// src/repositories/AdEventRepository.js
const { getPool } = require("../db/mysql");

/*
 * Repository responsible for logging and retrieving advertisement-related events.
 *
 * These events are critical for:
 * - Analytics (CTR, impressions, trends)
 * - Policy enforcement (frequency capping)
 * - Evaluation (user interaction analysis)
 */
class AdEventRepository {

   /*
   * Logs an advertisement-related event.
   *
   * Parameters:
   * - conversationId → conversation where event occurred
   * - snapshotId → context snapshot reference (optional)
   * - adId → associated ad (nullable for system events)
   * - eventType → type of event (e.g., CLICK, HIDE, IMPRESSION_RENDERED)
   * - eventMeta → additional metadata (JSON)
   *
   * Returns:
   * - eventId (primary key)
   */
  async logEvent({
    conversationId,
    snapshotId = null,
    adId = null,
    eventType,
    eventMeta = null,
  }) {
    const pool = getPool();

    /*
     * Normalize event type to uppercase to avoid inconsistencies
     * (important for analytics queries and policy logic).
     */
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

  /*
   * Computes conversation-level ad statistics.
   *
   * Used by IntentPolicyGate for frequency control.
   *
   * Key principle:
   * - Only considers IMPRESSION_RENDERED (what user actually saw)
   *
   * Parameters:
   * - conversationId
   * - opts.minTurnIndex → limits stats to recent turns (rolling window)
   *
   * Returns:
   * {
   *   totalRenderedAdsWindow → number of rendered ads in window
   *   lastRenderedTurn → last turn index where an ad was shown
   *   lastRenderedAt → timestamp of last rendered ad
   * }
   *
   * Design approach:
   * - Prefer accurate join with snapshot table (turn-aware)
   * - Fall back gracefully if schema differs or fails
   */
  async getConversationAdStats(conversationId, opts = {}) {
    const pool = getPool();

     /*
     * Constant representing the "visible exposure" signal.
     */
    const RENDERED_EVENT = "IMPRESSION_RENDERED";
    const minTurnIndex =
      opts && opts.minTurnIndex != null ? Number(opts.minTurnIndex) : null;

    /*
     * 1) Get latest render timestamp.
     * No joins required → fast and reliable.
     */
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

    /*
     * 2) Compute rolling window count + last rendered turn.
     * Prefer joining with snapshot table for accurate turn-based filtering.
     */
    let totalRenderedAdsWindow = 0;
    let lastRenderedTurn = null;

    /*
     * Attempt 1: join with conversation_context_snapshots (preferred schema).
     */
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

      /*
       * Attempt 2: fallback schema (context_snapshots).
       */
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
        
        /*
         * Attempt 3: degrade gracefully (no turn-awareness).
         * Still safe for frequency capping, but less precise.
         */
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