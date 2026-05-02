const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");

/*
 * SessionService:
 * Handles session validation using hashed tokens stored in DB.
 */
const sessions = new SessionService();

/*
 * -------------------------
 * Helper: extractToken
 * -------------------------
 *
 * Extracts authentication token from:
 * 1. Cookie (preferred for browser-based auth)
 * 2. Authorization header (Bearer token)
 *
 * Supports flexibility across:
 * - Web clients (cookies)
 * - API clients (headers)
 */
function extractToken(req) {
   // Check cookie first (primary mechanism)
  if (req.cookies?.convad_token) {
    return String(req.cookies.convad_token).trim();
  }

  // Fallback to Authorization header
  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : null;
}

/*
 * -------------------------
 * Middleware: requireAuth
 * -------------------------
 *
 * Ensures the request is authenticated.
 *
 * Flow:
 * - Extract token
 * - Validate session via DB
 * - Attach userId to request
 */
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);

     // No token → not logged in
    if (!token) {
      return res.status(401).json({ ok: false, error: "not logged in" });
    }

    // Validate session token
    const session = await sessions.getSessionByToken(token);

    // Invalid / expired session
    if (!session) {
      return res.status(401).json({ ok: false, error: "session expired or invalid" });
    }

    // Attach identity to request for downstream use
    req.userId = session.userId;
    req.sessionToken = token;
    next();
  } catch (e) {
    console.error("requireAuth error:", e);
    res.status(500).json({ ok: false, error: "auth failed" });
  }
}

/*
 * -------------------------
 * Middleware: requireAdmin
 * -------------------------
 *
 * Extends requireAuth by enforcing role-based access control.
 *
 * Flow:
 * - Validate session
 * - Query user role from DB
 * - Allow only ADMIN users
 */
async function requireAdmin(req, res, next) {
  try {
    const token = extractToken(req);
     // No token → not logged in
    if (!token) {
      return res.status(401).json({ ok: false, error: "not logged in" });
    }

    // Validate session token
    const session = await sessions.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "session expired or invalid" });
    }

    // Fetch user role from database
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT role FROM users WHERE user_id = ? LIMIT 1`,
      [session.userId]
    );

     // User not found (edge case)
    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "user not found" });
    }

    // Enforce admin-only access
    if (rows[0].role !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "admin only" });
    }

    // Attach user context
    req.userId = session.userId;
    req.userRole = rows[0].role;
    req.sessionToken = token;

    next();
  } catch (e) {
    console.error("requireAdmin error:", e);
    res.status(500).json({ ok: false, error: "auth failed" });
  }
}

module.exports = { requireAuth, requireAdmin };