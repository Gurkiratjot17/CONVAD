const crypto = require("crypto");

/*
 * Generates a 6-digit numeric OTP.
 *
 * Uses crypto.randomInt for secure randomness.
 *
 * Range:
 * - 100000 → 999999 (ensures fixed 6 digits, no leading zeros)
 */
function generateOtp6() {
  return String(crypto.randomInt(100000, 1000000));
}

/*
 * Hashes the OTP using SHA-256 with a server-side pepper.
 *
 * Security design:
 * - OTP is NEVER stored in plaintext
 * - Pepper (secret) prevents rainbow table attacks
 *
 * Format:
 *   hash = sha256(otp + ":" + pepper)
 *
 * Requirements:
 * - process.env.OTP_PEPPER must be set securely
 */
function hashOtp(otp) {
  const pepper = process.env.OTP_PEPPER;

   /*
   * Fail fast if pepper is missing.
   * This avoids storing weak or unhashed OTPs.
   */
  if (!pepper) throw new Error("OTP_PEPPER is missing");
  return crypto.createHash("sha256").update(`${otp}:${pepper}`).digest("hex");
}

module.exports = { generateOtp6, hashOtp };
