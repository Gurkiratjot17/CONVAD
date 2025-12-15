const express = require("express");
const ConversationController = require("../controllers/ConversationController");

const router = express.Router();
const controller = new ConversationController();

router.post("/", controller.postMessage.bind(controller));
router.get("/:id", controller.getConversation.bind(controller));

module.exports = router;
