// src/repositories/UserRepository.js
const { getPool } = require("../db/mysql");

class UserRepository {
  constructor() {
    this.pool = getPool();
  }

  /**
   * Fetch minimal user profile for UI/session use
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
