// src/services/EligibilityFilter.js
class EligibilityFilter {
  filter({ candidates, safetyFlags, userContext = {} }) {
    // Hard safety stop
    if (safetyFlags && safetyFlags.allow_ads === false) {
      return [];
    }

    const filtered = [];

    for (const ad of (candidates || [])) {
      // Example rule 1: safety category exclusion
      if (
        safetyFlags?.restricted?.length &&
        ad.safetyCategory &&
        safetyFlags.restricted.includes(ad.safetyCategory)
      ) {
        continue;
      }

      // Example rule 2: geo scope (future-proof, optional)
      if (
        ad.geoScope &&
        userContext.geo &&
        ad.geoScope !== userContext.geo
      ) {
        continue;
      }

      // Example rule 3: price sensitivity (future-proof)
      if (
        ad.priceTier &&
        userContext.pricePreference &&
        ad.priceTier !== userContext.pricePreference
      ) {
        continue;
      }

      filtered.push(ad);
    }

    return filtered;
  }
}

module.exports = EligibilityFilter;
