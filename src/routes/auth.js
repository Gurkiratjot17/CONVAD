const express = require("express");
const bcrypt = require("bcryptjs");
const { getPool } = require("../db/mysql");
const SessionService = require("../services/SessionService");

const router = express.Router();
const sessions = new SessionService();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "email and password are required" });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (String(password).length < 6) {
      return res.status(400).json({ ok: false, error: "password must be at least 6 characters" });
    }

    const pool = getPool();

    const [existing] = await pool.execute(
      `SELECT user_id FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );
    if (existing.length) {
      return res.status(409).json({ ok: false, error: "email already registered" });
    }

    const [userRes] = await pool.execute(
      `INSERT INTO users (first_name, last_name, email, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [firstName || null, lastName || null, cleanEmail]
    );
    const userId = userRes.insertId;

    const passwordHash = await bcrypt.hash(String(password), 10);
    await pool.execute(
      `INSERT INTO user_auth (user_id, password_hash, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [userId, passwordHash]
    );

    const { token, expiresAt } = await sessions.createSession({ userId });

    res.json({ ok: true, userId, token, expiresAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "registration failed" });
  }
});

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
