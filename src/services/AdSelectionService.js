// src/services/AdSelectionService.js

/*
 * AdSelectionService
 *
 * Coordinates the full advertisement selection pipeline:
 * context extraction, query preparation, embedding generation,
 * policy gating, candidate retrieval, eligibility filtering,
 * ranking, decision tracing, and event logging.
 */

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


/*
 * IntentPolicyGate is loaded defensively.
 *
 * This allows the ad-selection pipeline to continue operating even if
 * the policy gate module is unavailable during development or testing.
 */
let IntentPolicyGate = null;
try {
  // eslint-disable-next-line global-require
  IntentPolicyGate = require("./IntentPolicyGate");
} catch (e) {
  IntentPolicyGate = null;
}

// ---------- Helpers ----------
/*
 * Normalises text before tokenisation or query construction.
 */
function normalizeText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Tokenises query text into simple searchable terms.
 *
 * Common stop words are removed so retrieval focuses on meaningful
 * intent-bearing words rather than generic conversation terms.
 */
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

/*
 * Removes duplicate values while preserving usable non-empty entries.
 */
function unique(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

class AdSelectionService {
  constructor() {
     /*
     * Core pipeline components.
     *
     * Each component owns one stage of the ad-selection process, keeping
     * the service modular and easier to test or replace.
     */
    this.contextExtractor = new ContextExtractor();

    /*
     * Repository layer used to persist snapshots, decisions, and events.
     *
     * These records provide auditability for evaluation, debugging,
     * and explanation of why a particular ad was selected.
     */
    this.contextRepo = new ContextSnapshotRepository();
    this.adIndexRepo = new AdIndexRepository();
    this.decisionRepo = new AdDecisionRepository();
    this.eventRepo = new AdEventRepository();

     /*
     * Retrieval, filtering, ranking, and tracing services.
     */
    this.retriever = new CandidateRetriever({ adIndexRepo: this.adIndexRepo });
    this.filter = new EligibilityFilter();
    this.ranker = new Ranker();
    this.tracer = new DecisionTracer();

    /*
     * Embedding service supports semantic reranking when available.
     */
    this.embedder = new EmbeddingService();

    /*
     * Policy gate controls whether ads should be shown for the current turn.
     *
     * If unavailable, the system continues without policy gating.
     */
    this.gate = IntentPolicyGate ? new IntentPolicyGate({ eventRepo: this.eventRepo }) : null;

      /*
     * Selection limits.
     *
     * MAX_ADS controls how many ads can be returned.
     * CANDIDATE_LIMIT controls the retrieval pool before filtering/ranking.
     */
    this.MAX_ADS = 2;
    this.CANDIDATE_LIMIT = 200;
  }

   /*
   * Runs the complete ad-selection process for a conversation turn.
   */
  async selectAds({ conversationId, userId, turnIndex, messages }) {
    // 1) Extract context
    /*
     * Extract immediate session-level context from recent conversation messages.
     *
     * This supports the CONVAD design goal of using current conversational
     * intent rather than persistent user profiling.
     */
    const extracted = this.contextExtractor.extract({ messages }) || {};

    const contextCard = extracted.contextCard;
    const contextText = extracted.contextText;
    const keywords = extracted.keywords || [];
    const phrases = extracted.phrases || [];
    const safetyFlags = extracted.safetyFlags || {};
    const intent = extracted.intent || extracted.intents || null;

     /*
     * Build a canonical query text used by both lexical retrieval and
     * embedding-based ranking.
     */
    const queryText =
      extracted.queryText ||
      normalizeText([contextText, ...phrases, ...keywords].filter(Boolean).join(" "));

    /*
     * Query terms provide a lightweight lexical representation for BM25
     * candidate retrieval and trace explanation.
     */
    const queryTerms =
      extracted.queryTerms ||
      unique(tokenizeTerms(queryText));

    // 2) Embed the canonical query text (for embedding rerank)
    // Fail-soft: if embedding API fails, we still run BM25-only fallback ranking.
    const embedding = await this.embedder.embedText(queryText);

     // 3) Snapshot (always create, for audit trail)
    /*
     * Store the extracted context before selection.
     *
     * This makes each ad decision reproducible and supports later evaluation
     * through admin analytics and decision traces.
     */
    const snapshotId = await this.contextRepo.insertSnapshot({
      conversationId,
      turnIndex,
      contextJson: contextCard,
      contextText,
      embeddingJson: embedding,
      safetyFlagsJson: safetyFlags,
    });

     // 4) Intent/Policy gating
    /*
     * Default behaviour is fail-open: show ads unless the policy gate
     * explicitly blocks them.
     */
    let gateResult = {
      showAds: true,
      constraints: {},
      reasonCodes: [],
    };

    /*
     * Evaluate policy constraints for the current turn.
     *
     * The gate may apply frequency limits, safety restrictions,
     * intent-based constraints, or other ad-exposure rules.
     */
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
        /*
         * Fail-open behaviour prevents the whole chat pipeline from breaking
         * if the policy gate fails unexpectedly.
         */
        gateResult = {
          showAds: true,
          constraints: {},
          reasonCodes: ["gate_error_fail_open"],
        };
      }
    }

    // If gated off: log a no-ad decision and return
    if (!gateResult?.showAds) {
      /*
       * Even when no ad is shown, a trace is still created.
       *
       * This is important because blocked decisions are part of the system's
       * policy behaviour and should be visible during evaluation.
       */
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

       /*
       * Persist a no-ad decision so policy-blocked turns are still auditable.
       */
      const decisionId = await this.decisionRepo.insertDecision({
        conversationId,
        snapshotId,
        chosenAdId: null,
        traceJson,
      });

      /*
       * Log an event explaining that no ad was selected because of policy gating.
       */
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

     /*
     * Constraints returned by the policy gate are passed downstream
     * into retrieval, filtering, and ranking.
     */
    const constraints = gateResult?.constraints || {};

    // 5) Candidate retrieval (BM25 preferred)
    let candidates = [];

     /*
     * Prefer BM25 retrieval where available because it supports stronger
     * lexical matching against extracted query terms.
     *
     * The legacy retriever remains as a fallback for compatibility.
     */
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

    /*
     * Remove candidates that violate safety, policy, or eligibility constraints.
     *
     * The fallback supports older filter implementations that do not accept
     * the constraints parameter.
     */
    try {
      eligible = this.filter.filter({ candidates, safetyFlags, constraints });
    } catch (e) {
      eligible = this.filter.filter({ candidates, safetyFlags });
    }

    // 7) Ranking (embedding rerank preferred)
    let scored = [];

     /*
     * Prefer semantic reranking when supported.
     *
     * This allows BM25 to provide a broad candidate pool while embeddings
     * improve contextual relevance during final ranking.
     */
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
       /*
       * Legacy scoring fallback based on extracted keywords and phrases.
       */
      scored = this.ranker.score({
        candidates: eligible,
        keywords,
        phrases,
      });
    }

     /*
     * Ensure ranking output is always an array and order candidates
     * from highest to lowest score.
     */
    scored = Array.isArray(scored) ? scored : [];
    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

     /*
     * Select only the top positively scored advertisements.
     */
    const chosenAds = scored.slice(0, this.MAX_ADS).filter(a => (a.score || 0) > 0);

    // 8) Trace + decision
    /*
     * Metadata summarises the whole selection path.
     *
     * This trace supports explainability by recording retrieval type,
     * ranking strategy, candidate counts, gate state, and top score.
     */
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

     /*
     * Build a decision trace using the scored candidates and chosen ad.
     */
    const traceJson = this.tracer.buildTrace({
      contextCard,
      candidatesScored: scored,
      chosen: chosenAds[0] || null,
      meta: traceMeta,
    });

     /*
     * Persist the decision record.
     *
     * Only the first chosen ad is stored as chosenAdId, while full scoring
     * details remain available in traceJson.
     */
    const decisionId = await this.decisionRepo.insertDecision({
      conversationId,
      snapshotId,
      chosenAdId: chosenAds[0]?.adId || null,
      traceJson,
    });

    // 9) Events
    /*
     * Log selected impressions for analytics.
     *
     * These events represent ads selected by the backend pipeline, not
     * necessarily ads that were rendered in the browser.
     */
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
       /*
       * Log no-ad outcome when retrieval/ranking completes but no candidate
       * receives a positive score.
       */
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

     /*
     * Prepare selected ads for frontend rendering.
     *
     * Only presentation-safe ad fields are returned to the client.
     */
    const ads = chosenAds.map(a => ({
      adId: a.adId,
      title: a.title,
      description: a.description,
      imageUrl: a.imageUrl,
      landingUrl: a.landingUrl,
      score: a.score,
      reason: a.reason,
    }));

      /*
     * Explainability payload returned with the response.
     *
     * This supports “why this ad?” functionality and provides useful
     * evidence for system evaluation.
     */
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
