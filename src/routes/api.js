const express = require("express");

/*
 * requireAuth middleware:
 * Ensures the user is authenticated before accessing any route.
 *
 * Typically:
 * - Validates session token (cookie/header)
 * - Attaches user info to request (e.g., req.user)
 */
const { requireAuth } = require("../middleware/auth");

/*
 * chatController:
 * Handles all user-facing chat logic, conversation retrieval,
 * and ad interaction tracking.
 */
const chatController = require("../controllers/chatController");

const router = express.Router();

/*
 * -------------------------
 * User Profile
 * -------------------------
 *
 * Returns basic information about the currently authenticated user.
 */
router.get("/me", requireAuth, chatController.getMe);

/*
 * -------------------------
 * Conversations
 * -------------------------
 *
 * Core chat history management endpoints.
 */

// List all conversations for the authenticated user
router.get("/conversations", requireAuth, chatController.listConversations);

// Get a single conversation by ID
router.get("/conversations/:id", requireAuth, chatController.getConversation);

/*
 * -------------------------
 * Chat (Streaming)
 * -------------------------
 *
 * Streams assistant response token-by-token.
 * Also triggers contextual ad selection after response generation.
 */
router.post("/chat/stream", requireAuth, chatController.streamChat);

/*
 * -------------------------
 * Ad Interaction Tracking
 * -------------------------
 *
 * Logs user interactions with ads for analytics and evaluation.
 *
 * These events are critical for:
 * - CTR calculation
 * - Engagement metrics
 * - Policy evaluation (e.g., gating effectiveness)
 */

// User clicked on an ad
router.post("/ads/:adId/click", requireAuth, chatController.logAdClick);

// User dismissed/hidden an ad
router.post("/ads/:adId/hide", requireAuth, chatController.logAdHide);

// Ad was actually rendered to the user (important distinction from "selected")
router.post("/ads/:adId/render", requireAuth, chatController.logAdRender);

module.exports = router;