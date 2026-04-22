const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");
const RegistrationOtpService = require("../services/RegistrationOtpService");

const sessions = new SessionService();
const regOtp = new RegistrationOtpService();

async function register(req, res) {
  try {
    const { firstName, lastName, email, password, acceptTerms } = req.body || {};
    const out = await regOtp.start({ firstName, lastName, email, password, acceptTerms });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

async function resendRegistrationOtp(req, res) {
  try {
    const { pendingId } = req.body || {};
    const out = await regOtp.resend({ pendingId });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
}

async function verifyRegistrationOtp(req, res) {
  try {
    const { pendingId, otp } = req.body || {};
    const out = await regOtp.verify({ pendingId, otp });

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

async function login(req, res) {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: "email and password are required",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const pool = getPool();

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

    if (!rows.length) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    const { user_id: userId, role, password_hash: passwordHash } = rows[0];
    const ok = await bcrypt.compare(String(password), passwordHash);

    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    const { token, expiresAt } = await sessions.createSession({ userId });
    const isProd = process.env.NODE_ENV === "production";

    res.cookie("convad_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: "/",
    });

    res.json({ ok: true, userId, role, token, expiresAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "login failed" });
  }
}

async function logout(req, res) {
  try {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = (m && m[1] ? m[1].trim() : null) || req.cookies?.convad_token;

    if (!token) {
      res.clearCookie("convad_token", { path: "/" });
      return res.json({ ok: true });
    }

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