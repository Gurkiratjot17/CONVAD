// src/repositories/AdIndexRepository.js
const { getPool } = require("../db/mysql");

class AdIndexRepository {
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

    console.log("[searchIndexedAds]", { clean, lim, placeholders: clean.length, params: params.length });
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

  }

module.exports = AdIndexRepository;
