const express = require("express");
const path = require("path");

const routes = require("./routes");

const app = express();

// Middleware
app.use(express.json());

// Static UI (Option A)
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/", routes);

module.exports = app;
