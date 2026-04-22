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
    // Example: allow up to N rendered ads within the last X turns.
    // After enough new turns, the window slides and ads can show again.
    this.ROLLING_WINDOW_TURNS = 6;
    this.MAX_RENDERED_ADS_PER_WINDOW = 6;

    // Spacing: minimum turns between rendered ads
    this.MIN_TURNS_BETWEEN_RENDERED_ADS = 0;

    // Optional cooldown (seconds) after a render
    this.COOLDOWN_SECONDS_AFTER_RENDER = 30;

    // Confidence thresholds
    this.MIN_INTENT_CONFIDENCE = 0.25;
    this.STRONG_INTENT_CONFIDENCE = 0.6;
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
    const rawIntentLabel = intent?.label || "unknown";
    const intentConfidence = Number(intent?.confidence) || 0;
    const intentLabel = this._normalizeIntent(rawIntentLabel);

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
    this._applyIntentPolicy({
      intentLabel,
      intentConfidence,
      constraints,
      reasons,
    });

    // ---------------------------
    // 5) Query heuristics (guardrail)
    // ---------------------------
    if (this._looksLikePureQuestion(queryText)) {
      constraints.soft = true;
      reasons.push("informational_query");
    }

    if (this._looksSensitiveQuery(queryText, safetyFlags)) {
      constraints.soft = true;
      constraints.sensitive = true;
      reasons.push("sensitive_query");
    }

    if (this._looksTransactionalQuery(queryText, queryTerms)) {
      reasons.push("transactional_query");
    }

    // ---------------------------
    // 6) Final hard-block checks from constraints
    // ---------------------------
    if (constraints.blocked === true) {
      reasons.push("policy_blocked_intent");
      return { showAds: false, constraints: {}, reasonCodes: reasons };
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

  _normalizeIntent(label) {
    const x = String(label || "")
      .trim()
      .toLowerCase();

    if (!x) return "unknown";

    const INTENT_GROUPS = {
      learn: [
        "learn",
        "education",
        "research",
        "study",
        "course",
        "training",
        "tutorial",
        "howto",
        "how-to",
        "guide",
        "explain",
        "academic",
        "homework",
        "revision",
        "skills",
        "certification",
        "knowledge",
        "reference",
      ],

      commercial: [
        "buy",
        "shop",
        "purchase",
        "order",
        "deal",
        "discount",
        "pricing",
        "price",
        "subscription",
        "upgrade",
        "gift",
        "food",
        "restaurant",
        "eat",
        "delivery",
        "takeaway",
        "groceries",
        "travel",
        "flight",
        "hotel",
        "booking",
        "vacation",
        "holiday",
        "transport",
        "taxi",
        "rideshare",
        "compare-products",
        "shopping",
      ],

      job: [
        "job",
        "career",
        "hire",
        "work",
        "employment",
        "internship",
        "freelance",
        "resume",
        "cv",
        "interview",
        "recruitment",
        "networking",
        "promotion",
      ],

      software: [
        "software",
        "tool",
        "tools",
        "app",
        "apps",
        "saas",
        "productivity",
        "automation",
        "workflow",
        "integration",
        "developer",
        "coding",
        "programming",
        "debugging",
        "cloud",
        "hosting",
        "security",
        "devops",
        "api",
      ],

      entertainment: [
        "entertainment",
        "movie",
        "film",
        "series",
        "tv",
        "music",
        "song",
        "podcast",
        "streaming",
        "gaming",
        "game",
        "sports",
        "event",
        "concert",
        "festival",
        "show",
      ],

      finance: [
        "finance",
        "banking",
        "insurance",
        "invest",
        "investment",
        "loan",
        "mortgage",
        "budget",
        "saving",
        "savings",
        "credit",
        "tax",
        "crypto",
        "financial-planning",
      ],

      health: [
        "health",
        "fitness",
        "wellness",
        "mental-health",
        "nutrition",
        "diet",
        "exercise",
        "medical",
        "therapy",
        "symptoms",
      ],

      social: [
        "dating",
        "relationship",
        "friendship",
        "family",
        "social",
        "community",
        "messaging",
        "communication",
        "event-planning",
      ],

      lifestyle: [
        "lifestyle",
        "fashion",
        "beauty",
        "home",
        "decor",
        "selfcare",
        "personal-growth",
        "motivation",
        "habit",
      ],

      local_services: [
        "local",
        "nearby",
        "services",
        "repair",
        "cleaning",
        "plumber",
        "electrician",
        "mechanic",
        "doctor",
        "dentist",
        "lawyer",
        "moving",
      ],

      business: [
        "business",
        "startup",
        "marketing",
        "sales",
        "advertising",
        "crm",
        "operations",
        "analytics",
        "procurement",
        "enterprise",
        "b2b",
      ],

      legal_admin: [
        "legal",
        "law",
        "visa",
        "immigration",
        "government",
        "tax-filing",
        "compliance",
        "documentation",
      ],

      housing: [
        "housing",
        "rent",
        "rental",
        "property",
        "real-estate",
        "mortgage-search",
        "student-accommodation",
      ],

      automotive: [
        "car",
        "vehicle",
        "automotive",
        "motorbike",
        "car-rental",
        "car-repair",
        "car-insurance",
      ],

      cause: [
        "charity",
        "donation",
        "fundraising",
        "nonprofit",
        "cause",
        "volunteering",
      ],

      restricted: [
        "gambling",
        "alcohol",
        "tobacco",
        "vape",
        "adult",
        "weapons",
        "controlled-substances",
      ],

      high_risk: [
        "self-harm",
        "suicide",
        "violence",
        "abuse",
        "crisis",
      ],

      informational: [
        "news",
        "weather",
        "facts",
        "information",
        "general",
        "browse",
        "discovery",
        "compare",
        "recommendation",
      ],
    };

    for (const [canonical, variants] of Object.entries(INTENT_GROUPS)) {
      if (variants.includes(x)) return canonical;
    }

    return x.includes("_") || x.includes("-") ? x.replace(/[_-]+/g, "-") : "unknown";
  }

  _applyIntentPolicy({ intentLabel, intentConfidence, constraints, reasons }) {
    switch (intentLabel) {
      // ---------------------------
      // Learning / knowledge seeking
      // ---------------------------
      case "learn":
        constraints.allowedCategories = [
          "education",
          "productivity",
          "software",
          "books",
        ];
        reasons.push("intent_learn");
        break;

      // ---------------------------
      // Commercial / purchasing
      // ---------------------------
      case "commercial":
        constraints.allowedCategories = [
          "ecommerce",
          "food",
          "travel",
          "local_services",
          "finance",
          "software",
        ];
        reasons.push("intent_commercial");
        break;

      // ---------------------------
      // Career / employment
      // ---------------------------
      case "job":
        constraints.allowedCategories = [
          "jobs",
          "education",
          "software",
          "productivity",
        ];
        reasons.push("intent_job");
        break;

      // ---------------------------
      // Software / tools / productivity
      // ---------------------------
      case "software":
        constraints.allowedCategories = [
          "software",
          "productivity",
          "education",
          "business",
        ];
        reasons.push("intent_software");
        break;

      // ---------------------------
      // Entertainment / media
      // ---------------------------
      case "entertainment":
        constraints.allowedCategories = [
          "entertainment",
          "gaming",
          "events",
          "streaming",
          "movies"
        ];
        reasons.push("intent_entertainment");
        break;

      // ---------------------------
      // Finance / money
      // ---------------------------
      case "finance":
        constraints.allowedCategories = [
          "finance",
          "software",
          "education",
        ];
        constraints.sensitive = true;
        reasons.push("intent_finance");
        break;

      // ---------------------------
      // Health / wellbeing
      // ---------------------------
      case "health":
        constraints.allowedCategories = [
          "health",
          "fitness",
          "wellness",
          "education",
        ];
        constraints.sensitive = true;
        reasons.push("intent_health");
        break;

      // ---------------------------
      // Social / relationships
      // ---------------------------
      case "social":
        constraints.allowedCategories = [
          "social",
          "communication",
          "events",
          "lifestyle",
        ];
        reasons.push("intent_social");
        break;

      // ---------------------------
      // Lifestyle
      // ---------------------------
      case "lifestyle":
        constraints.allowedCategories = [
          "lifestyle",
          "shopping",
          "beauty",
          "home",
        ];
        reasons.push("intent_lifestyle");
        break;

      // ---------------------------
      // Local services
      // ---------------------------
      case "local_services":
        constraints.allowedCategories = [
          "local_services",
          "home_services",
          "professional_services",
        ];
        reasons.push("intent_local_services");
        break;

      // ---------------------------
      // Business / B2B
      // ---------------------------
      case "business":
        constraints.allowedCategories = [
          "business",
          "software",
          "finance",
          "productivity",
        ];
        reasons.push("intent_business");
        break;

      // ---------------------------
      // Legal / admin
      // ---------------------------
      case "legal_admin":
        constraints.allowedCategories = [
          "legal",
          "professional_services",
          "education",
        ];
        constraints.sensitive = true;
        reasons.push("intent_legal_admin");
        break;

      // ---------------------------
      // Housing
      // ---------------------------
      case "housing":
        constraints.allowedCategories = [
          "housing",
          "finance",
          "local_services",
        ];
        reasons.push("intent_housing");
        break;

      // ---------------------------
      // Automotive
      // ---------------------------
      case "automotive":
        constraints.allowedCategories = [
          "automotive",
          "finance",
          "local_services",
          "travel",
        ];
        reasons.push("intent_automotive");
        break;

      // ---------------------------
      // Causes / charity
      // ---------------------------
      case "cause":
        constraints.allowedCategories = [
          "charity",
          "community",
          "events",
        ];
        reasons.push("intent_cause");
        break;

      // ---------------------------
      // Restricted
      // ---------------------------
      case "restricted":
        constraints.blocked = true;
        reasons.push("intent_restricted");
        break;

      // ---------------------------
      // High-risk
      // ---------------------------
      case "high_risk":
        constraints.blocked = true;
        constraints.sensitive = true;
        reasons.push("intent_high_risk");
        break;

      // ---------------------------
      // Informational
      // ---------------------------
      case "informational":
        constraints.soft = true;
        reasons.push("intent_informational");
        break;

      // ---------------------------
      // Unknown / ambiguous
      // ---------------------------
      default:
        constraints.soft = true;
        reasons.push("intent_unknown");
        break;
    }

    if (intentConfidence >= this.STRONG_INTENT_CONFIDENCE) {
      reasons.push("intent_confident");
    }
  }

  _looksLikePureQuestion(text) {
    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    return (
      t.startsWith("what is") ||
      t.startsWith("what are") ||
      t.startsWith("how do") ||
      t.startsWith("how does") ||
      t.startsWith("why does") ||
      t.startsWith("why is") ||
      t.startsWith("can you explain") ||
      t.startsWith("explain") ||
      t.startsWith("tell me about") ||
      t.endsWith("?")
    );
  }

  _looksSensitiveQuery(text, safetyFlags) {
    if (safetyFlags?.sensitive === true) return true;

    const t = String(text || "").toLowerCase().trim();
    if (!t) return false;

    const sensitivePatterns = [
      "depressed",
      "suicide",
      "self harm",
      "self-harm",
      "abuse",
      "assault",
      "overdose",
      "violent",
      "weapon",
      "porn",
      "escort",
      "gambling",
      "betting",
      "alcohol addiction",
      "drug use",
      "therapy",
      "symptoms",
      "diagnosis",
      "pregnancy problem",
      "legal issue",
      "visa refusal",
    ];

    return sensitivePatterns.some((p) => t.includes(p));
  }

  _looksTransactionalQuery(text, queryTerms) {
    const t = String(text || "").toLowerCase().trim();
    const joinedTerms = Array.isArray(queryTerms)
      ? queryTerms.join(" ").toLowerCase()
      : "";

    const haystack = `${t} ${joinedTerms}`;

    const transactionalPatterns = [
      "buy",
      "price",
      "pricing",
      "cheap",
      "discount",
      "deal",
      "book now",
      "order now",
      "best laptop",
      "best hotel",
      "near me",
      "hire",
      "subscribe",
      "sign up",
      "trial",
      "compare",
      "top 10",
    ];

    return transactionalPatterns.some((p) => haystack.includes(p));
  }
}

module.exports = IntentPolicyGate;