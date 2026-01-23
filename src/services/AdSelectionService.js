const ContextExtractor = require("./ContextExtractor");
const CandidateRetriever = require("./CandidateRetriever");
const EligibilityFilter = require("./EligibilityFilter");
const Ranker = require("./Ranker");
const DecisionTracer = require("./DecisionTracer");

const ContextSnapshotRepository = require("../repositories/ContextSnapshotRepository");
const AdIndexRepository = require("../repositories/AdIndexRepository");
const AdDecisionRepository = require("../repositories/AdDecisionRepository");
const AdEventRepository = require("../repositories/AdEventRepository");

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

    this.MAX_ADS = 2;
    this.CANDIDATE_LIMIT = 200;
  }

  async selectAds({ conversationId, userId, turnIndex, messages }) {
    const {
      contextCard,
      contextText,
      keywords,
      phrases,
      embedding,
      safetyFlags,
    } = this.contextExtractor.extract({ messages });

    const snapshotId = await this.contextRepo.insertSnapshot({
      conversationId,
      turnIndex,
      contextJson: contextCard,
      contextText,
      embeddingJson: embedding,
      safetyFlagsJson: safetyFlags,
    });

    const candidates = await this.retriever.retrieveCandidates({
      limit: this.CANDIDATE_LIMIT,
      keywords,
      phrases,
    });

    const eligible = this.filter.filter({ candidates, safetyFlags });

    const scored = this.ranker.score({ candidates: eligible, keywords, phrases });

    const chosenAds = scored.slice(0, this.MAX_ADS).filter(a => a.score > 0);

    const traceMeta = {
      snapshotId,
      conversationId,
      turnIndex,
      candidateCount: candidates.length,
      eligibleCount: eligible.length,
      selectedCount: chosenAds.length,
      topScore: scored[0]?.score ?? null,
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

    // Events: include decisionId for easier analytics
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
        eventMeta: { reason: "no_positive_score", topScore: scored[0]?.score ?? null, decisionId },
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
      version: traceJson.version,
    };

    return { ads, snapshotId, decisionId, why };
  }
}

module.exports = AdSelectionService;
