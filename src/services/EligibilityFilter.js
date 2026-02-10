// src/services/EligibilityFilter.js

class EligibilityFilter {
  /**
   * Filters candidates based on safety flags + policy constraints.
   *
   * Backward compatible inputs:
   *  - userContext (legacy)
   *
   * New preferred inputs:
   *  - constraints (from IntentPolicyGate)
   *
   * Candidate fields expected (if available):
   *  - safetyCategory
   *  - geoScope
   *  - priceTier
   */
  filter({ candidates, safetyFlags, constraints = {}, userContext = {} } = {}) {
    // Hard safety stop (global)
    if (safetyFlags && safetyFlags.allow_ads === false) {
      return [];
    }

    const filtered = [];

    // Constraints from policy gate (preferred)
    const allowedCategories = Array.isArray(constraints.allowedCategories)
      ? constraints.allowedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : null;

    const blockedCategories = Array.isArray(constraints.blockedCategories)
      ? constraints.blockedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : [];

    const geoScope = constraints.geoScope ? String(constraints.geoScope) : null;
    const priceTier = constraints.priceTier ? String(constraints.priceTier) : null;

    // Legacy (fallback)
    const legacyGeo = userContext?.geo ? String(userContext.geo) : null;
    const legacyPrice = userContext?.pricePreference ? String(userContext.pricePreference) : null;

    for (const ad of candidates || []) {
      if (!ad) continue;

      // 1) Safety category exclusion (conversation-specific)
      // NOTE: Your safetyFlags.restricted currently holds "tags", but you also compare to ad.safetyCategory.
      // Keep the check for compatibility, but don't assume perfect taxonomy.
      if (
        Array.isArray(safetyFlags?.restricted) &&
        safetyFlags.restricted.length &&
        ad.safetyCategory &&
        safetyFlags.restricted.includes(ad.safetyCategory)
      ) {
        continue;
      }

      // 2) Policy allowlist for categories (if provided)
      if (allowedCategories && allowedCategories.length) {
        const cat = ad.safetyCategory ? String(ad.safetyCategory) : "";
        if (!cat || !allowedCategories.includes(cat)) continue;
      }

      // 3) Policy blocklist for categories
      if (blockedCategories.length) {
        const cat = ad.safetyCategory ? String(ad.safetyCategory) : "";
        if (cat && blockedCategories.includes(cat)) continue;
      }

      // 4) Geo scope check (policy gate preferred; legacy fallback)
      if (geoScope && ad.geoScope && String(ad.geoScope) !== geoScope) continue;
      if (!geoScope && legacyGeo && ad.geoScope && String(ad.geoScope) !== legacyGeo) continue;

      // 5) Price tier check (policy gate preferred; legacy fallback)
      if (priceTier && ad.priceTier && String(ad.priceTier) !== priceTier) continue;
      if (!priceTier && legacyPrice && ad.priceTier && String(ad.priceTier) !== legacyPrice) continue;

      filtered.push(ad);
    }

    return filtered;
  }
}

module.exports = EligibilityFilter;
