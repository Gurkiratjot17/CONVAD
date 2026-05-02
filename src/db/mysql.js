const mysql = require("mysql2/promise");

/*
 * Singleton connection pool instance.
 *
 * Ensures:
 * - Only one pool is created per application lifecycle
 * - Connections are reused efficiently
 */
let pool;

/*
 * getPool()
 *
 * Lazily initializes and returns a MySQL connection pool.
 *
 * Benefits:
 * - Avoids multiple pool creations
 * - Centralises DB configuration
 * - Improves performance via connection reuse
 */
function getPool() {
  // If pool already exists, reuse it
  if (pool) return pool;

  /*
   * Create new connection pool with environment-based configuration.
   *
   * Defaults are provided for local Docker development.
   */
  pool = mysql.createPool({
    host: process.env.DB_HOST || "db",          // IMPORTANT: use docker service name "db"
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "convad",

     /*
     * Pool behaviour settings:
     */
    waitForConnections: true,   // Queue requests when all connections are busy
    connectionLimit: 10,        // Max simultaneous DB connections
    queueLimit: 0,              // Unlimited queue (can be risky under load)

    /*
     * Timezone handling:
     * - "Z" = UTC
     * - Ensures consistency across DB + backend + analytics
     */
    timezone: "Z",
  });

  return pool;
}

module.exports = { getPool };
