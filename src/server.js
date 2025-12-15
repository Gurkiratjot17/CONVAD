const app = require("./app");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`CONVAD server listening on port ${PORT}`);
  console.log(`Click on http://localhost:${PORT}`);
});
