const SessionService = require("../services/SessionService");
const sessions = new SessionService();

async function requireAuth(req, res, next) {
  try {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ ok: false, error: "not logged in" });

    const token = m[1].trim();
    const session = await sessions.getSessionByToken(token);
    if (!session) return res.status(401).json({ ok: false, error: "session expired or invalid" });

    req.userId = session.userId;
    req.sessionToken = token;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "auth failed" });
  }
}

module.exports = { requireAuth };
