const express = require("express");
const { requireAuth } = require("../middleware/auth");
const chatController = require("../controllers/chatController");

const router = express.Router();

router.get("/me", requireAuth, chatController.getMe);

router.get("/conversations", requireAuth, chatController.listConversations);
router.get("/conversations/:id", requireAuth, chatController.getConversation);

router.post("/chat/stream", requireAuth, chatController.streamChat);

router.post("/ads/:adId/click", requireAuth, chatController.logAdClick);
router.post("/ads/:adId/hide", requireAuth, chatController.logAdHide);
router.post("/ads/:adId/render", requireAuth, chatController.logAdRender);

module.exports = router;