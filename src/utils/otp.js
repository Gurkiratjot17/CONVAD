const crypto = require("crypto");

function generateOtp6() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashOtp(otp) {
  const pepper = process.env.OTP_PEPPER;
  if (!pepper) throw new Error("OTP_PEPPER is missing");
  return crypto.createHash("sha256").update(`${otp}:${pepper}`).digest("hex");
}

module.exports = { generateOtp6, hashOtp };
