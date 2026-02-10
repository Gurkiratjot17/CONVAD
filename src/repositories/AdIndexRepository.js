// src/repositories/AdIndexRepository.js
const { getPool } = require("../db/mysql");

class AdIndexRepository {
  // ---------------------------
  // Existing: fetch latest indexed ads
  // ---------------------------
  async getIndexedAds({ limit = 200 } = {}) {
    const pool = getPool();

    // Force safe integer
    let lim = Number(limit);
    if (!Number.isFinite(lim)) lim = 200;
    lim = Math.max(1, Math.min(500, Math.floor(lim)));

    // Prefer indexed ads (no prepared LIMIT)
    const [rows] = await pool.execute(
      `
      SELECT
        a.ad_id,
        a.title, a.description, a.image_url, a.landing_url, a.status,
        aci.ad_text, aci.ad_card_json, aci.embedding_json, aci.safety_category, aci.geo_scope, aci.price_tier
      FROM ads a
      JOIN ad_context_index aci ON aci.ad_id = a.ad_id
      WHERE a.status = 'ACTIVE'
      ORDER BY a.ad_id DESC
      LIMIT ${lim}
      `
    );

    // Fallback if index isn't ready
    if (!rows.length) {
      const [fallback] = await pool.execute(
        `
        SELECT ad_id, title, description, image_url, landing_url
        FROM ads
        WHERE status = 'ACTIVE'
        ORDER BY ad_id DESC
        LIMIT ${lim}
        `
      );

      return fallback.map(r => ({
        adId: r.ad_id,
        title: r.title,
        description: r.description,
        imageUrl: r.image_url,
        landingUrl: r.landing_url,
        adText: `${r.title || ""} ${r.description || ""}`.trim(),
        adCard: null,
        embedding: null,
        safetyCategory: null,
        geoScope: null,
        priceTier: null,
      }));
    }

    return rows.map(r => ({
      adId: r.ad_id,
      title: r.title,
      description: r.description,
      imageUrl: r.image_url,
      landingUrl: r.landing_url,
      adText: r.ad_text,
      adCard: r.ad_card_json,
      embedding: r.embedding_json,
      safetyCategory: r.safety_category,
      geoScope: r.geo_scope,
      priceTier: r.price_tier,
    }));
  }

  // ---------------------------
  // Existing: legacy LIKE search
  // ---------------------------
  async searchIndexedAds({ terms = [], limit = 200 } = {}) {
    const pool = getPool();

    // Force a safe integer for LIMIT
    let lim = Number(limit);
    if (!Number.isFinite(lim)) lim = 200;
    lim = Math.max(1, Math.min(500, Math.floor(lim)));

    // Force safe string terms only
    const clean = (Array.isArray(terms) ? terms : [])
      .map(t => String(t ?? "").trim().toLowerCase())
      .filter(t => t && t.length >= 3)
      .slice(0, 10);

    if (!clean.length) return [];

    const where = clean.map(() => "aci.ad_text LIKE ?").join(" OR ");
    const params = clean.map(t => `%${t}%`); // guaranteed strings

    const [rows] = await pool.execute(
      `
      SELECT
        a.ad_id,
        a.title, a.description, a.image_url, a.landing_url, a.status,
        aci.ad_text, aci.ad_card_json, aci.embedding_json, aci.safety_category, aci.geo_scope, aci.price_tier
      FROM ads a
      JOIN ad_context_index aci ON aci.ad_id = a.ad_id
      WHERE a.status = 'ACTIVE'
        AND (${where})
      ORDER BY a.ad_id DESC
      LIMIT ${lim}
      `,
      params
    );

    console.log("[searchIndexedAds]", {
      clean,
      lim,
      placeholders: clean.length,
      params: params.length,
    });

    return rows.map(r => ({
      adId: r.ad_id,
      title: r.title,
      description: r.description,
      imageUrl: r.image_url,
      landingUrl: r.landing_url,
      adText: r.ad_text,
      adCard: r.ad_card_json,
      embedding: r.embedding_json,
      safetyCategory: r.safety_category,
      geoScope: r.geo_scope,
      priceTier: r.price_tier,
    }));
  }

  // ---------------------------
  // NEW: BM25 candidate retrieval
  // ---------------------------
  /**
   * True BM25 needs an inverted index (ad_terms / term_stats / ad_stats / corpus_stats).
   * This method will:
   *  1) Use inverted index tables if they exist (preferred).
   *  2) Otherwise fall back to legacy LIKE search (so system still works).
   *
   * Required tables for preferred path:
   *  - ad_terms(ad_id, term, tf)
   *  - term_stats(term, df)
   *  - ad_stats(ad_id, doc_len)
   *  - corpus_stats(id=1, total_docs, avg_doc_len)
   *
   * Returns ads with an extra field: bm25Score
   */
  async searchBm25Candidates({ terms = [], limit = 200, constraints = {} } = {}) {
    const pool = getPool();

    // Safe integer limit
    let lim = Number(limit);
    if (!Number.isFinite(lim)) lim = 200;
    lim = Math.max(1, Math.min(500, Math.floor(lim)));

    // Clean terms
    const cleanTerms = (Array.isArray(terms) ? terms : [])
      .map(t => String(t ?? "").trim().toLowerCase())
      .filter(t => t && t.length >= 2)
      .slice(0, 12);

    if (!cleanTerms.length) return [];

    // Constraints (soft support — your EligibilityFilter can enforce more)
    const allowedCategories = Array.isArray(constraints.allowedCategories)
      ? constraints.allowedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : [];
    const blockedCategories = Array.isArray(constraints.blockedCategories)
      ? constraints.blockedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : [];
    const geoScope = constraints.geoScope ? String(constraints.geoScope) : null;

    // Helper: check if inverted index tables exist
    const hasIndex = await this._hasBm25Tables(pool);
    if (!hasIndex) {
      // Fallback: LIKE-based search
      const rows = await this.searchIndexedAds({ terms: cleanTerms, limit: lim });
      return rows.map(r => ({ ...r, bm25Score: null, retrieval: "fallback_like" }));
    }

    // 1) Load corpus stats
    const { N, avgLen } = await this._getCorpusStats(pool);

    // 2) Load df for terms
    const dfByTerm = await this._getDfByTerm(pool, cleanTerms);

    // 3) Fetch postings (ad_id, term, tf) for those terms
    // We fetch a bit more than lim to give ranking headroom
    const candidatePool = Math.min(2000, Math.max(lim * 10, 500));
    const postings = await this._getPostings(pool, cleanTerms, candidatePool);

    if (!postings.length) {
      // No matches in inverted index; fallback to LIKE
      const rows = await this.searchIndexedAds({ terms: cleanTerms, limit: lim });
      return rows.map(r => ({ ...r, bm25Score: null, retrieval: "fallback_like_no_postings" }));
    }

    // 4) Fetch doc lengths for candidate ad_ids
    const adIds = Array.from(new Set(postings.map(p => p.ad_id)));
    const docLenByAd = await this._getDocLens(pool, adIds);

    // 5) Compute BM25 in Node
    const k1 = 1.2;
    const b = 0.75;

    const scoreByAd = new Map(); // ad_id -> score
    const tfByAdTerm = new Map(); // `${ad_id}:${term}` -> tf
    for (const p of postings) {
      tfByAdTerm.set(`${p.ad_id}:${p.term}`, Number(p.tf) || 0);
    }

    for (const adId of adIds) {
      const docLen = Number(docLenByAd.get(adId)) || avgLen || 1;
      let score = 0;

      for (const term of cleanTerms) {
        const tf = Number(tfByAdTerm.get(`${adId}:${term}`)) || 0;
        if (!tf) continue;

        const df = Number(dfByTerm.get(term)) || 0;
        // IDF with BM25+ style smoothing
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));

        const denom = tf + k1 * (1 - b + b * (docLen / (avgLen || 1)));
        const frac = (tf * (k1 + 1)) / (denom || 1);

        score += idf * frac;
      }

      if (score > 0) scoreByAd.set(adId, score);
    }

    // 6) Take top ads by bm25 score
    const ranked = Array.from(scoreByAd.entries())
      .sort((a, b2) => b2[1] - a[1])
      .slice(0, lim);

    const topAdIds = ranked.map(([adId]) => adId);
    if (!topAdIds.length) return [];

    // 7) Fetch ad details for those IDs (preserve ranking order)
    const ads = await this._getAdsByIds(pool, topAdIds, { allowedCategories, blockedCategories, geoScope });

    // 8) Attach bm25Score, preserve rank order
    const bm25ById = new Map(ranked);
    const byId = new Map(ads.map(a => [a.adId, a]));
    const ordered = topAdIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(a => ({
        ...a,
        bm25Score: bm25ById.get(a.adId) ?? null,
        retrieval: "bm25_index",
      }));

    console.log("[searchBm25Candidates]", {
      terms: cleanTerms,
      lim,
      N,
      avgLen,
      candidatePool,
      postings: postings.length,
      returned: ordered.length,
      constraints: {
        allowedCategories: allowedCategories.length ? allowedCategories.length : 0,
        blockedCategories: blockedCategories.length ? blockedCategories.length : 0,
        geoScope: geoScope || null,
      },
    });

    return ordered;
  }

  // ---------------------------
  // Internal helpers (BM25)
  // ---------------------------
  async _hasBm25Tables(pool) {
    try {
      const tables = ["ad_terms", "term_stats", "ad_stats", "corpus_stats"];
      // Check quickly via INFORMATION_SCHEMA
      const [rows] = await pool.execute(
        `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (${tables.map(() => "?").join(",")})
        `,
        tables
      );
      const found = new Set((rows || []).map(r => r.table_name));
      return tables.every(t => found.has(t));
    } catch (e) {
      console.warn("[AdIndexRepository] _hasBm25Tables failed, falling back:", e?.message || e);
      return false;
    }
  }

  async _getCorpusStats(pool) {
    try {
      const [rows] = await pool.execute(
        `
        SELECT total_docs, avg_doc_len
        FROM corpus_stats
        WHERE id = 1
        LIMIT 1
        `
      );

      const totalDocs = Number(rows?.[0]?.total_docs);
      const avgDocLen = Number(rows?.[0]?.avg_doc_len);

      // Sensible defaults if not present
      return {
        N: Number.isFinite(totalDocs) && totalDocs > 0 ? totalDocs : 1,
        avgLen: Number.isFinite(avgDocLen) && avgDocLen > 0 ? avgDocLen : 100,
      };
    } catch (e) {
      console.warn("[AdIndexRepository] _getCorpusStats failed, using defaults:", e?.message || e);
      return { N: 1, avgLen: 100 };
    }
  }

  async _getDfByTerm(pool, terms) {
    const df = new Map();
    if (!terms.length) return df;

    try {
      const [rows] = await pool.execute(
        `
        SELECT term, df
        FROM term_stats
        WHERE term IN (${terms.map(() => "?").join(",")})
        `,
        terms
      );

      for (const r of rows || []) {
        df.set(String(r.term), Number(r.df) || 0);
      }
    } catch (e) {
      console.warn("[AdIndexRepository] _getDfByTerm failed:", e?.message || e);
    }

    // Ensure every term exists in map
    for (const t of terms) if (!df.has(t)) df.set(t, 0);
    return df;
  }

  async _getPostings(pool, terms, candidatePool) {
    if (!terms.length) return [];
    // Candidate pool is enforced by limiting each term's postings;
    // simplest safe strategy: grab up to candidatePool postings overall
    // ordered by tf desc to bias toward stronger matches.
    try {
      const [rows] = await pool.execute(
        `
        SELECT ad_id, term, tf
        FROM ad_terms
        WHERE term IN (${terms.map(() => "?").join(",")})
        ORDER BY tf DESC
        LIMIT ${Math.max(1, Math.min(50000, Math.floor(candidatePool)))}
        `,
        terms
      );
      return rows || [];
    } catch (e) {
      console.warn("[AdIndexRepository] _getPostings failed:", e?.message || e);
      return [];
    }
  }

  async _getDocLens(pool, adIds) {
    const map = new Map();
    if (!adIds.length) return map;

    // chunk to avoid huge IN lists
    const chunkSize = 800;
    for (let i = 0; i < adIds.length; i += chunkSize) {
      const chunk = adIds.slice(i, i + chunkSize);
      const [rows] = await pool.execute(
        `
        SELECT ad_id, doc_len
        FROM ad_stats
        WHERE ad_id IN (${chunk.map(() => "?").join(",")})
        `,
        chunk
      );

      for (const r of rows || []) {
        map.set(Number(r.ad_id), Number(r.doc_len) || 0);
      }
    }

    return map;
  }

  async _getAdsByIds(pool, adIds, { allowedCategories = [], blockedCategories = [], geoScope = null } = {}) {
    if (!adIds.length) return [];

    // Build filters (soft; you may enforce harder in EligibilityFilter too)
    const filters = [];
    const params = [];

    // Only ACTIVE ads
    filters.push("a.status = 'ACTIVE'");

    // Category filtering based on safety_category field (your schema uses aci.safety_category)
    if (allowedCategories.length) {
      filters.push(`aci.safety_category IN (${allowedCategories.map(() => "?").join(",")})`);
      params.push(...allowedCategories);
    }
    if (blockedCategories.length) {
      filters.push(`(aci.safety_category IS NULL OR aci.safety_category NOT IN (${blockedCategories.map(() => "?").join(",")}))`);
      params.push(...blockedCategories);
    }

    // geoScope filter (if you want to restrict strictly)
    if (geoScope) {
      filters.push("(aci.geo_scope IS NULL OR aci.geo_scope = ?)");
      params.push(geoScope);
    }

    // adIds
    const idParams = adIds.map(() => "?").join(",");
    params.push(...adIds);

    // Preserve order using FIELD()
    const [rows] = await pool.execute(
      `
      SELECT
        a.ad_id,
        a.title, a.description, a.image_url, a.landing_url, a.status,
        aci.ad_text, aci.ad_card_json, aci.embedding_json, aci.safety_category, aci.geo_scope, aci.price_tier
      FROM ads a
      JOIN ad_context_index aci ON aci.ad_id = a.ad_id
      WHERE ${filters.join(" AND ")}
        AND a.ad_id IN (${idParams})
      ORDER BY FIELD(a.ad_id, ${adIds.map(() => "?").join(",")})
      `,
      [...params, ...adIds] // FIELD uses the same ids again
    );

    return (rows || []).map(r => ({
      adId: r.ad_id,
      title: r.title,
      description: r.description,
      imageUrl: r.image_url,
      landingUrl: r.landing_url,
      adText: r.ad_text,
      adCard: r.ad_card_json,
      embedding: r.embedding_json,
      safetyCategory: r.safety_category,
      geoScope: r.geo_scope,
      priceTier: r.price_tier,
    }));
  }
}

module.exports = AdIndexRepository;
