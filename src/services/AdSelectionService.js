// src/services/AdSelectionService.js

const ContextExtractor = require("./ContextExtractor");
const CandidateRetriever = require("./CandidateRetriever");
const EligibilityFilter = require("./EligibilityFilter");
const Ranker = require("./Ranker");
const DecisionTracer = require("./DecisionTracer");
const EmbeddingService = require("./EmbeddingService");

const ContextSnapshotRepository = require("../repositories/ContextSnapshotRepository");
const AdIndexRepository = require("../repositories/AdIndexRepository");
const AdDecisionRepository = require("../repositories/AdDecisionRepository");
const AdEventRepository = require("../repositories/AdEventRepository");

// Optional gate (file exists in your project now)
let IntentPolicyGate = null;
try {
  // eslint-disable-next-line global-require
  IntentPolicyGate = require("./IntentPolicyGate");
} catch (e) {
  IntentPolicyGate = null;
}

// ---------- Helpers ----------
function normalizeText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTerms(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return [];
  const raw = t.match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
  const stop = new Set([
    "the","a","an","and","or","but","to","of","in","on","for","with","is","are","was","were","be","been",
    "it","this","that","i","you","we","they","he","she","my","your","our","their","me","us","them",
  ]);
  return raw.filter(w => w.length > 1 && !stop.has(w));
}

function unique(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

class AdSelectionService {
  constructor() {
    this.contextExtractor = new ContextExtractor();

    this.contextRepo = new ContextSnapshotRepository();
    this.adIndexRepo = new AdIndexRepository();
    this.decisionRepo = new AdDecisionRepository();
    this.eventRepo = new AdEventRepository();

    this.retriever = new CandidateRetriever({ adIndexRepo: this.adIndexRepo });
    this.filter = new EligibilityFilter();
    this.ranker = new Ranker();
    this.tracer = new DecisionTracer();

    this.embedder = new EmbeddingService();

    this.gate = IntentPolicyGate ? new IntentPolicyGate({ eventRepo: this.eventRepo }) : null;

    this.MAX_ADS = 2;
    this.CANDIDATE_LIMIT = 200;
  }

  async selectAds({ conversationId, userId, turnIndex, messages }) {
    // 1) Extract context
    const extracted = this.contextExtractor.extract({ messages }) || {};

    const contextCard = extracted.contextCard;
    const contextText = extracted.contextText;
    const keywords = extracted.keywords || [];
    const phrases = extracted.phrases || [];
    const safetyFlags = extracted.safetyFlags || {};
    const intent = extracted.intent || extracted.intents || null;

    const queryText =
      extracted.queryText ||
      normalizeText([contextText, ...phrases, ...keywords].filter(Boolean).join(" "));

    const queryTerms =
      extracted.queryTerms ||
      unique(tokenizeTerms(queryText));

    // 2) Embed the canonical query text (for embedding rerank)
    // Fail-soft: if embedding API fails, we still run BM25-only fallback ranking.
    const embedding = await this.embedder.embedText(queryText);

    // 3) Snapshot (always create, for audit trail)
    const snapshotId = await this.contextRepo.insertSnapshot({
      conversationId,
      turnIndex,
      contextJson: contextCard,
      contextText,
      embeddingJson: embedding,
      safetyFlagsJson: safetyFlags,
    });

    // 4) Intent/Policy gating
    let gateResult = {
      showAds: true,
      constraints: {},
      reasonCodes: [],
    };

    if (this.gate && typeof this.gate.evaluate === "function") {
      try {
        gateResult = await this.gate.evaluate({
          conversationId,
          userId,
          turnIndex,
          intent,
          safetyFlags,
          queryText,
          queryTerms,
          messages,
        });
      } catch (e) {
        gateResult = {
          showAds: true,
          constraints: {},
          reasonCodes: ["gate_error_fail_open"],
        };
      }
    }

    // If gated off: log a no-ad decision and return
    if (!gateResult?.showAds) {
      const traceMeta = {
        snapshotId,
        conversationId,
        turnIndex,
        queryText,
        queryTerms,
        candidateCount: 0,
        eligibleCount: 0,
        selectedCount: 0,
        topScore: null,
        gated: true,
        gateReasons: gateResult?.reasonCodes || [],
        gateConstraints: gateResult?.constraints || {},
        retrieval: null,
        ranking: null,
      };

      const traceJson = this.tracer.buildTrace({
        contextCard,
        candidatesScored: [],
        chosen: null,
        meta: traceMeta,
      });

      const decisionId = await this.decisionRepo.insertDecision({
        conversationId,
        snapshotId,
        chosenAdId: null,
        traceJson,
      });

      await this.eventRepo.logEvent({
        conversationId,
        snapshotId,
        adId: null,
        eventType: "no_ad_selected",
        eventMeta: {
          reason: "policy_gate_block",
          gateReasons: gateResult?.reasonCodes || [],
          decisionId,
        },
      });

      return {
        ads: [],
        snapshotId,
        decisionId,
        why: {
          keywords: keywords || [],
          phrases: phrases || [],
          safety: safetyFlags || {},
          queryText,
          queryTerms,
          gate: {
            showAds: false,
            reasonCodes: gateResult?.reasonCodes || [],
            constraints: gateResult?.constraints || {},
          },
          version: traceJson.version,
        },
      };
    }

    const constraints = gateResult?.constraints || {};

    // 5) Candidate retrieval (BM25 preferred)
    let candidates = [];
    if (typeof this.retriever.retrieveCandidatesBM25 === "function") {
      candidates = await this.retriever.retrieveCandidatesBM25({
        limit: this.CANDIDATE_LIMIT,
        queryTerms,
        queryText,
        constraints,
        keywords,
        phrases,
      });
    } else {
      candidates = await this.retriever.retrieveCandidates({
        limit: this.CANDIDATE_LIMIT,
        keywords,
        phrases,
      });
    }

    // 6) Eligibility filtering
    let eligible = [];
    try {
      eligible = this.filter.filter({ candidates, safetyFlags, constraints });
    } catch (e) {
      eligible = this.filter.filter({ candidates, safetyFlags });
    }

    // 7) Ranking (embedding rerank preferred)
    let scored = [];
    if (typeof this.ranker.rerank === "function") {
      scored = await this.ranker.rerank({
        candidates: eligible,
        queryEmbedding: embedding,
        queryText,
        queryTerms,
        safetyFlags,
        constraints,
      });
    } else {
      scored = this.ranker.score({
        candidates: eligible,
        keywords,
        phrases,
      });
    }

    scored = Array.isArray(scored) ? scored : [];
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

    const chosenAds = scored.slice(0, this.MAX_ADS).filter(a => (a.score || 0) > 0);

    // 8) Trace + decision
    const traceMeta = {
      snapshotId,
      conversationId,
      turnIndex,
      queryText,
      queryTerms,
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      selectedCount: chosenAds.length,
      topScore: scored[0]?.score ?? null,
      gated: false,
      gateReasons: gateResult?.reasonCodes || [],
      gateConstraints: constraints,
      retrieval: typeof this.retriever.retrieveCandidatesBM25 === "function" ? "bm25_candidates" : "legacy_candidates",
      ranking: typeof this.ranker.rerank === "function" ? "embedding_rerank" : "legacy_ranker",
    };

    const traceJson = this.tracer.buildTrace({
      contextCard,
      candidatesScored: scored,
      chosen: chosenAds[0] || null,
      meta: traceMeta,
    });

    const decisionId = await this.decisionRepo.insertDecision({
      conversationId,
      snapshotId,
      chosenAdId: chosenAds[0]?.adId || null,
      traceJson,
    });

    // 9) Events
    if (chosenAds.length > 0) {
      await Promise.all(
        chosenAds.map(ad =>
          this.eventRepo.logEvent({
            conversationId,
            snapshotId,
            adId: ad.adId,
            eventType: "impression_selected",
            eventMeta: { score: ad.score, reason: ad.reason, decisionId },
          })
        )
      );
    } else {
      await this.eventRepo.logEvent({
        conversationId,
        snapshotId,
        adId: null,
        eventType: "no_ad_selected",
        eventMeta: {
          reason: "no_positive_score",
          topScore: scored[0]?.score ?? null,
          gateReasons: gateResult?.reasonCodes || [],
          decisionId,
        },
      });
    }

    const ads = chosenAds.map(a => ({
      adId: a.adId,
      title: a.title,
      description: a.description,
      imageUrl: a.imageUrl,
      landingUrl: a.landingUrl,
      score: a.score,
      reason: a.reason,
    }));

    const why = {
      keywords: keywords || [],
      phrases: phrases || [],
      safety: safetyFlags || {},
      queryText,
      queryTerms,
      gate: {
        showAds: true,
        reasonCodes: gateResult?.reasonCodes || [],
        constraints: constraints || {},
      },
      version: traceJson.version,
    };

    return { ads, snapshotId, decisionId, why };
  }
}

module.exports = AdSelectionService;
