/**
 * @openapi
 * components:
 *   schemas:
 *     AuthUser:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *           example: "65f1a2b3c4d5e6f7a8b9c0d1"
 *         name:
 *           type: string
 *           example: "John Doe"
 *         email:
 *           type: string
 *           format: email
 *           example: "john.doe@example.com"
 *         mobile:
 *           type: string
 *           example: "9876543210"
 *         role:
 *           type: string
 *           example: "admin"
 *         societyId:
 *           type: string
 *           example: "65f1a2b3c4d5e6f7a8b9c0d2"
 *         societyName:
 *           type: string
 *           example: "Green Meadows Residency"
 *         flatId:
 *           type: string
 *           nullable: true
 *           example: "65f1a2b3c4d5e6f7a8b9c0d3"
 *         roleKeys:
 *           type: array
 *           items:
 *             type: string
 *           example: ["admin", "resident"]
 *         isActive:
 *           type: boolean
 *           example: true
 *         status:
 *           type: string
 *           example: "active"
 *     LoginRequest:
 *       type: object
 *       required:
 *         - identifier
 *         - password
 *       properties:
 *         identifier:
 *           type: string
 *           description: Email address or 10-digit mobile number
 *           example: "admin@example.com"
 *         password:
 *           type: string
 *           format: password
 *           description: Account password
 *           example: "SecretPassword123!"
 *     LoginResponseData:
 *       type: object
 *       properties:
 *         user:
 *           $ref: '#/components/schemas/AuthUser'
 *         accessToken:
 *           type: string
 *           description: Short-lived JWT access token
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         refreshToken:
 *           type: string
 *           description: Long-lived JWT refresh token
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         permissions:
 *           type: object
 *           description: Effective permission matrix for frontend route and action guards
 *           additionalProperties:
 *             type: boolean
 *           example:
 *             residents.view: true
 *             residents.manage: true
 *             billing.view: true
 *             complaints.create: true
 *         permissionsVersion:
 *           type: integer
 *           example: 1
 *         roleKeys:
 *           type: array
 *           items:
 *             type: string
 *           example: ["admin"]
 *     GuardSendOtpRequest:
 *       type: object
 *       required:
 *         - mobile
 *       properties:
 *         mobile:
 *           type: string
 *           description: 10-digit registered mobile number of the security guard
 *           example: "9876543210"
 *     GuardVerifyOtpRequest:
 *       type: object
 *       required:
 *         - mobile
 *         - otp
 *       properties:
 *         mobile:
 *           type: string
 *           description: 10-digit registered mobile number of the security guard
 *           example: "9876543210"
 *         otp:
 *           type: string
 *           description: 6-digit OTP code received
 *           example: "123456"
 *     SuperAdminLoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Super Admin email address
 *           example: "superadmin@mysocietysuite.com"
 *         password:
 *           type: string
 *           format: password
 *           description: Super Admin password
 *           example: "SuperAdminSecretKey"
 *     RefreshTokenRequest:
 *       type: object
 *       required:
 *         - refreshToken
 *       properties:
 *         refreshToken:
 *           type: string
 *           description: Valid refresh token
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *     RefreshTokenResponseData:
 *       type: object
 *       properties:
 *         accessToken:
 *           type: string
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         refreshToken:
 *           type: string
 *           example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         permissions:
 *           type: object
 *         permissionsVersion:
 *           type: integer
 *           example: 1
 *         roleKeys:
 *           type: array
 *           items:
 *             type: string
 *           example: ["admin"]
 *     ValidateInviteResponseData:
 *       type: object
 *       properties:
 *         adminName:
 *           type: string
 *           example: "Jane Doe"
 *         adminEmail:
 *           type: string
 *           format: email
 *           example: "jane.doe@example.com"
 *         adminPhone:
 *           type: string
 *           example: "9876543210"
 *         societyId:
 *           type: string
 *           example: "65f1a2b3c4d5e6f7a8b9c0d2"
 *         societyName:
 *           type: string
 *           example: "Royal Palms Residency"
 *         userRole:
 *           type: string
 *           example: "admin"
 *         purpose:
 *           type: string
 *           example: "resident"
 *         otpEmailVerified:
 *           type: boolean
 *           example: true
 *         otpPhoneVerified:
 *           type: boolean
 *           example: false
 *     ActivateInviteRequest:
 *       type: object
 *       required:
 *         - token
 *         - password
 *       properties:
 *         token:
 *           type: string
 *           description: Plain invite token received in the activation link
 *           example: "f8a7c2b5d4e1..."
 *         password:
 *           type: string
 *           format: password
 *           minLength: 6
 *           description: New password for the account (minimum 6 characters)
 *           example: "NewSecurePassword123!"
 *     ResendInviteRequest:
 *       type: object
 *       required:
 *         - email
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: Email address of the user whose invitation needs to be resent
 *           example: "pendinguser@example.com"
 *     UpdateMeRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "John Doe Updated"
 *         mobile:
 *           type: string
 *           example: "9876500000"
 */

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: User Login
 *     description: Authenticate a society member, manager, or admin using email/mobile and password. If the user is linked to multiple societies, supply the `x-tenant-id` header to select the society.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: header
 *         name: x-tenant-id
 *         schema:
 *           type: string
 *         required: false
 *         description: MongoDB ObjectId of the society. Mandatory if user belongs to more than one society.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful. Returns user profile, access token, and refresh token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 data:
 *                   $ref: '#/components/schemas/LoginResponseData'
 *       400:
 *         description: Validation failed (e.g. identifier or password missing).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: User account is inactive.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Society or user not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       409:
 *         description: Multi-society user detected. Prompt user to select a society and resend with x-tenant-id.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/guard/send-otp:
 *   post:
 *     summary: Send OTP for Guard Login
 *     description: Initiates OTP delivery to a registered security guard's mobile number and email.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GuardSendOtpRequest'
 *     responses:
 *       200:
 *         description: OTP sent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "OTP sent successfully"
 *                 data:
 *                   type: object
 *       400:
 *         description: Mobile number missing.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: User found but does not have the security guard role.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No account found with this mobile number.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/guard/verify-otp:
 *   post:
 *     summary: Verify Guard OTP
 *     description: Validates the one-time password and logs in the security guard, auto-activating guard status on first login.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: header
 *         name: x-tenant-id
 *         schema:
 *           type: string
 *         required: false
 *         description: MongoDB ObjectId of the society (optional).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GuardVerifyOtpRequest'
 *     responses:
 *       200:
 *         description: Guard login successful. Returns tokens and user data.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Guard login successful"
 *                 data:
 *                   $ref: '#/components/schemas/LoginResponseData'
 *       400:
 *         description: Mobile and OTP required or invalid/expired OTP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Account not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/super-admin/login:
 *   post:
 *     summary: Super Admin Login
 *     description: Authenticate a global Super Admin on the platform control plane.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SuperAdminLoginRequest'
 *     responses:
 *       200:
 *         description: Super Admin login successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Super Admin login successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                     accessToken:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     permissions:
 *                       type: object
 *       401:
 *         description: Invalid credentials.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: Super Admin account inactive.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/refresh-token:
 *   post:
 *     summary: Refresh Access Token
 *     description: Generate a new JWT access token and rolling refresh token using an existing valid refresh token.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RefreshTokenRequest'
 *     responses:
 *       200:
 *         description: Token refreshed successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Token refreshed successfully"
 *                 data:
 *                   $ref: '#/components/schemas/RefreshTokenResponseData'
 *       400:
 *         description: Refresh token is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token invalid or expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       403:
 *         description: User is inactive.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/invite/validate:
 *   get:
 *     summary: Validate Invitation Token
 *     description: Validate an onboarding invitation token and return metadata for account setup.
 *     tags:
 *       - Auth
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Plain invitation token from the email link
 *     responses:
 *       200:
 *         description: Invite token is valid.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Invite token is valid"
 *                 data:
 *                   $ref: '#/components/schemas/ValidateInviteResponseData'
 *       400:
 *         description: Token is missing, expired, invalid, or already used.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Associated society or user not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/invite/activate:
 *   post:
 *     summary: Activate Account via Invite Token
 *     description: Complete onboarding by submitting the invite token and chosen password. Activates the user and society/role mappings.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ActivateInviteRequest'
 *     responses:
 *       200:
 *         description: Account activated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Account activated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/LoginResponseData'
 *       400:
 *         description: Token/password missing or password under 6 characters.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/invite/resend:
 *   post:
 *     summary: Resend Invitation Email
 *     description: Invalidate previous invitations and dispatch a fresh invitation link to the specified email address.
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ResendInviteRequest'
 *     responses:
 *       200:
 *         description: Invite resent successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Invite resent successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: "Invite resent"
 *                     devInviteLink:
 *                       type: string
 *                       example: "http://localhost:5173/activate-account?token=..."
 *       400:
 *         description: Email is required.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: No pending invite found for this email address.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout Current User
 *     description: Invalidate the user's refresh token on the server.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 *       401:
 *         description: Unauthorized. Missing or invalid access token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Get Authenticated User Profile
 *     description: Retrieve the currently logged-in user's profile, including society details and permissions context.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile fetched.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "User profile fetched"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/AuthUser'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *   patch:
 *     summary: Update Authenticated User Profile
 *     description: Update profile fields such as name or mobile number.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateMeRequest'
 *     responses:
 *       200:
 *         description: Profile updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Profile updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/AuthUser'
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */

/**
 * @openapi
 * /auth/permissions:
 *   get:
 *     summary: Refresh Role Permissions
 *     description: Re-resolves role permissions from the society's role definitions and issues refreshed access and refresh tokens.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Permissions refreshed.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "success"
 *                 message:
 *                   type: string
 *                   example: "Permissions refreshed"
 *                 data:
 *                   type: object
 *                   properties:
 *                     permissions:
 *                       type: object
 *                     permissionsVersion:
 *                       type: integer
 *                       example: 2
 *                     roleKeys:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["admin"]
 *                     accessToken:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                     refreshToken:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       401:
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
