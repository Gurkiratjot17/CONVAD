// src/services/AdService.js
const { getPool } = require("../db/mysql");
const AdSelectionService = require("./AdSelectionService");

class AdService {
  constructor() {
    this.MIN_REL_WEIGHT = 0.65;
    this.MAX_ADS = 2;

    // New pipeline orchestrator
    this.selection = new AdSelectionService();
  }

  // ----------------------------
  // Legacy tag-based functions
  // ----------------------------
  _normalizeTagKeys(selectedTags) {
    const keys = Array.isArray(selectedTags)
      ? selectedTags.map(t => (typeof t === "string" ? t : t?.tag))
      : [];
    return [...new Set(keys.map(k => String(k || "").trim().toLowerCase()).filter(Boolean))];
  }

  async findAdsByTagKeys(tagKeys, limit = this.MAX_ADS) {
    const pool = getPool();

    const cleanKeys = (Array.isArray(tagKeys) ? tagKeys : [])
      .map(k => String(k || "").trim().toLowerCase())
      .filter(Boolean);

    let lim = Number(limit);
    if (!Number.isFinite(lim)) lim = this.MAX_ADS;
    lim = Math.max(1, Math.min(20, Math.floor(lim)));

    if (!cleanKeys.length) return [];

    const placeholders = cleanKeys.map(() => "?").join(",");
    const [rows] = await pool.execute(
      `
      SELECT
        a.ad_id, a.title, a.description, a.image_url, a.landing_url,
        COUNT(*) AS match_count
      FROM ads a
      JOIN ad_tags at ON at.ad_id = a.ad_id
      JOIN tags t ON t.tag_id = at.tag_id
      WHERE a.status = 'ACTIVE'
        AND t.tag_key IN (${placeholders})
      GROUP BY a.ad_id
      ORDER BY match_count DESC, a.ad_id DESC
      LIMIT ?
      `,
      [...cleanKeys, lim]
    );

    return rows.map(r => ({
      adId: r.ad_id,
      title: r.title,
      description: r.description,
      imageUrl: r.image_url,
      landingUrl: r.landing_url,
      score: Number(r.match_count || 0),
      reason: "direct_tag_match",
    }));
  }

  async legacyMatchAdsForTags(selectedTags) {
    const tagKeys = this._normalizeTagKeys(selectedTags);
    if (tagKeys.length < 1) return [];

    let ads = await this.findAdsByTagKeys(tagKeys, this.MAX_ADS);

    // Only call if implemented somewhere
    if (ads.length < 1 && typeof this.findAdsByRelatedTags === "function") {
      ads = await this.findAdsByRelatedTags(tagKeys, this.MAX_ADS);
    }

    return ads;
  }

  // ----------------------------
  // New contextual matching API
  // ----------------------------
  async selectAdsForConversation({ conversationId, userId, turnIndex, messages }) {
    return this.selection.selectAds({ conversationId, userId, turnIndex, messages });
  }
}

module.exports = AdService;
