const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");

const RegistrationOtpService = require("../services/RegistrationOtpService");

const router = express.Router();
const sessions = new SessionService();
const regOtp = new RegistrationOtpService();

// -------------------- OTP Registration --------------------

// POST /api/auth/register  (start OTP)
router.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, acceptTerms } = req.body || {};
    const out = await regOtp.start({ firstName, lastName, email, password, acceptTerms });
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});


// POST /api/auth/register/verify (finish OTP -> creates user + session)
router.post("/register/verify", async (req, res) => {
  try {
    const { pendingId, otp } = req.body || {};
    const out = await regOtp.verify({ pendingId, otp });
    res.json({ ok: true, ...out }); // { userId, token, expiresAt }
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// -------------------- Login / Logout --------------------

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const pool = getPool();

    const [rows] = await pool.execute(
      `
      SELECT u.user_id, ua.password_hash
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

    const { user_id: userId, password_hash: passwordHash } = rows[0];
    const ok = await bcrypt.compare(String(password), passwordHash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "invalid email or password" });
    }

    const { token, expiresAt } = await sessions.createSession({ userId });
    res.json({ ok: true, userId, token, expiresAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "login failed" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  try {
    const auth = req.header("authorization") || "";
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m) return res.json({ ok: true }); // already logged out

    await sessions.deleteSessionByToken(m[1].trim());
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "logout failed" });
  }
});

module.exports = router;
