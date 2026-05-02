// src/services/EligibilityFilter.js

/*
 * EligibilityFilter
 *
 * Filters retrieved ad candidates based on:
 * - Safety constraints (conversation-level)
 * - Policy constraints (from IntentPolicyGate)
 * - Optional legacy user context (fallback)
 *
 * Purpose:
 * - Ensure only compliant ads proceed to ranking
 * - Enforce safety, relevance, and policy constraints before scoring
 * - Maintain backward compatibility with older system inputs
 */

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
    /*
     * Global safety override:
     * If the conversation is flagged unsafe (e.g., crisis context),
     * no ads should be allowed regardless of other conditions.
     */
    if (safetyFlags && safetyFlags.allow_ads === false) {
      return [];
    }

    const filtered = [];

     /*
     * Extract policy constraints from the IntentPolicyGate.
     *
     * These constraints guide which ads are allowed or restricted.
     */
    const allowedCategories = Array.isArray(constraints.allowedCategories)
      ? constraints.allowedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : null;

    const blockedCategories = Array.isArray(constraints.blockedCategories)
      ? constraints.blockedCategories.map(x => String(x ?? "").trim()).filter(Boolean)
      : [];

    const geoScope = constraints.geoScope ? String(constraints.geoScope) : null;
    const priceTier = constraints.priceTier ? String(constraints.priceTier) : null;

    /*
     * Legacy fallback constraints (used if policy constraints are absent).
     */
    const legacyGeo = userContext?.geo ? String(userContext.geo) : null;
    const legacyPrice = userContext?.pricePreference ? String(userContext.pricePreference) : null;

    for (const ad of candidates || []) {
      if (!ad) continue;

      // 1) Safety category exclusion (conversation-specific)
      /*
       * Exclude ads that match restricted safety categories derived
       * from the current conversation.
       *
       * Note:
       * - This comparison assumes category/tag alignment between
       *   safetyFlags and ad metadata, which may not always be exact.
       */
      if (
        Array.isArray(safetyFlags?.restricted) &&
        safetyFlags.restricted.length &&
        ad.safetyCategory &&
        safetyFlags.restricted.includes(ad.safetyCategory)
      ) {
        continue;
      }

      // 2) Policy allowlist for categories (if provided)
      /*
       * If an allowlist exists, only ads within allowed categories are retained.
       */
      if (allowedCategories && allowedCategories.length) {
        const cat = ad.safetyCategory ? String(ad.safetyCategory) : "";
        if (!cat || !allowedCategories.includes(cat)) continue;
      }

      // 3) Policy blocklist for categories
      /*
       * If a blocklist exists, ads within blocked categories are excluded.
       */
      if (blockedCategories.length) {
        const cat = ad.safetyCategory ? String(ad.safetyCategory) : "";
        if (cat && blockedCategories.includes(cat)) continue;
      }

       // 4) Geo scope check (policy gate preferred; legacy fallback)
      /*
       * Ensure the ad matches the required geographic scope.
       *
       * Priority:
       * 1. Policy constraint
       * 2. Legacy user context
       */
      if (geoScope && ad.geoScope && String(ad.geoScope) !== geoScope) continue;
      if (!geoScope && legacyGeo && ad.geoScope && String(ad.geoScope) !== legacyGeo) continue;

       // 5) Price tier check (policy gate preferred; legacy fallback)
      /*
       * Filter ads based on pricing tier preferences.
       *
       * Priority:
       * 1. Policy constraint
       * 2. Legacy user preference
       */
      if (priceTier && ad.priceTier && String(ad.priceTier) !== priceTier) continue;
      if (!priceTier && legacyPrice && ad.priceTier && String(ad.priceTier) !== legacyPrice) continue;

      /*
       * Candidate passes all filtering checks and is retained.
       */
      filtered.push(ad);
    }

    return filtered;
  }
}

module.exports = EligibilityFilter;
