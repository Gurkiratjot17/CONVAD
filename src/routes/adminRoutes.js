const express = require("express");
const { requireAdmin } = require("../middleware/auth");
const adminController = require("../controllers/adminController");

const router = express.Router();

// ----- Ads -----
router.get("/ads", requireAdmin, adminController.listAds);
router.get("/ads/:adId", requireAdmin, adminController.getAd);
router.put("/ads/:adId", requireAdmin, adminController.updateAd);
router.get("/ads/:adId/analytics", requireAdmin, adminController.getAdAnalytics);

// ----- Metrics -----
router.get("/metrics", requireAdmin, adminController.getMetrics);

// ----- Trends -----
router.get("/trends", requireAdmin, adminController.getTrends);
router.get("/trends/timeseries", requireAdmin, adminController.getTrendsTimeSeries);
router.get("/trends/:adId/reasons", requireAdmin, adminController.getTrendReasons);

module.exports = router;