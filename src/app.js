const express = require("express");
const path = require("path");

const api = require("./routes/api");

const app = express();

app.use(express.json({ limit: "1mb" }));

// Serve your ChatGPT-style UI from /app folder (repo root)
app.use(express.static(path.join(__dirname, "..", "app")));

// API
app.use("/api", api);

module.exports = app;
