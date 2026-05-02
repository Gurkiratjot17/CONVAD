const express = require("express");

/*
 * authController:
 * Handles all authentication-related logic including:
 * - OTP-based registration flow
 * - Login / logout
 * - Session management
 */
const authController = require("../controllers/authController");

const router = express.Router();

/*
 * -------------------------
 * OTP-Based Registration
 * -------------------------
 *
 * Multi-step registration flow:
 * 1. User submits details → OTP generated & sent via email
 * 2. User can request OTP resend (rate-limited)
 * 3. User verifies OTP → account is created
 */

// Start registration (creates pending record + sends OTP)
router.post("/register", authController.register);

// Resend OTP (with rate limiting and resend constraints)
router.post("/register/resend", authController.resendRegistrationOtp);

// Verify OTP and complete account creation
router.post("/register/verify", authController.verifyRegistrationOtp);

/*
 * -------------------------
 * Authentication
 * -------------------------
 *
 * Handles session-based login and logout.
 */

// Login user (validates credentials and creates session/token)
router.post("/login", authController.login);

// Logout user (invalidates session/token)
router.post("/logout", authController.logout);

module.exports = router;