const { getPool } = require("../db/mysql");

/*
 * ConversationRepository
 *
 * Handles persistence and retrieval of conversations and messages.
 *
 * Purpose:
 * - Store user/assistant chat history
 * - Retrieve conversations for the UI
 * - Provide recent messages for LLM context building
 */
class ConversationRepository {

   /*
   * Creates a new conversation for a user.
   */
  async createConversation({ userId, title = null }) {
    const pool = getPool();
    const [res] = await pool.execute(
      `INSERT INTO conversations (user_id, title) VALUES (?, ?)`,
      [userId, title]
    );
    return res.insertId; // conversation_id
  }

  /*
   * Adds a message to an existing conversation.
   */
  async addMessage({ conversationId, role, content }) {
    const pool = getPool();
    const [res] = await pool.execute(
      `INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)`,
      [conversationId, role, content]
    );
    return res.insertId; // message_id
  }

  /*
   * Retrieves a conversation and its messages.
   */
  async getConversation(conversationId) {
    const pool = getPool();

    /*
     * First fetch conversation metadata.
     */
    const [convRows] = await pool.execute(
      `SELECT conversation_id, user_id, title, created_at, updated_at
       FROM conversations
       WHERE conversation_id = ?
       LIMIT 1`,
      [conversationId]
    );
    if (!convRows.length) return null;

    const conv = convRows[0];

    /*
     * Then fetch all messages in chronological order.
     */
    const [msgRows] = await pool.execute(
      `SELECT message_id, role, content, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, message_id ASC`,
      [conversationId]
    );

    /*
     * Convert database fields into application-friendly format.
     */
    return {
      id: conv.conversation_id,
      userId: conv.user_id,
      title: conv.title,
      createdAt: conv.created_at,
      updatedAt: conv.updated_at,
      messages: msgRows.map((m) => ({
        id: m.message_id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    };
  }

  /*
   * Lists recent conversations for a user.
   */
  async listConversations(userId, limit = 50) {
    const pool = getPool();

    /*
     * Clamp limit to prevent overly large result sets.
     */
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));

    const [rows] = await pool.execute(
      `SELECT conversation_id, title, created_at, updated_at
       FROM conversations
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT ${lim}`,
      [userId]
    );

    return rows.map((r) => ({
      id: r.conversation_id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /*
   * Updates the title of an existing conversation.
   */

  async updateTitle(conversationId, title) {
    const pool = getPool();
    await pool.execute(
      `UPDATE conversations
       SET title = ?, updated_at = CURRENT_TIMESTAMP
       WHERE conversation_id = ?`,
      [title, conversationId]
    );
  }

  /*
   * Retrieves the most recent N messages for context construction.
   *
   * Used by the LLM prompt builder so only a bounded recent context window
   * is sent to the model.
   */
  async getLastNMessages(conversationId, n) {
  const pool = getPool();

    /*
     * Clamp message count to avoid excessive prompt/context size.
     */
  const lim = Math.max(1, Math.min(200, Number(n) || 6));

  // Fetch newest N, then reverse so the LLM sees chronological order
  const [rows] = await pool.execute(
    `SELECT message_id, role, content, created_at
     FROM messages
     WHERE conversation_id = ?
     ORDER BY created_at DESC, message_id DESC
     LIMIT ${lim}`,
    [conversationId]
  );

  /*
     * Reverse result so messages are returned oldest → newest.
     */
  return rows
    .reverse()
    .map((m) => ({
      id: m.message_id,
      role: m.role,
      content: m.content,
      createdAt: m.created_at,
    }));
}


}

module.exports = ConversationRepository;
