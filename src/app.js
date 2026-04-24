// src/app.js (or wherever this file lives in your backend)
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser"); // ✅ ADD

const api = require("./routes/api");
const auth = require("./routes/auth");
const admin = require("./routes/adminRoutes"); // ✅ ADD

// ✅ ADD (middleware we’ll create next, to protect /admin static)
const { requireAdmin } = require("./middleware/auth");

const app = express();

app.use(express.json({ limit: "1mb" }));

// ✅ ADD (needed to read convad_token from cookies)
app.use(cookieParser());

// Serve UI from /app folder
const webRoot = path.join(__dirname, "..", "app");
app.use(express.static(webRoot));
app.get("/", (req, res) => res.sendFile(path.join(webRoot, "index.html")));

// ✅ ADD: Protect and serve Admin Portal static pages
// This does NOT affect your existing /app UI or /api routes.
const adminRoot = path.join(__dirname, "..", "public", "admin");
app.use("/admin", requireAdmin, express.static(adminRoot));

// Auth + API
app.use("/api/auth", auth);
app.use("/api", api);
app.use("/api/admin", admin); // ✅ ADD

module.exports = app;