// src/services/StreamingChatService.js

/*
 * StreamingChatService
 *
 * Coordinates the main chat flow:
 * - conversation creation
 * - message persistence
 * - LLM prompt construction
 * - streaming assistant response
 * - contextual ad selection
 * - conversation title generation
 */

const ConversationRepository = require("../repositories/ConversationRepository");
const LLMService = require("./LLMService");
const OpenAIClient = require("./OpenAIClient");
const ContextBuilder = require("./ContextBuilder");
const AdService = require("./AdService");

/*
 * Builds a readable conversation title from the first meaningful user message.
 *
 * This avoids generic titles such as "hi" or "hello" and improves
 * conversation list usability.
 */
function buildTitleFromFirstUserMessage(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  // normalize whitespace + strip obvious noise
  let s = raw.replace(/\s+/g, " ").trim();

  // ignore tiny / low-signal openers
  const tooShort = s.length < 6;
  const lowSignal = /^(hi|hey|hello|hii|ok|okay|yo|sup|thanks|thank you)\b/i.test(s);
  if (tooShort || lowSignal) return null;

  // remove leading filler phrases
  s = s
    .replace(/^(please\s+)?(can you|could you|would you|do you|i want to|i wanna|help me|tell me)\s+/i, "")
    .replace(/^(how to|how do i|how can i)\s+/i, "")
    .trim();

  // if it’s a question, drop trailing question mark
  s = s.replace(/[?.!]+$/g, "").trim();

  // simple intent-based phrasing
  const patterns = [
    { re: /\bdocker\b/i, title: "Docker help" },
    { re: /\bmysql\b|\bsql\b/i, title: "MySQL / SQL help" },
    { re: /\bnode\b|\bnode\.js\b|\bexpress\b/i, title: "Node / Express help" },
    { re: /\bhost\b|\bhosting\b|\bdeploy\b/i, title: "Hosting / Deployment" },
    { re: /\bcook\b|\brecipe\b|\bparatha\b|\bdal\b|\bchai\b/i, title: "Cooking ideas" },
    { re: /\btravel\b|\btrip\b|\bflight\b|\bhotel\b/i, title: "Travel planning" },
    { re: /\bworkout\b|\bgym\b|\bfitness\b/i, title: "Fitness" },
    { re: /\bresume\b|\bcv\b|\blinkedin\b/i, title: "CV / LinkedIn" },
  ];

  for (const p of patterns) {
    if (p.re.test(raw)) return p.title;
  }

  // fallback: title-case a short snippet of the cleaned message
  const maxLen = 60;
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();

  const words = s.split(" ").slice(0, 8);
  const small = new Set(["a","an","the","and","or","but","to","of","in","on","for","with","at","by"]);
  const titled = words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i > 0 && small.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(" ");

  return titled || "Conversation";
}

class StreamingChatService {
  constructor() {
      /*
     * Repository and service dependencies used by the streaming chat workflow.
     */
    this.repo = new ConversationRepository();
    this.llm = new LLMService();
    this.client = new OpenAIClient();

     // Still used for building the LLM prompt context (separate from ad matching)
    /*
     * ContextBuilder prepares recent messages for the LLM prompt.
     */
    this.contextBuilder = new ContextBuilder({ repo: this.repo });

     // Ad service now supports contextual matching via AdSelectionService
    /*
     * AdService runs contextual advertisement selection after the assistant reply.
     */
    this.ads = new AdService();

     /*
     * Context window sizes.
     *
     * LAST_N is used by ContextBuilder for prompt context.
     * LAST_M is used for messages passed to the LLM and ad-matching context.
     */
    this.LAST_N = 3;  // used by ContextBuilder
    this.LAST_M = 3;  // used for LLM messages sent to model + ad matching context
  }


  /*
   * Streams a chat response and performs contextual ad selection.
   */
  async streamChat({ userId, conversationId, text, onToken }) {
    // 1) Validate / create conversation
    /*
     * Use existing conversation if supplied; otherwise create a new one.
     */
    let convId = conversationId ? Number(conversationId) : null;
    if (conversationId && Number.isNaN(convId)) throw new Error("conversationId must be numeric");

    if (!convId) {
      convId = await this.repo.createConversation({ userId, title: null });
    }

    // 2) Persist user message
    /*
     * Store user message before calling the LLM so the database remains
     * the source of truth for conversation history.
     */
    await this.repo.addMessage({ conversationId: convId, role: "user", content: text });

    // 3) Build prompt context (for the LLM only)
    /*
     * Build recent contextual messages for prompt construction.
     */
    const contextMessages = await this.contextBuilder.build({
      conversationId: convId,
      lastN: this.LAST_N,
    });

    // 4) Load conversation messages (DB truth) to send to LLM
    /*
     * Reload messages from storage to ensure the LLM receives DB-consistent state.
     */
    const convBefore = await this.repo.getConversation(convId);
    const messagesForLLM = (convBefore.messages || [])
      .slice(-this.LAST_M)
      .map((m) => ({ role: m.role, content: m.content }));

     /*
     * Build the system prompt for normal assistant response generation.
     */
    const system = this.llm.replyOnlySystemPrompt({ contextmessages: contextMessages });

    // 5) Stream assistant reply
     /*
     * Stream model output token-by-token to support low-latency UX.
     */
    let fullReply = "";
    await this.client.chatStream({
      system,
      messages: messagesForLLM,
      onDelta: (delta) => {
        fullReply += delta;
        if (typeof onToken === "function") onToken(delta);
      },
    });

    // 6) Persist assistant reply
     /*
     * Store the completed assistant reply after streaming finishes.
     */
    await this.repo.addMessage({ conversationId: convId, role: "assistant", content: fullReply });

    // 7) Reload conversation to ensure ads are matched against DB-consistent context
     /*
     * Ad matching happens after the assistant response so the ad pipeline
     * can consider the latest conversational turn.
     */
    const convAfter = await this.repo.getConversation(convId);
    const messagesForAds = (convAfter.messages || [])
      .slice(-this.LAST_M)
      .map((m) => ({ role: m.role, content: m.content }));

    // Turn index = number of messages stored so far (simple, consistent)
    /*
     * Turn index gives the ad policy gate a simple measure of conversation progress.
     */
    const turnIndex = (convAfter.messages || []).length;

    // 8) Contextual ad selection (no tags)
    /*
     * Run contextual ad selection using recent messages only.
     *
     * This supports session-level ad targeting without persistent profiling.
     */
    const { ads: matchedAds, snapshotId, decisionId, why } =
      await this.ads.selectAdsForConversation({
        conversationId: convId,
        userId,
        turnIndex,
        messages: messagesForAds,
      });

    /*
     * Development/evaluation log for tracing ad-selection results.
     */
    console.log("[ContextualAds]", {
      conversationId: convId,
      userId,
      snapshotId,
      decisionId,
      matchedAds,
      why,
    });

    // 9) Title if missing (run once)
    /*
     * Generate a conversation title only if one has not already been set.
     */
    const updated = await this.repo.getConversation(convId);

    if (!updated.title) {
      /*
       * Find the first user message that can produce a meaningful title.
       */
      const firstMeaningfulUser =
        (updated.messages || []).find(
          (m) => m.role === "user" && buildTitleFromFirstUserMessage(m.content)
        )?.content || "";

      const title = buildTitleFromFirstUserMessage(firstMeaningfulUser);
      if (title) await this.repo.updateTitle(convId, title);
    }

    // 10) Response payload (frontend can ignore meta for now)
    /*
     * Return chat metadata and selected ads to the frontend.
     */
    return {
      conversationId: convId,
      ads: matchedAds,
      meta: { snapshotId, decisionId, why },
    };
  }

   /*
   * Retrieves a single conversation by ID.
   */
  async getConversation(conversationId) {
    const id = Number(conversationId);
    if (Number.isNaN(id)) throw new Error("conversationId must be numeric");
    return this.repo.getConversation(id);
  }

   /*
   * Lists conversations for a user.
   */
  async listConversations(userId) {
    return this.repo.listConversations(userId);
  }
}

module.exports = StreamingChatService;
