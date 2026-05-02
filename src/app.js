// src/app.js 
const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser"); // Parses cookies from incoming requests

/*
 * Route modules:
 * - api: main application endpoints
 * - auth: authentication (login/register/session)
 * - admin: admin-only APIs (analytics, ads management)
 */
const api = require("./routes/api");
const auth = require("./routes/auth");
const admin = require("./routes/adminRoutes"); 

/*
 * Middleware:
 * requireAdmin ensures only authorised admin users can access /admin routes.
 */
const { requireAdmin } = require("./middleware/auth");

const app = express();

/*
 * Enable JSON body parsing with a size limit.
 * Protects against excessively large payloads.
 */
app.use(express.json({ limit: "1mb" }));

/*
 * Enable cookie parsing.
 * Required for reading session tokens (e.g., convad_token).
 */
app.use(cookieParser());

/*
 * Serve frontend UI (user-facing application) from /app directory.
 */
const webRoot = path.join(__dirname, "..", "app");

/*
 * Static serving of main UI assets (HTML, CSS, JS).
 */
app.use(express.static(webRoot));

/*
 * Root route → loads main application entry point.
 */
app.get("/", (req, res) => res.sendFile(path.join(webRoot, "index.html")));

/*
 * Admin Portal static hosting (PROTECTED).
 *
 * Key idea:
 * - Static admin UI is served only AFTER passing requireAdmin middleware
 * - Prevents unauthorised users from even loading admin pages
 *
 * Does NOT affect:
 * - main app UI (/app)
 * - API routes (/api)
 */
const adminRoot = path.join(__dirname, "..", "public", "admin");
app.use("/admin", requireAdmin, express.static(adminRoot));

/*
 * Route mounting:
 *
 * /api/auth  → authentication endpoints
 * /api       → main application APIs
 * /api/admin → admin APIs (already protected inside routes as well)
 */
app.use("/api/auth", auth);
app.use("/api", api);
app.use("/api/admin", admin); 

module.exports = app;