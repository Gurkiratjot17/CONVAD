// src/services/AdService.js
const AdSelectionService = require("./AdSelectionService");

class AdService {
  constructor() {
    // Hybrid retrieval orchestrator (BM25 candidates + embedding rerank + policy gating)
    this.selection = new AdSelectionService();
  }

  /**
   * Primary API used by StreamingChatService:
   * Runs the full hybrid ad-selection pipeline and returns:
   * { ads, snapshotId, decisionId, why }
   */
  async selectAdsForConversation({ conversationId, userId, turnIndex, messages }) {
    return this.selection.selectAds({ conversationId, userId, turnIndex, messages });
  }
}

module.exports = AdService;
