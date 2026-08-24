"use strict";

const { getMasterConnection } = require("../config/masterDb");
const { getOperationsConnection } = require("../config/operationsDb");
const { ROLES, MODULES, PERMISSION_LEVELS } = require("../common/constants");
const AppError = require("../common/AppError");
const { sendSuccess } = require("../utils/response.utils");

// @desc    Invite a new staff member (generates an invite token link, same as resident flow)
// @route   POST /api/staff
// @access  Private (Admin / Facility Manager — STAFF_MANAGEMENT FULL)
exports.addStaff = async (req, res, next) => {
    try {
        const { name, mobile, email, designation, shiftTiming, gateOrArea, address } = req.body;

        if (!name || !mobile || !designation || !shiftTiming) {
            return next(new AppError("Name, mobile, designation, and shiftTiming are required", 400));
        }

        const masterDb = getMasterConnection();
        const opsDb = getOperationsConnection();

        const User = opsDb.model("User");
        const Staff = opsDb.model("Staff");
        const InviteToken = masterDb.model("InviteToken");
        const UserSocietyMapping = masterDb.model("UserSocietyMapping");

        const societyId = req.societyId;

        // Check for duplicate mobile in this society
        const existingUser = await User.findOne({ societyId, mobile: mobile.trim() });
        if (existingUser) {
            return next(new AppError("A user with this mobile number already exists in this society", 409));
        }

        let user;
        let staff;
        let plainToken;

        try {
            // Create user with INVITED status — no password needed yet
            const userData = {
                societyId,
                name: name.trim(),
                mobile: mobile.trim(),
                role: ROLES.GENERAL_STAFF,
                status: "invited",
                isActive: false,
            };
            if (email) userData.email = email.toLowerCase().trim();

            user = await User.create(userData);

            // Create the Staff profile linked to the user
            staff = await Staff.create({
                societyId,
                userId: user._id,
                name: user.name,
                role: designation,                // maps to STAFF_TYPE enum in ops staff model
                phone: mobile.trim(),
                address: address || undefined,
                shift: shiftTiming,
                gateOrArea: gateOrArea || undefined,
                isActive: false,
                status: "invited",
            });

            // Create UserSocietyMapping for login resolution
            const identifier = email ? email.toLowerCase().trim() : mobile.trim();
            await UserSocietyMapping.create({
                identifier,
                societyId,
                userId: user._id,
                roleKeys: [ROLES.GENERAL_STAFF],
            });

            // Generate invite token (same mechanism as resident)
            const { plainToken: pt, tokenHash } = InviteToken.generateToken();
            plainToken = pt;

            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 48); // 48h window for staff

            await InviteToken.create({
                tokenHash,
                societyId,
                adminId: user._id,
                purpose: "staff",
                expiresAt,
            });
        } catch (err) {
            // Rollback on failure
            if (user?._id) {
                const Staff = opsDb.model("Staff");
                await Staff.deleteOne({ userId: user._id, societyId }).catch(() => {});
                await User.deleteOne({ _id: user._id }).catch(() => {});
            }
            throw err;
        }

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${plainToken}`;

        console.log("\n=============================================");
        console.log("=== DEV STAFF INVITE LINK ===");
        console.log(`Staff: ${user.name} (${mobile})`);
        console.log(`Designation: ${designation} | Shift: ${shiftTiming}`);
        console.log(`Link: ${inviteLink}`);
        console.log("=============================================\n");

        const userObj = { ...user.toObject() };
        delete userObj.password;

        return sendSuccess(res, 201, "Staff member invited successfully", {
            user: userObj,
            staff: { ...staff.toObject(), designation: staff.role },
            ...(process.env.NODE_ENV === "development" ? { devInviteLink: inviteLink } : {}),
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get all staff for this society
// @route   GET /api/staff
// @access  Private
exports.getAllStaff = async (req, res, next) => {
    try {
        const opsDb = getOperationsConnection();
        const Staff = opsDb.model("Staff");
        const User = opsDb.model("User");

        const { designation } = req.query;
        const filter = { societyId: req.societyId };

        if (designation && designation !== "All roles") {
            filter.role = designation.toLowerCase().replace(/ /g, "_");
        }

        const staffList = await Staff.find(filter).sort({ createdAt: -1 }).lean();
        console.log(`[getAllStaff] societyId=${req.societyId} filter=${JSON.stringify(filter)} found=${staffList.length}`);

        // Populate user info
        const userIds = staffList.map((s) => s.userId).filter(Boolean);
        const users = await User.find({ _id: { $in: userIds } }).lean();
        const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

        const enriched = staffList.map((s) => ({
            ...s,
            designation: s.role,
            user: s.userId ? userMap[s.userId.toString()] || null : null,
        }));

        return sendSuccess(res, 200, "Staff retrieved successfully", enriched);
    } catch (error) {
        next(error);
    }
};

// @desc    Get shift and gate view
// @route   GET /api/staff/shift-view
// @access  Private
exports.getShiftAndGateView = async (req, res, next) => {
    try {
        const opsDb = getOperationsConnection();
        const Staff = opsDb.model("Staff");
        const User = opsDb.model("User");

        const staffList = await Staff.find({ societyId: req.societyId, isActive: true })
            .sort({ shift: 1 })
            .lean();

        const userIds = staffList.map((s) => s.userId).filter(Boolean);
        const users = await User.find({ _id: { $in: userIds } }).lean();
        const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

        const enriched = staffList.map((s) => ({
            ...s,
            user: s.userId ? userMap[s.userId.toString()] || null : null,
        }));

        return sendSuccess(res, 200, "Shift view retrieved successfully", enriched);
    } catch (error) {
        next(error);
    }
};
