const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.send("Final Year Project backend is running.");
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Click on http://localhost:${PORT}/`);
});
