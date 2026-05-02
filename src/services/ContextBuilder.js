// src/services/ContextBuilder.js

/*
 * ContextBuilder
 *
 * Responsible for constructing the conversational context window
 * passed into the LLM.
 *
 * Design role:
 * - Acts as a bridge between stored conversation data and model input
 * - Ensures only relevant recent messages are included (context window control)
 * - Keeps formatting consistent with LLM expectations (role/content pairs)
 */

const ConversationRepository = require("../repositories/ConversationRepository");
class ContextBuilder {
  constructor() {
     /*
     * Repository used to fetch stored conversation messages.
     *
     * Abstracting this allows flexibility in how conversations are stored
     * (e.g., database, cache, or external service).
     */
     this.repo = new ConversationRepository();
  }

   /*
   * Builds a context window for the current conversation.
   *
   * Input:
   * - conversationId → identifies the conversation session
   * - lastN → number of most recent messages to include
   *
   * Output:
   * - Array of messages formatted as:
   *   [{ role: "user" | "assistant", content: "..." }]
   *
   * Rationale:
   * - Limits context size to control token usage and latency
   * - Focuses on short-term conversational intent (session-level modelling)
   */
  async build({ conversationId, lastN }) {
     /*
     * Fetch the last N messages from storage.
     *
     * Assumption:
     * - Messages are returned in chronological order (or already sorted)
     */
    const recent = await this.repo.getLastNMessages(conversationId, lastN);
    
      /*
     * Transform database records into LLM-compatible format.
     *
     * Only role and content are retained to keep the prompt minimal.
     */
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }
}

module.exports = ContextBuilder;
