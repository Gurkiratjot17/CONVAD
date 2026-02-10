// src/services/IntentPolicyGate.js

/**
 * IntentPolicyGate
 *
 * Responsibilities:
 * - Decide whether ads should be shown at all (hard gate)
 * - Produce policy constraints used downstream (soft gate)
 * - Keep logic explainable and auditable (for DecisionTracer / dissertation)
 *
 * IMPORTANT:
 * This is intentionally conservative. You can relax rules later.
 */

class IntentPolicyGate {
  constructor({ eventRepo } = {}) {
    this.eventRepo = eventRepo;

    // Frequency caps (very simple, session-based)
    this.MAX_ADS_PER_CONVERSATION = 6;
    this.MIN_TURNS_BETWEEN_ADS = 2;

    // Confidence thresholds
    this.MIN_INTENT_CONFIDENCE = 0.25;
  }

  /**
   * Evaluate whether ads are allowed and under what constraints.
   */
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
      return {
        showAds: false,
        constraints: {},
        reasonCodes: reasons,
      };
    }

    // ---------------------------
    // 2) Frequency capping (soft-hard hybrid)
    // ---------------------------
    if (this.eventRepo && conversationId != null) {
      try {
        const stats = await this._getConversationAdStats(conversationId);

        if (stats.totalAds >= this.MAX_ADS_PER_CONVERSATION) {
          reasons.push("frequency_cap_conversation");
          return {
            showAds: false,
            constraints: {},
            reasonCodes: reasons,
          };
        }

        if (
          stats.lastAdTurn != null &&
          turnIndex - stats.lastAdTurn < this.MIN_TURNS_BETWEEN_ADS
        ) {
          reasons.push("frequency_cap_turn_spacing");
          return {
            showAds: false,
            constraints: {},
            reasonCodes: reasons,
          };
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

    if (intentLabel === "unknown" || intentConfidence < this.MIN_INTENT_CONFIDENCE) {
      // Low confidence intent → allow ads but restrict aggressively
      reasons.push("low_intent_confidence");
      constraints.soft = true;
    }

    // ---------------------------
    // 4) Intent → policy constraints
    // ---------------------------
    switch (intentLabel) {
      case "learn":
        // Avoid aggressive commercial ads
        constraints.allowedCategories = ["education", "productivity", "software"];
        reasons.push("intent_learn");
        break;

      case "buy":
      case "food":
      case "travel":
        // Commercial intent: allow broader ads
        reasons.push("intent_commercial");
        break;

      case "job":
        constraints.allowedCategories = ["jobs", "education", "software"];
        reasons.push("intent_job");
        break;

      default:
        // Unknown or mixed intent
        constraints.soft = true;
        reasons.push("intent_unknown");
    }

    // ---------------------------
    // 5) Query heuristics (last guardrail)
    // ---------------------------
    if (this._looksLikePureQuestion(queryText)) {
      // “Explain X”, “What is Y” → informational
      constraints.soft = true;
      reasons.push("informational_query");
    }

    // ---------------------------
    // 6) Final decision
    // ---------------------------
    return {
      showAds: true,
      constraints,
      reasonCodes: reasons,
    };
  }

  // ---------------------------
  // Helpers
  // ---------------------------
  async _getConversationAdStats(conversationId) {
    // Very lightweight analytics query
    // You already log events with eventType = "impression_selected"
    const stats = await this.eventRepo.getConversationAdStats(conversationId);

    return {
      totalAds: Number(stats?.totalAds) || 0,
      lastAdTurn:
        stats?.lastAdTurn != null ? Number(stats.lastAdTurn) : null,
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
