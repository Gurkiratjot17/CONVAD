const express = require("express");
const path = require("path");

const api = require("./routes/api");
const auth = require("./routes/auth");

const app = express();

app.use(express.json({ limit: "1mb" }));

// Serve UI from /app folder
const webRoot = path.join(__dirname, "..", "app");
app.use(express.static(webRoot));
app.get("/", (req, res) => res.sendFile(path.join(webRoot, "index.html")));


// Auth + API
app.use("/api/auth", auth);
app.use("/api", api);

module.exports = app;
