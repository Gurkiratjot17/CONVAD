const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");
const RegistrationOtpService = require("../services/RegistrationOtpService");

/*
 * Service instances used by authentication controller actions.
 */
const sessions = new SessionService();
const regOtp = new RegistrationOtpService();

/*
 * Starts OTP-based registration.
 *
 * Creates a pending registration record and sends an OTP email.
 */
async function register(req, res) {
  try {
    const { firstName, lastName, email, password, acceptTerms } = req.body || {};
    const out = await regOtp.start({ firstName, lastName, email, password, acceptTerms });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

/*
 * Resends OTP for an existing pending registration.
 */
async function resendRegistrationOtp(req, res) {
  try {
    const { pendingId } = req.body || {};
    const out = await regOtp.resend({ pendingId });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

/*
 * Verifies registration OTP and creates a user account.
 *
 * On successful verification, a session token is issued and stored
 * in an HTTP-only cookie.
 */
async function verifyRegistrationOtp(req, res) {
  try {
    const { pendingId, otp } = req.body || {};
    const out = await regOtp.verify({ pendingId, otp });

     /*
     * If verification returns a token, persist it as an HTTP-only cookie.
     */
    if (out && out.token) {
      const isProd = process.env.NODE_ENV === "production";
      res.cookie("convad_token", out.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        maxAge: 1000 * 60 * 60 * 24 * 7,
        path: "/",
      });
    }

    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

/*
 * Authenticates an existing user using email and password.
 *
 * Flow:
 * - Validate required credentials
 * - Load stored password hash
 * - Compare password using bcrypt
 * - Create session token
 * - Set session cookie
 */
async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    /*
     * Basic credential presence check.
     */
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "email and password are required",
      });
    }

     /*
     * Normalise email before lookup.
     */
    const cleanEmail = String(email).trim().toLowerCase();
    const pool = getPool();

    /*
     * Retrieve user identity, role, and password hash.
     */
    const [rows] = await pool.execute(
      `
      SELECT u.user_id, u.role, ua.password_hash
      FROM users u
      JOIN user_auth ua ON ua.user_id = u.user_id
      WHERE u.email = ?
      LIMIT 1
      `,
      [cleanEmail]
    );

    /*
     * Use generic error message to avoid revealing whether email exists.
     */
    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    const { user_id: userId, role, password_hash: passwordHash } = rows[0];

    /*
     * Compare submitted password against bcrypt hash.
     */
    const ok = await bcrypt.compare(String(password), passwordHash);

    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    /*
     * Create a new authenticated session.
     */
    const { token, expiresAt } = await sessions.createSession({ userId });
    const isProd = process.env.NODE_ENV === "production";

    /*
     * Store token in an HTTP-only cookie to reduce exposure to client-side JS.
     */
    res.cookie("convad_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });

    /*
     * Return session details for frontend state management.
     */
    res.json({ ok: true, userId, role, token, expiresAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "login failed" });
  }
}

/*
 * Logs the user out by deleting their active session token.
 */
async function logout(req, res) {
  try {
     /*
     * Support logout through either Authorization header or cookie token.
     */
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = (m && m[1] ? m[1].trim() : null) || req.cookies?.convad_token;

    /*
     * If no token is available, still clear cookie and return success.
     */
    if (!token) {
      res.clearCookie("convad_token", { path: "/" });
      return res.json({ ok: true });
    }

    /*
     * Remove session from database and clear browser cookie.
     */
    await sessions.deleteSessionByToken(token);
    res.clearCookie("convad_token", { path: "/" });

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "logout failed" });
  }
}

module.exports = {
  register,
  resendRegistrationOtp,
  verifyRegistrationOtp,
  login,
  logout,
};