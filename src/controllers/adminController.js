const { getPool } = require("../db/mysql"); // adjust if your mysql pool path differs

function safeInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : d;
}

function tokenizeText(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","else","when","while","is","are","was","were",
  "to","of","in","on","for","with","as","at","by","from","it","this","that","these","those",
  "i","you","we","they","he","she","my","your","our","their","me","him","her","them",
  "can","could","should","would","will","just","not","no","yes","do","does","did",
  "about","into","over","under","more","most","very"
]);

function topTerms(tokens, { minLen = 3, topN = 12 } = {}) {
  const freq = new Map();
  for (const t of tokens) {
    if (t.length < minLen) continue;
    if (STOPWORDS.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([term, count]) => ({ term, count }));
}

function extractKeywordsFromTrace(traceJson) {
  const bag = [];
  const pushArr = (x) => Array.isArray(x) && x.forEach(v => v && bag.push(String(v)));
  if (!traceJson || typeof traceJson !== "object") return [];
  pushArr(traceJson.keywords);
  pushArr(traceJson.query_terms);
  pushArr(traceJson.tags);
  pushArr(traceJson.intent_tags);
  if (traceJson.context && typeof traceJson.context === "object") {
    pushArr(traceJson.context.keywords);
    pushArr(traceJson.context.tags);
  }
  return bag;
}

module.exports = {
  async listAds(req, res) {
    const pool = getPool();
    const q = (req.query.q || "").trim();
    const status = (req.query.status || "").trim();
    const limit = Math.max(1, Math.min(500, safeInt(req.query.limit, 60)));
    const offset = Math.max(0, safeInt(req.query.offset, 0));

    const where = [];
    const params = [];

    if (q) {
      where.push("(a.ad_id LIKE ? OR a.title LIKE ? OR a.description LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (status) {
      where.push("a.status = ?");
      params.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [ads] = await pool.execute(
      `
      SELECT
        a.ad_id, a.title, a.description, a.image_url, a.landing_url, a.status,
        aci.safety_category, aci.geo_scope, aci.price_tier
      FROM ads a
      LEFT JOIN ad_context_index aci ON aci.ad_id = a.ad_id
      ${whereSql}
      ORDER BY a.ad_id DESC
      LIMIT ${limit} OFFSET ${offset}
      `,
      params
    );

    res.json({ ads, limit, offset });
  },

  async getAd(req, res) {
    const pool = getPool();
    const adId = safeInt(req.params.adId);

    const [rows] = await pool.execute(
      `
      SELECT
        a.ad_id, a.title, a.description, a.image_url, a.landing_url, a.status,
        aci.safety_category, aci.geo_scope, aci.price_tier, aci.ad_text, aci.updated_at
      FROM ads a
      LEFT JOIN ad_context_index aci ON aci.ad_id = a.ad_id
      WHERE a.ad_id = ?
      LIMIT 1
      `,
      [adId]
    );

    const ad = rows[0];
    if (!ad) return res.status(404).json({ error: "Ad not found" });
    res.json({ ad });
  },

  async updateAd(req, res) {
    const pool = getPool();
    const adId = safeInt(req.params.adId);

    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const image_url = String(req.body.image_url || "").trim();
    const landing_url = String(req.body.landing_url || "").trim();
    const status = String(req.body.status || "ACTIVE").trim();

    if (!title) return res.status(400).json({ error: "Title required" });
    if (!image_url) return res.status(400).json({ error: "Image URL required" });
    if (!landing_url) return res.status(400).json({ error: "Landing URL required" });

    const [result] = await pool.execute(
      `
      UPDATE ads
      SET title = ?, description = ?, image_url = ?, landing_url = ?, status = ?
      WHERE ad_id = ?
      `,
      [title, description, image_url, landing_url, status, adId]
    );

    res.json({ updated: result.affectedRows || 0 });
  },

  async getAdAnalytics(req, res) {
    const pool = getPool();
    const adId = safeInt(req.params.adId);
    const days = Math.max(1, Math.min(365, safeInt(req.query.days, 30)));

    const [[kpi]] = await pool.execute(
      `
      SELECT
        SUM(event_type='IMPRESSION_SELECTED') AS impressions,
        SUM(event_type='CLICK') AS clicks,
        SUM(event_type='HIDE') AS dismisses,
        CASE WHEN SUM(event_type='IMPRESSION_SELECTED') = 0 THEN 0
             ELSE SUM(event_type='CLICK') / SUM(event_type='IMPRESSION_SELECTED') END AS ctr
      FROM ad_events
      WHERE ad_id = ?
        AND created_at >= NOW() - INTERVAL ${days} DAY
      `,
      [adId]
    );

    const [daily] = await pool.execute(
      `
      SELECT
        DATE(created_at) AS day,
        SUM(event_type='IMPRESSION_SELECTED') AS impressions,
        SUM(event_type='CLICK') AS clicks,
        SUM(event_type='HIDE') AS dismisses
      FROM ad_events
      WHERE ad_id = ?
        AND created_at >= NOW() - INTERVAL ${days} DAY
      GROUP BY DATE(created_at)
      ORDER BY day DESC
      `,
      [adId]
    );

    const [contexts] = await pool.execute(
      `
      SELECT
        e.created_at AS event_time,
        s.snapshot_id, s.turn_index,
        LEFT(s.context_text, 260) AS context_preview,
        c.conversation_id, c.title AS conversation_title
      FROM ad_events e
      JOIN conversation_context_snapshots s ON s.snapshot_id = e.snapshot_id
      JOIN conversations c ON c.conversation_id = e.conversation_id
      WHERE e.ad_id = ?
        AND e.event_type = 'IMPRESSION_SELECTED'
        AND e.created_at >= NOW() - INTERVAL ${days} DAY
      ORDER BY e.created_at DESC
      LIMIT 50
      `,
      [adId]
    );

    const [traces] = await pool.execute(
      `
      SELECT decision_id, created_at, trace_json
      FROM ad_decisions
      WHERE chosen_ad_id = ?
        AND created_at >= NOW() - INTERVAL ${days} DAY
      ORDER BY created_at DESC
      LIMIT 10
      `,
      [adId]
    );

    res.json({ kpi: kpi || {}, daily, contexts, traces });
  },

  // Admin snapshot metrics for dashboards/evaluation
  async getMetrics(req, res) {
    const pool = getPool();
    const days = Math.max(1, Math.min(365, safeInt(req.query.days, 7)));

    const [[adsAgg]] = await pool.execute(
      `
      SELECT
        SUM(status='ACTIVE') AS active_ads,
        COUNT(*) AS total_ads
      FROM ads
      `
    );

    const [[eventsAgg]] = await pool.execute(
      `
      SELECT
        SUM(event_type='IMPRESSION_SELECTED') AS impressions_selected,
        SUM(event_type='IMPRESSION_RENDERED') AS impressions_rendered,
        SUM(event_type='CLICK') AS clicks,
        SUM(event_type='HIDE') AS dismisses,
        CASE WHEN SUM(event_type='IMPRESSION_RENDERED') = 0 THEN 0
             ELSE SUM(event_type='CLICK') / SUM(event_type='IMPRESSION_RENDERED') END AS ctr
      FROM ad_events
      WHERE created_at >= NOW() - INTERVAL ${days} DAY
      `
    );

    res.json({
      days,
      ads: {
        active_ads: Number(adsAgg?.active_ads || 0),
        total_ads: Number(adsAgg?.total_ads || 0)
      },
      events: {
        impressions_selected: Number(eventsAgg?.impressions_selected || 0),
        impressions_rendered: Number(eventsAgg?.impressions_rendered || 0),
        clicks: Number(eventsAgg?.clicks || 0),
        dismisses: Number(eventsAgg?.dismisses || 0),
        ctr: Number(eventsAgg?.ctr || 0)
      }
    });
  },

  async getTrends(req, res) {
    const pool = getPool();
    const hours = Math.max(1, Math.min(168, safeInt(req.query.hours, 24)));
    const minImpressions = Math.max(1, safeInt(req.query.minImpressions, 5));

    const [rows] = await pool.execute(
      `
      SELECT
        ad_id,

        SUM(created_at >= NOW() - INTERVAL ${hours} HOUR AND event_type='IMPRESSION_SELECTED') AS impsel_now,
        SUM(created_at <  NOW() - INTERVAL ${hours} HOUR
            AND created_at >= NOW() - INTERVAL ${hours * 2} HOUR
            AND event_type='IMPRESSION_SELECTED') AS impsel_prev,

        SUM(created_at >= NOW() - INTERVAL ${hours} HOUR AND event_type='IMPRESSION_RENDERED') AS imp_now,
        SUM(created_at <  NOW() - INTERVAL ${hours} HOUR
            AND created_at >= NOW() - INTERVAL ${hours * 2} HOUR
            AND event_type='IMPRESSION_RENDERED') AS imp_prev,

        SUM(created_at >= NOW() - INTERVAL ${hours} HOUR AND event_type='CLICK') AS clicks_now,
        SUM(created_at >= NOW() - INTERVAL ${hours} HOUR AND event_type='HIDE') AS hides_now
      FROM ad_events
      WHERE ad_id IS NOT NULL
      GROUP BY ad_id

      -- Keep original meaning: "minImpressions" gates by SELECTED, so your totals/expectations don't shift
      HAVING impsel_now >= ?

      -- Rank by quality-adjusted exposure:
      --   log(rendered) * (weighted selection rate + weighted click rate - weighted hide rate)
      ORDER BY
        (
          LOG(imp_now + 1) *
          (
            ((impsel_now + 1) / (imp_now + 1)) * 0.6
            + ((clicks_now + 1) / (imp_now + 1)) * 1.2
            - ((hides_now + 1) / (imp_now + 1)) * 0.8
          )
        ) DESC,
        imp_now DESC,
        impsel_now DESC
      LIMIT 20
      `,
      [minImpressions]
    );

    const adIds = rows.map(r => r.ad_id);
    if (!adIds.length) return res.json({ trends: [] });

    const placeholders = adIds.map(() => "?").join(",");
    const [ads] = await pool.execute(
      `
      SELECT ad_id, title, description, image_url, landing_url, status
      FROM ads
      WHERE ad_id IN (${placeholders})
      `,
      adIds
    );

    const adMap = new Map(ads.map(a => [Number(a.ad_id), a]));
    const trends = rows.map(r => ({ ...r, ad: adMap.get(Number(r.ad_id)) || null }));
    res.json({ trends, hours });
  },

  async getTrendReasons(req, res) {
    const pool = getPool();
    const adId = safeInt(req.params.adId);
    const hours = Math.max(1, Math.min(168, safeInt(req.query.hours, 24)));

    const [traceRows] = await pool.execute(
      `
      SELECT trace_json
      FROM ad_decisions
      WHERE chosen_ad_id = ?
        AND created_at >= NOW() - INTERVAL ${hours} HOUR
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [adId]
    );

    let traceTokens = [];
    for (const r of traceRows) {
      let tj = r.trace_json;
      if (typeof tj === "string") {
        try { tj = JSON.parse(tj); } catch { tj = null; }
      }
      traceTokens.push(...extractKeywordsFromTrace(tj).map(x => String(x).toLowerCase()));
    }

    let snapshotTokens = [];
    if (traceTokens.length < 5) {
      const [snaps] = await pool.execute(
        `
        SELECT s.context_text
        FROM ad_events e
        JOIN conversation_context_snapshots s ON s.snapshot_id = e.snapshot_id
        WHERE e.ad_id = ?
          AND e.event_type = 'IMPRESSION_SELECTED'
          AND e.created_at >= NOW() - INTERVAL ${hours} HOUR
        ORDER BY e.created_at DESC
        LIMIT 500
        `,
        [adId]
      );
      for (const s of snaps) snapshotTokens.push(...tokenizeText(s.context_text));
    }

    const fromTrace = topTerms(traceTokens, { topN: 12 });
    const fromContext = topTerms(snapshotTokens, { topN: 12 });

    res.json({
      adId,
      hours,
      source: fromTrace.length ? "trace_json" : "context_text",
      keywords: fromTrace.length ? fromTrace : fromContext
    });
  },

  async getTrendsTimeSeries(req, res) {
    const pool = getPool();
    const days = Math.max(3, Math.min(90, safeInt(req.query.days, 14)));

    const [rows] = await pool.execute(
      `
      SELECT
        DATE(created_at) AS day,
        SUM(event_type='IMPRESSION_SELECTED') AS impressions,
        SUM(event_type='IMPRESSION_RENDERED') AS impressions_rendered,
        SUM(event_type='CLICK') AS clicks,
        SUM(event_type='HIDE') AS dismisses
      FROM ad_events
      WHERE created_at >= NOW() - INTERVAL ${days} DAY
      GROUP BY DATE(created_at)
      ORDER BY day ASC
      `
    );

    res.json({ days, rows });
  }
};