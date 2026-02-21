const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");

const sessions = new SessionService();

// -------------------- Helper --------------------
function extractToken(req) {
  if (req.cookies?.convad_token) {
    return String(req.cookies.convad_token).trim();
  }

  const auth = req.header("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1]).trim() : null;
}

// -------------------- Require Auth --------------------
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "not logged in" });
    }

    const session = await sessions.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "session expired or invalid" });
    }

    req.userId = session.userId;
    req.sessionToken = token;
    next();
  } catch (e) {
    console.error("requireAuth error:", e);
    res.status(500).json({ ok: false, error: "auth failed" });
  }
}

// -------------------- Require Admin --------------------
async function requireAdmin(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "not logged in" });
    }

    const session = await sessions.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({ ok: false, error: "session expired or invalid" });
    }

    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT role FROM users WHERE user_id = ? LIMIT 1`,
      [session.userId]
    );

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "user not found" });
    }

    if (rows[0].role !== "ADMIN") {
      return res.status(403).json({ ok: false, error: "admin only" });
    }

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