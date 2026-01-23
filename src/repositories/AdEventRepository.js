const { getPool } = require("../db/mysql");

class AdEventRepository {
  async logEvent({ conversationId, snapshotId = null, adId = null, eventType, eventMeta = null }) {
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
}

module.exports = AdEventRepository;
