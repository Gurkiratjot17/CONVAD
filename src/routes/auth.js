const express = require("express");
const authController = require("../controllers/authController");

const router = express.Router();

// -------------------- OTP Registration --------------------
router.post("/register", authController.register);
router.post("/register/resend", authController.resendRegistrationOtp);
router.post("/register/verify", authController.verifyRegistrationOtp);

// -------------------- Login / Logout --------------------
router.post("/login", authController.login);
router.post("/logout", authController.logout);

module.exports = router;