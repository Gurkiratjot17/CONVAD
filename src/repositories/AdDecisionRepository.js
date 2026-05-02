const { getPool } = require("../db/mysql");

/*
 * Repository responsible for persisting ad selection decisions.
 *
 * Each decision represents:
 * - The context snapshot used
 * - The chosen ad (if any)
 * - A full trace of how the decision was made
 */
class AdDecisionRepository {

  /*
   * Inserts a new ad decision record.
   *
   * Parameters:
   * - conversationId → conversation in which decision occurred
   * - snapshotId → reference to context snapshot used for this decision
   * - chosenAdId → selected ad (nullable if no ad selected)
   * - traceJson → full decision trace (pipeline, scores, reasoning)
   *
   * Returns:
   * - decisionId (primary key)
   */
  async insertDecision({ conversationId, snapshotId, chosenAdId = null, traceJson }) {
    const pool = getPool();
    /*
     * Store decision with structured trace JSON for:
     * - explainability
     * - auditing
     * - evaluation analysis
     */
    const [res] = await pool.execute(
      `
      INSERT INTO ad_decisions
        (conversation_id, snapshot_id, chosen_ad_id, trace_json)
      VALUES (?, ?, ?, CAST(? AS JSON))
      `,
      [
        conversationId,
        snapshotId,
        chosenAdId,
        JSON.stringify(traceJson || {}),
      ]
    );
    return res.insertId;
  }
}

module.exports = AdDecisionRepository;
