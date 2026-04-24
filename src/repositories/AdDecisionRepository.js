const { getPool } = require("../db/mysql");

class AdDecisionRepository {
  async insertDecision({ conversationId, snapshotId, chosenAdId = null, traceJson }) {
    const pool = getPool();
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
