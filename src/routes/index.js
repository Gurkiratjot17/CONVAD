const express = require("express");
const healthRouter = require("./health");
const conversationsRouter = require("./conversations");

const router = express.Router();

router.get("/api", (req, res) => {
  res.json({ name: "convad", status: "ok" });
});

router.use("/health", healthRouter);

// Keep your existing path for the UI client:
router.use("/conversations", conversationsRouter);

module.exports = router;
