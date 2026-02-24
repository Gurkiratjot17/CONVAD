// src/services/IntentPolicyGate.js

/**
 * IntentPolicyGate
 *
 * Responsibilities:
 * - Decide whether ads should be shown at all (hard gate)
 * - Produce policy constraints used downstream (soft gate)
 * - Keep logic explainable and auditable
 *
 * IMPORTANT:
 * Gate MUST be based on what the user actually saw (IMPRESSION_RENDERED),
 * not internal selection events.
 */

class IntentPolicyGate {
  constructor({ eventRepo } = {}) {
    this.eventRepo = eventRepo;

    // ---------------------------
    // Rolling frequency caps (NOT lifetime)
    // ---------------------------
    // Example: allow up to 2 rendered ads within the last 8 turns.
    // After enough new turns, the window slides and ads can show again.
    this.ROLLING_WINDOW_TURNS = 6;
    this.MAX_RENDERED_ADS_PER_WINDOW = 6;

    // Spacing: minimum turns between rendered ads
    this.MIN_TURNS_BETWEEN_RENDERED_ADS = 0;

    // Optional cooldown (seconds) after a render
    this.COOLDOWN_SECONDS_AFTER_RENDER = 30;

    // Confidence thresholds
    this.MIN_INTENT_CONFIDENCE = 0.25;
  }

  async evaluate({
    conversationId,
    userId,
    turnIndex,
    intent,
    safetyFlags,
    queryText,
    queryTerms,
    messages,
  } = {}) {
    const reasons = [];
    const constraints = {};

    // ---------------------------
    // 1) Hard safety gate
    // ---------------------------
    if (safetyFlags && safetyFlags.allow_ads === false) {
      reasons.push("safety_block");
      return { showAds: false, constraints: {}, reasonCodes: reasons };
    }

    // ---------------------------
    // 2) Frequency capping (based on IMPRESSION_RENDERED only)
    // Rolling window so it never goes silent forever.
    // ---------------------------
    if (this.eventRepo && conversationId != null) {
      try {
        const ti = Number(turnIndex);
        const minTurnIndex =
          Number.isFinite(ti) && ti >= 0
            ? Math.max(0, ti - this.ROLLING_WINDOW_TURNS + 1)
            : null;

        const stats = await this._getConversationAdStats(conversationId, {
          minTurnIndex,
        });

        // Rolling window cap: blocks only until enough turns pass
        if (
          Number.isFinite(stats.totalRenderedAdsWindow) &&
          stats.totalRenderedAdsWindow >= this.MAX_RENDERED_ADS_PER_WINDOW
        ) {
          reasons.push("frequency_cap_rolling_window");
          return { showAds: false, constraints: {}, reasonCodes: reasons };
        }

        // Turn spacing: ensure some turns between rendered ads
        if (
          stats.lastRenderedTurn != null &&
          Number.isFinite(ti) &&
          ti - stats.lastRenderedTurn < this.MIN_TURNS_BETWEEN_RENDERED_ADS
        ) {
          reasons.push("frequency_cap_turn_spacing");
          return { showAds: false, constraints: {}, reasonCodes: reasons };
        }

        // Optional cooldown by time
        if (
          stats.lastRenderedAtMs != null &&
          Date.now() - stats.lastRenderedAtMs <
            this.COOLDOWN_SECONDS_AFTER_RENDER * 1000
        ) {
          reasons.push("frequency_cap_cooldown");
          return { showAds: false, constraints: {}, reasonCodes: reasons };
        }
      } catch (e) {
        // Fail-open: do not block ads if analytics fail
        reasons.push("frequency_check_failed");
      }
    }

    // ---------------------------
    // 3) Intent-based gating
    // ---------------------------
    const intentLabel = intent?.label || "unknown";
    const intentConfidence = Number(intent?.confidence) || 0;

    if (
      intentLabel === "unknown" ||
      intentConfidence < this.MIN_INTENT_CONFIDENCE
    ) {
      reasons.push("low_intent_confidence");
      constraints.soft = true;
    }

    // ---------------------------
    // 4) Intent → policy constraints
    // ---------------------------
    switch (intentLabel) {
      case "learn":
        constraints.allowedCategories = ["education", "productivity", "software"];
        reasons.push("intent_learn");
        break;

      case "buy":
      case "food":
      case "travel":
        reasons.push("intent_commercial");
        break;

      case "job":
        constraints.allowedCategories = ["jobs", "education", "software"];
        reasons.push("intent_job");
        break;

      default:
        constraints.soft = true;
        reasons.push("intent_unknown");
    }

    // ---------------------------
    // 5) Query heuristics (guardrail)
    // ---------------------------
    if (this._looksLikePureQuestion(queryText)) {
      constraints.soft = true;
      reasons.push("informational_query");
    }

    return { showAds: true, constraints, reasonCodes: reasons };
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  async _getConversationAdStats(conversationId, { minTurnIndex = null } = {}) {
    /**
     * eventRepo.getConversationAdStats returns stats based on what the user SAW:
     * - totalRenderedAdsWindow (within minTurnIndex..end if provided)
     * - lastRenderedTurn
     * - lastRenderedAt
     */
    const stats = await this.eventRepo.getConversationAdStats(conversationId, {
      minTurnIndex,
    });

    const lastRenderedAtMs = stats?.lastRenderedAt
      ? Date.parse(stats.lastRenderedAt)
      : null;

    return {
      totalRenderedAdsWindow: Number(stats?.totalRenderedAdsWindow) || 0,
      lastRenderedTurn:
        stats?.lastRenderedTurn != null ? Number(stats.lastRenderedTurn) : null,
      lastRenderedAtMs: Number.isFinite(lastRenderedAtMs)
        ? lastRenderedAtMs
        : null,
    };
  }

  _looksLikePureQuestion(text) {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    return (
      t.startsWith("what is") ||
      t.startsWith("how do") ||
      t.startsWith("how does") ||
      t.startsWith("why does") ||
      t.startsWith("explain") ||
      t.endsWith("?")
    );
  }
}

module.exports = IntentPolicyGate;