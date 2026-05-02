const express = require("express");

/*
 * Middleware enforcing admin-level access control.
 *
 * Ensures:
 * - Only authenticated admin users can access these routes
 * - Prevents direct API abuse (critical beyond UI protection)
 */
const { requireAdmin } = require("../middleware/auth");

/*
 * Controller handling all admin-related business logic:
 * - Ads management
 * - Analytics
 * - System metrics
 * - Trends
 */
const adminController = require("../controllers/adminController");

const router = express.Router();

/*
 * -------------------------
 * Ads Management Endpoints
 * -------------------------
 *
 * Provides CRUD + analytics for advertisement entities.
 */

// Get all ads (admin view)
router.get("/ads", requireAdmin, adminController.listAds);

// Get a specific ad by ID
router.get("/ads/:adId", requireAdmin, adminController.getAd);

// Update ad details (e.g., content, targeting fields)
router.put("/ads/:adId", requireAdmin, adminController.updateAd);

// Get analytics for a specific ad
// Includes impressions, clicks, hides, CTR, etc.
router.get("/ads/:adId/analytics", requireAdmin, adminController.getAdAnalytics);

/*
 * -------------------------
 * System Metrics
 * -------------------------
 *
 * Provides high-level KPIs across the platform.
 */
router.get("/metrics", requireAdmin, adminController.getMetrics);

/*
 * -------------------------
 * Trends & Insights
 * -------------------------
 *
 * Enables analysis of ad performance over time.
 */

// Get top-performing / trending ads
router.get("/trends", requireAdmin, adminController.getTrends);

// Get time-series trend data (for charts)
router.get("/trends/timeseries", requireAdmin, adminController.getTrendsTimeSeries);

// Get reasons / explanations behind trend performance
// (likely derived from decision traces or keyword signals)
router.get("/trends/:adId/reasons", requireAdmin, adminController.getTrendReasons);

module.exports = router;