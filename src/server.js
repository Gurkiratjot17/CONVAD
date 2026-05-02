/*
 * Entry point for the CONVAD backend server.
 *
 * Responsibilities:
 * - Import configured Express app
 * - Start HTTP server
 * - Bind to environment-defined port
 */

const app = require("./app");

/*
 * Determine the port to run the server on.
 *
 * Priority:
 * - Use PORT from environment (production / deployment)
 * - Fallback to 3000 for local development
 */
const PORT = process.env.PORT || 3000;

/*
 * Start the Express server.
 *
 * Once running:
 * - Listens for incoming HTTP requests
 * - Logs basic startup information to console
 */
app.listen(PORT, () => {
  console.log(`CONVAD server listening on port ${PORT}`);
  console.log(`Click on http://localhost:${PORT}`);
});