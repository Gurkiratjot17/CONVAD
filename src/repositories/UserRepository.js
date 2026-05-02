// src/repositories/UserRepository.js
const { getPool } = require("../db/mysql");

/*
 * UserRepository
 *
 * Handles retrieval of user data from the database.
 *
 * Purpose:
 * - Provide user profile information for authenticated sessions
 * - Supply minimal user data for UI rendering and identity display
 */
class UserRepository {
  constructor() {
    /*
     * Reuse shared MySQL connection pool.
     */
    this.pool = getPool();
  }

  /**
   * Fetch minimal user profile for UI/session use
   *
   * Only returns non-sensitive fields:
   * - No password hashes
   * - No authentication metadata
   *
   * This ensures separation between identity data and auth data.
   */
  async getById(userId) {
    const [rows] = await this.pool.execute(
      `
      SELECT 
        user_id,
        first_name,
        last_name,
        email,
        profile_image_url
      FROM users
      WHERE user_id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!rows.length) return null;

    const u = rows[0];

    /*
     * Map database fields to application-friendly format.
     */
    return {
      userId: u.user_id,
      firstName: u.first_name || null,
      lastName: u.last_name || null,
      email: u.email,
      profileImageUrl: u.profile_image_url || null,
    };
  }
}

module.exports = UserRepository;
