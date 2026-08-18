"use strict";

const ManagerAssignmentRepository = require("./managerAssignment.repository");
const OtpService                  = require("../otp/otp.service");
const AppError                    = require("../../common/AppError");
const { DEPARTMENT_HEAD_ROLES }   = require("../../common/constants");
const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection }     = require("../../config/masterDb");

/**
 * ManagerAssignmentService
 *
 * Business logic for the "Managers" tab in Settings.
 *
 * Key rules enforced here:
 *  - Single-holder: only one active/pending manager per role (v1 default)
 *  - Resident validation: active, not moved-out, not blocked
 *  - Email/phone uniqueness before creating a new user
 *  - Audit console logs (dev) replace email/SMS
 */
class ManagerAssignmentService {

    // ── Read ───────────────────────────────────────────────────────────────────

    /**
     * List all department-head roles with their current assignment.
     * Merges DEPARTMENT_HEAD_ROLES config with actual assignment docs.
     * Roles with no assignment show an "Unassigned" placeholder.
     *
     * @param {string} societyId
     * @param {{ department?: string, status?: string, search?: string }} filters
     */
    async listManagers(societyId, filters = {}) {
        // Fetch all assignments (active + pending + inactive + expired)
        const assignments = await ManagerAssignmentRepository.listAssignments(societyId, filters);
        const assignedByRole = new Map();
        for (const a of assignments) {
            if (!assignedByRole.has(a.roleKey)) {
                assignedByRole.set(a.roleKey, []);
            }
            assignedByRole.get(a.roleKey).push(a);
        }

        // Apply search filter to DEPARTMENT_HEAD_ROLES list if searching
        // (assignments already filtered by search in repository)
        let roleConfigs = DEPARTMENT_HEAD_ROLES;
        if (filters.department) {
            roleConfigs = roleConfigs.filter(
                (r) => r.department.toLowerCase() === filters.department.toLowerCase()
            );
        }

        return roleConfigs.map((config) => ({
            roleKey:     config.roleKey,
            roleName:    config.roleName,
            department:  config.department,
            allowMultiple: config.allowMultiple,
            assignments: (assignedByRole.get(config.roleKey) || []).map(this._formatAssignment),
        }));
    }

    /**
     * Get paginated residents for the Path A search modal.
     */
    async searchResidents(societyId, query) {
        return ManagerAssignmentRepository.searchResidents(societyId, query);
    }

    // ── Path A — Assign Existing Resident ─────────────────────────────────────

    /**
     * Assign an existing resident as a department-head manager.
     *
     * @param {string} societyId
     * @param {{ userId, roleKey, roleName, department, joiningDate }} data
     * @param {string} adminId  - ID of the Society Admin performing the action
     */
    async assignExistingResident(societyId, data, adminId) {
        const opsDb = getOperationsConnection();
        const User  = opsDb.model("User");

        // 1. Fetch the resident user
        const user = await User.findOne({ _id: data.userId, societyId }).lean();
        if (!user) {
            throw new AppError("Resident not found in this society.", 404, "RESIDENT_NOT_FOUND");
        }
        if (!user.isActive || user.status === "inactive") {
            throw new AppError(
                "This resident's account is inactive. Please reactivate them before assigning a manager role.",
                400, "RESIDENT_INACTIVE"
            );
        }

        // 2. Single-holder check
        const existing = await ManagerAssignmentRepository.getActiveAssignmentForRole(societyId, data.roleKey);
        if (existing) {
            throw new AppError(
                `This role already has an active manager: ${existing.managerName}. ` +
                "Deactivate the current manager before reassigning.",
                409, "ROLE_ALREADY_ASSIGNED"
            );
        }

        // 3. Duplicate user-role check
        const duplicate = await ManagerAssignmentRepository.checkDuplicateRoleAssignment(
            societyId, data.userId, data.roleKey
        );
        if (duplicate) {
            throw new AppError(
                "This resident is already assigned to this role.",
                409, "DUPLICATE_ROLE_ASSIGNMENT"
            );
        }

        // 4. Create assignment record
        const now = new Date();
        const assignment = await ManagerAssignmentRepository.createAssignment({
            societyId,
            roleKey:    data.roleKey,
            roleName:   data.roleName,
            department: data.department,
            userId:     data.userId,
            managerName:  user.name,
            managerEmail: user.email,
            managerPhone: user.mobile,
            joiningDate:  data.joiningDate || now,
            status:       "active",
            isResidentPromoted: true,
            assignedBy:  adminId,
            activatedAt: now,
        });

        // 5. Add roleKey to UserSocietyMapping so permissions resolve on next login
        await ManagerAssignmentRepository.addRoleKeyToMapping(societyId, data.userId, data.roleKey);

        // 6. Bump permissions version so resident's JWT cache invalidates
        await ManagerAssignmentRepository.bumpPermissionsVersion(societyId);

        // 7. Log audit (console in dev)
        this._logAudit("ASSIGN_RESIDENT", societyId, adminId, {
            userId: data.userId,
            name: user.name,
            roleKey: data.roleKey,
        });

        return { assignment };
    }

    // ── Path B — Invite New Manager ────────────────────────────────────────────

    /**
     * Invite a brand-new user as a department-head manager.
     *
     * @param {string} societyId
     * @param {{ name, email, phone, roleKey, roleName, department, joiningDate }} data
     * @param {string} adminId
     */
    async inviteNewManager(societyId, data, adminId) {
        const opsDb    = getOperationsConnection();
        const masterDb = getMasterConnection();
        const User     = opsDb.model("User");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        const email = data.email?.toLowerCase().trim();
        const phone = data.phone?.trim();

        if (!email && !phone) {
            throw new AppError("At least one of email or phone is required.", 400);
        }

        // 1. Single-holder check
        const existingHolder = await ManagerAssignmentRepository.getActiveAssignmentForRole(
            societyId, data.roleKey
        );
        if (existingHolder) {
            throw new AppError(
                `This role already has an active manager: ${existingHolder.managerName}. ` +
                "Deactivate the current manager before reassigning.",
                409, "ROLE_ALREADY_ASSIGNED"
            );
        }

        // 2. Uniqueness checks (email + phone across ops-DB and UserSocietyMapping)
        const [emailUserExists, phoneUserExists, emailMapped, phoneMapped] = await Promise.all([
            email ? User.findOne({ societyId, email }).lean() : Promise.resolve(null),
            phone ? User.findOne({ societyId, mobile: phone }).lean() : Promise.resolve(null),
            email ? UserSocietyMapping.findOne({ identifier: email, societyId }).lean() : Promise.resolve(null),
            phone ? UserSocietyMapping.findOne({ identifier: phone, societyId }).lean() : Promise.resolve(null),
        ]);

        if (emailUserExists || emailMapped) {
            const existingAssignment = emailUserExists
                ? await ManagerAssignmentRepository.checkDuplicateRoleAssignment(societyId, emailUserExists._id, data.roleKey)
                : null;
            if (existingAssignment?.status === "invite_pending") {
                throw new AppError(
                    "An invite is already pending for this email. Use 'Resend Invite' from the manager list.",
                    409, "INVITE_ALREADY_PENDING"
                );
            }
            throw new AppError("This email is already in use in this society.", 409, "EMAIL_EXISTS");
        }
        if (phoneUserExists || phoneMapped) {
            throw new AppError("This phone number is already in use in this society.", 409, "PHONE_EXISTS");
        }

        // 3. Create the User record with status=invited (no password yet)
        let newUser;
        try {
            newUser = await User.create({
                societyId,
                name:   data.name,
                email,
                mobile: phone,
                role:   data.roleKey,
                status: "invited",
            });
        } catch (err) {
            if (err.code === 11000) {
                throw new AppError("Email or phone already in use.", 409, "IDENTIFIER_TAKEN");
            }
            throw err;
        }

        // 4. Create ManagerAssignment record
        const assignment = await ManagerAssignmentRepository.createAssignment({
            societyId,
            roleKey:    data.roleKey,
            roleName:   data.roleName,
            department: data.department,
            userId:     newUser._id,
            managerName:  newUser.name,
            managerEmail: email,
            managerPhone: phone,
            joiningDate:  data.joiningDate || new Date(),
            status:       "invite_pending",
            isResidentPromoted: false,
            assignedBy:  adminId,
            invitedAt:   new Date(),
        });

        // 5. Create UserSocietyMapping entries
        await ManagerAssignmentRepository.createMappingForNewManager(
            societyId, newUser._id, data.roleKey, email, phone
        );

        // 6. Create invite token (7-day expiry, purpose="manager")
        const { plainToken } = await ManagerAssignmentRepository.createManagerInviteToken(
            societyId, newUser._id
        );

        // 7. Log invite link (dev) — replace with email/SMS in prod
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink  = `${frontendUrl}/activate-account?token=${plainToken}`;

        console.log("\n=============================================");
        console.log("=== DEV MANAGER INVITE LINK ===");
        console.log(`Manager: ${newUser.name} (${email || phone})`);
        console.log(`Role:    ${data.roleName} — ${data.department}`);
        console.log(`Link:    ${inviteLink}`);
        console.log("=============================================\n");

        this._logAudit("INVITE_NEW_MANAGER", societyId, adminId, {
            userId: newUser._id,
            name: newUser.name,
            roleKey: data.roleKey,
        });

        const userObj = newUser.toObject();
        delete userObj.password;

        return {
            assignment,
            user: userObj,
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }

    // ── Deactivate ─────────────────────────────────────────────────────────────

    /**
     * Deactivate a manager assignment.
     * Removes the roleKey from UserSocietyMapping so their permissions
     * reset on next login. Bumps permissionsVersion.
     *
     * @param {string} societyId
     * @param {string} assignmentId
     * @param {string} adminId
     */
    async deactivateManager(societyId, assignmentId, adminId) {
        const assignment = await ManagerAssignmentRepository.getById(societyId, assignmentId);
        if (!assignment) {
            throw new AppError("Manager assignment not found.", 404);
        }
        if (assignment.status === "inactive") {
            throw new AppError("Manager is already inactive.", 400);
        }

        // Update assignment
        const now = new Date();
        const updated = await ManagerAssignmentRepository.updateAssignment(
            societyId, assignmentId,
            { status: "inactive", deactivatedAt: now, deactivatedBy: adminId }
        );

        // Remove roleKey from mapping (if user exists)
        if (assignment.userId) {
            await ManagerAssignmentRepository.removeRoleKeyFromMapping(
                societyId, assignment.userId, assignment.roleKey
            );
            await ManagerAssignmentRepository.bumpPermissionsVersion(societyId);
        }

        this._logAudit("DEACTIVATE_MANAGER", societyId, adminId, {
            userId: assignment.userId,
            name: assignment.managerName,
            roleKey: assignment.roleKey,
        });

        return { assignment: updated };
    }

    // ── Resend Invite ──────────────────────────────────────────────────────────

    /**
     * Resend the onboarding invite for a pending/expired manager invite.
     * Invalidates old token, creates a new 7-day one.
     *
     * @param {string} societyId
     * @param {string} assignmentId
     * @param {string} adminId
     */
    async resendManagerInvite(societyId, assignmentId, adminId) {
        const assignment = await ManagerAssignmentRepository.getById(societyId, assignmentId);
        if (!assignment) {
            throw new AppError("Manager assignment not found.", 404);
        }
        if (!["invite_pending", "invite_expired"].includes(assignment.status)) {
            throw new AppError(
                "Can only resend invite for pending or expired invites.",
                400, "INVALID_STATUS_FOR_RESEND"
            );
        }
        if (!assignment.userId) {
            throw new AppError("No user associated with this assignment.", 400);
        }

        // Invalidate old tokens
        await ManagerAssignmentRepository.invalidateExistingInvites(assignment.userId);

        // Also clear any old OTPs
        const identifier = assignment.managerEmail || assignment.managerPhone;
        await OtpService.invalidateAll(identifier, "manager_invite", societyId);

        // Generate fresh invite token
        const { plainToken } = await ManagerAssignmentRepository.createManagerInviteToken(
            societyId, assignment.userId
        );

        // Reset assignment status
        await ManagerAssignmentRepository.updateAssignment(
            societyId, assignmentId,
            {
                status:       "invite_pending",
                invitedAt:    new Date(),
                emailOtpVerified: false,
                phoneOtpVerified: false,
            }
        );

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink  = `${frontendUrl}/activate-account?token=${plainToken}`;

        console.log("\n=============================================");
        console.log("=== DEV MANAGER INVITE RESEND ===");
        console.log(`Manager: ${assignment.managerName} (${identifier})`);
        console.log(`Role:    ${assignment.roleName}`);
        console.log(`Link:    ${inviteLink}`);
        console.log("=============================================\n");

        this._logAudit("RESEND_MANAGER_INVITE", societyId, adminId, {
            userId: assignment.userId,
            name: assignment.managerName,
            roleKey: assignment.roleKey,
        });

        return {
            message: "Invite resent successfully",
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        };
    }

    // ── Private Helpers ────────────────────────────────────────────────────────

    _formatAssignment(a) {
        return {
            _id:              a._id,
            userId:           a.userId,
            managerName:      a.managerName,
            managerEmail:     a.managerEmail,
            managerPhone:     a.managerPhone,
            joiningDate:      a.joiningDate,
            status:           a.status,
            isResidentPromoted: a.isResidentPromoted,
            invitedAt:        a.invitedAt,
            activatedAt:      a.activatedAt,
            deactivatedAt:    a.deactivatedAt,
            emailOtpVerified: a.emailOtpVerified,
            phoneOtpVerified: a.phoneOtpVerified,
            createdAt:        a.createdAt,
        };
    }

    _logAudit(action, societyId, adminId, details) {
        console.log(`[AUDIT] ${action} | society=${societyId} | admin=${adminId} | ${JSON.stringify(details)} | ts=${new Date().toISOString()}`);
    }
}

module.exports = new ManagerAssignmentService();
