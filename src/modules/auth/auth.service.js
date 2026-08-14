"use strict";

const AuthRepository = require("./auth.repository");
const AppError = require("../../common/AppError");
const { AUTH_ERRORS } = require("./auth.constants");
const { generateAccessToken, generateRefreshToken, verifyToken } = require("../../utils/jwt.utils");
const { resolveEffectivePermissionsForRoles, normalizeRoleKeys } = require("../../common/permissionResolver");
const { getSocietyPermissionsVersion } = require("../../common/permissionsVersionCache");
const { ROLES, SOCIETY_STATUS, getRolePermissions } = require("../../common/constants");
const { getMasterConnection } = require("../../config/masterDb");

/**
 * AuthService
 *
 * After migration to the shared-collection model:
 *   - Login no longer needs `databaseName` — it uses `societyId` instead
 *   - All tokens carry `societyId` in the payload (not `databaseName`)
 *   - No getTenantConnection() calls anywhere in this service
 *
 * Login flow:
 *   1. Look up identifier in UserSocietyMapping (master DB) → get societyId(s)
 *   2. If the client provides an explicit societyId (e.g. multi-society user), use that
 *   3. Verify the resolved society is active
 *   4. Find the user in ops DB scoped by societyId + identifier
 *   5. Verify password → generate tokens
 */
class AuthService {
    /**
     * Build roleKeys, permissions, and society metadata for a society-scoped user.
     */
    async _buildUserAuthContext(user) {
        const masterDb = getMasterConnection();
        const Society = masterDb.model("Society");

        const mapping = await AuthRepository.getMappingForUser(user.societyId, user._id);
        const roleKeys = normalizeRoleKeys(
            mapping?.roleKeys?.length ? mapping.roleKeys : (mapping?.role ? [mapping.role] : null),
            user.role
        );

        const [permissions, societyDoc, permVersion] = await Promise.all([
            resolveEffectivePermissionsForRoles(user.societyId, roleKeys, user.role),
            Society.findById(user.societyId).select("name permissionsVersion").lean(),
            getSocietyPermissionsVersion(user.societyId),
        ]);

        return {
            roleKeys,
            permissions,
            permissionsVersion: permVersion,
            societyName: societyDoc?.name,
            flatId: mapping?.flatId || null,
        };
    }

    _buildTokenPayload(user, authContext) {
        return {
            id:                 user._id,
            role:               user.role,
            societyId:          user.societyId,
            permissionsVersion: authContext.permissionsVersion,
            roleKeys:           authContext.roleKeys,
        };
    }

    /**
     * @param {string} identifier   — email or mobile
     * @param {string} password
     * @param {string} [societyIdHeader] — ObjectId string from x-tenant-id header (optional override for multi-society users)
     */
    async login(identifier, password, societyIdHeader) {
        // 1. Resolve societyId
        let societyId;

        if (societyIdHeader) {
            // Client has explicitly identified the society (e.g. dropdown, subdomain)
            const society = await AuthRepository.getSocietyById(societyIdHeader);
            if (!society) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }
            societyId = society._id;
        } else {
            // Auto-resolve from UserSocietyMapping
            const mappings = await AuthRepository.getMappingsForIdentifier(identifier);
            if (!mappings || mappings.length === 0) {
                throw new AppError(AUTH_ERRORS.SOCIETY_NOT_FOUND, 404);
            }

            if (mappings.length > 1) {
                // User belongs to multiple societies — client MUST specify which one
                throw new AppError(
                    "This account is associated with multiple societies. " +
                    "Please specify your society by sending the 'x-tenant-id' header.",
                    409,
                    "MULTI_SOCIETY_USER"
                );
            }

            societyId = mappings[0].societyId;
        }

        // 2. Find user in the ops DB, scoped by societyId
        const user = await AuthRepository.findUserByIdentifier(societyId, identifier);
        if (!user) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 3. Check if active
        if (!user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // 4. Verify password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 5. Generate tokens with roleKeys + permissionsVersion
        const authContext = await this._buildUserAuthContext(user);
        const payload = this._buildTokenPayload(user, authContext);

        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // 6. Save refresh token
        await AuthRepository.saveRefreshToken(user._id, refreshToken);

        const userObj = user.toObject ? user.toObject() : { ...user };
        userObj.societyName = authContext.societyName;
        userObj.roleKeys = authContext.roleKeys;
        userObj.flatId = authContext.flatId;
        userObj.password = undefined;
        userObj.refreshToken = undefined;

        return {
            user: userObj,
            accessToken,
            refreshToken,
            permissions: authContext.permissions,
            permissionsVersion: authContext.permissionsVersion,
            roleKeys: authContext.roleKeys,
        };
    }

    /**
     * @param {string} email
     * @param {string} password
     */
    async superAdminLogin(email, password) {
        // 1. Find Super Admin in master DB
        const admin = await AuthRepository.findSuperAdminByEmail(email);
        if (!admin) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        if (!admin.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        // 2. Verify password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
        }

        // 3. Generate tokens (NO societyId in payload)
        const payload = {
            id:   admin._id,
            role: admin.role, // "super_admin"
        };

        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        // 4. Save refresh token
        await AuthRepository.saveSuperAdminRefreshToken(admin._id, refreshToken);

        // Strip sensitive fields
        admin.password     = undefined;
        admin.refreshToken = undefined;

        // 5. Return permissions matrix for the frontend
        const permissions = getRolePermissions(admin.role);

        return { user: admin, accessToken, refreshToken, permissions };
    }

    async refreshToken(token) {
        if (!token) {
            throw new AppError(AUTH_ERRORS.TOKEN_MISSING, 400);
        }

        let decoded;
        try {
            decoded = verifyToken(token, true);
        } catch (error) {
            throw new AppError(AUTH_ERRORS.TOKEN_INVALID, 401);
        }

        // Verify user still exists and is active in the ops DB
        const user = await AuthRepository.findUserById(decoded.societyId, decoded.id);
        if (!user || !user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        const authContext = await this._buildUserAuthContext(user);
        const payload = this._buildTokenPayload(user, authContext);

        const accessToken     = generateAccessToken(payload);
        const newRefreshToken = generateRefreshToken(payload);

        await AuthRepository.saveRefreshToken(user._id, newRefreshToken);

        return {
            accessToken,
            refreshToken: newRefreshToken,
            permissions: authContext.permissions,
            permissionsVersion: authContext.permissionsVersion,
            roleKeys: authContext.roleKeys,
        };
    }

    /**
     * Refresh the permissions matrix and issue new tokens with an updated permissionsVersion.
     * Called by the FE when X-Permissions-Stale is returned.
     */
    async refreshPermissions(userId, societyId, role) {
        const user = await AuthRepository.findUserById(societyId, userId);
        if (!user || !user.isActive) {
            throw new AppError(AUTH_ERRORS.USER_INACTIVE, 403);
        }

        const authContext = await this._buildUserAuthContext(user);
        const payload = this._buildTokenPayload(user, authContext);

        const accessToken  = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await AuthRepository.saveRefreshToken(user._id, refreshToken);

        return {
            permissions: authContext.permissions,
            permissionsVersion: authContext.permissionsVersion,
            roleKeys: authContext.roleKeys,
            accessToken,
            refreshToken,
        };
    }

    async logout(userId, role) {
        if (role === "super_admin") {
            await AuthRepository.clearSuperAdminRefreshToken(userId);
        } else {
            await AuthRepository.clearRefreshToken(userId);
        }
        return true;
    }

    async validateInvite(token) {
        if (!token) throw new AppError("Token is required", 400);

        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const masterDb = getMasterConnection();
        const InviteToken = masterDb.model("InviteToken");
        const User = opsDb.model("User");
        const Society = masterDb.model("Society");

        const tokenHash = InviteToken.hashToken(token);
        const invite = await InviteToken.findOne({ tokenHash });

        if (!invite) throw new AppError("Invalid or expired invite link", 400);
        if (invite.used) throw new AppError("Invite link has already been used", 400);
        if (invite.expiresAt < new Date()) throw new AppError("Invite link has expired", 400);

        const society = await Society.findById(invite.societyId);
        if (!society) throw new AppError("Associated society not found", 404);

        const user = await User.findById(invite.adminId);
        if (!user) throw new AppError("Associated user not found", 404);

        const isSocietyAdminInvite = user.role === ROLES.ADMIN;
        if (isSocietyAdminInvite && society.status !== SOCIETY_STATUS.PENDING_VERIFICATION) {
            throw new AppError("Society is no longer pending verification", 400);
        }

        return {
            adminName: user.name,
            adminEmail: user.email,
            adminPhone: user.mobile,
            societyName: society.name,
            userRole: user.role,
        };
    }

    async activateInvite(token, password) {
        if (!token || !password) throw new AppError("Token and password are required", 400);
        if (password.length < 6) throw new AppError("Password must be at least 6 characters", 400);

        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const masterDb = getMasterConnection();
        
        const InviteToken = masterDb.model("InviteToken");
        const User = opsDb.model("User");
        const Society = masterDb.model("Society");

        const tokenHash = InviteToken.hashToken(token);
        const invite = await InviteToken.findOne({ tokenHash });

        if (!invite) throw new AppError("Invalid or expired invite link", 400);
        if (invite.used) throw new AppError("Invite link has already been used", 400);
        if (invite.expiresAt < new Date()) throw new AppError("Invite link has expired", 400);

        const society = await Society.findById(invite.societyId);
        const user = await User.findById(invite.adminId);
        
        if (!society || !user) throw new AppError("Invalid invite data", 400);

        // Mark as used
        invite.used = true;
        await invite.save();

        // Update User
        user.password = password; // Will be hashed by pre-save hook
        user.status = "active";
        await user.save();

        // Activate society only for pending society-admin invites
        if (user.role === ROLES.ADMIN && society.status === SOCIETY_STATUS.PENDING_VERIFICATION) {
            society.status = SOCIETY_STATUS.TRIAL;
            await society.save();
        }

        const authContext = await this._buildUserAuthContext(user);
        const payload = this._buildTokenPayload(user, authContext);

        const accessToken = generateAccessToken(payload);
        const refreshToken = generateRefreshToken(payload);

        await AuthRepository.saveRefreshToken(user._id, refreshToken);

        user.password = undefined;

        return {
            user: {
                ...user.toObject(),
                societyName: authContext.societyName,
                roleKeys: authContext.roleKeys,
                flatId: authContext.flatId,
            },
            accessToken,
            refreshToken,
            permissions: authContext.permissions,
            permissionsVersion: authContext.permissionsVersion,
            roleKeys: authContext.roleKeys,
        };
    }

    async resendInvite(email) {
        if (!email) throw new AppError("Email is required", 400);

        const opsDb = require("../../config/operationsDb").getOperationsConnection();
        const masterDb = getMasterConnection();

        const User = opsDb.model("User");
        const InviteToken = masterDb.model("InviteToken");
        const Society = masterDb.model("Society");

        // Find the invited user by email
        const user = await User.findOne({ email: email.toLowerCase().trim(), status: "invited" });
        if (!user) throw new AppError("No pending invite found for this email address", 404);

        const society = await Society.findById(user.societyId);
        if (!society) throw new AppError("Associated society not found", 404);

        // Invalidate any existing unused tokens for this user
        await InviteToken.updateMany(
            { adminId: user._id, used: false },
            { $set: { used: true } }
        );

        // Generate a fresh token
        const { plainToken, tokenHash } = InviteToken.generateToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await InviteToken.create({
            tokenHash,
            societyId: user.societyId,
            adminId: user._id,
            expiresAt
        });

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${plainToken}`;

        console.log("\n=============================================");
        console.log("=== DEV INVITE LINK (RESEND) ===");
        console.log(`Society: ${society.name}`);
        console.log(`Admin: ${user.name} (${user.email})`);
        console.log(`Link: ${inviteLink}`);
        console.log("=============================================\n");

        return {
            message: "Invite resent",
            ...(process.env.NODE_ENV === 'development' ? { devInviteLink: inviteLink } : {})
        };
    }

    /**
     * @desc    Update current user profile
     */
    async updateMe(userContext, updateData) {
        const allowedUpdates = {};
        if (updateData.name) allowedUpdates.name = updateData.name;
        if (updateData.mobile) allowedUpdates.mobile = updateData.mobile;
        
        if (userContext.role === "super_admin") {
            const masterDb = getMasterConnection();
            const SuperAdmin = masterDb.model("SuperAdmin");
            
            const updated = await SuperAdmin.findByIdAndUpdate(
                userContext.id,
                allowedUpdates,
                { new: true, runValidators: true }
            );
            
            if (!updated) throw new AppError("User not found", 404);
            const userObj = updated.toObject();
            delete userObj.password;
            return { user: userObj };
        } else {
            const opsDb = require("../../config/operationsDb").getOperationsConnection();
            const User = opsDb.model("User");
            
            const updated = await User.findOneAndUpdate(
                { _id: userContext.id, societyId: userContext.societyId },
                allowedUpdates,
                { new: true, runValidators: true }
            );
            
            if (!updated) throw new AppError("User not found", 404);
            
            const userObj = updated.toObject();
            userObj.roleKeys = userContext.roleKeys;
            userObj.flatId = userContext.flatId;
            delete userObj.password;
            return { user: userObj };
        }
    }
}

module.exports = new AuthService();
