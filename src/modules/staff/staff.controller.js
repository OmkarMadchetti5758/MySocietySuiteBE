"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const { ROLES } = require("../../common/constants");
const AppError = require("../../common/AppError");
const { sendSuccess } = require("../../utils/response.utils");
const emailService = require("../../services/email.service");
const MappingRepository = require("../userSocietyMapping/userSocietyMapping.repository");
const { canonicalPhone, canonicalIdentifier } = require("../../common/loginIdentifier");

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

        const societyId = req.societyId;
        const mobileCanonical = canonicalPhone(mobile);
        const emailCanonical = canonicalIdentifier(email);

        if (!mobileCanonical) {
            return next(new AppError("A valid phone number is required", 400));
        }

        const duplicateOr = [{ mobile: mobileCanonical }, { mobile: mobile.trim() }];
        if (emailCanonical) duplicateOr.push({ email: emailCanonical });

        const existingUser = await User.findOne({ societyId, $or: duplicateOr });
        if (existingUser) {
            return next(new AppError("A user with this mobile number or email already exists in this society", 409));
        }

        let user;
        let staff;
        let plainToken;

        try {
            const userData = {
                societyId,
                name: name.trim(),
                mobile: mobileCanonical,
                role: ROLES.GENERAL_STAFF,
                status: "invited",
                isActive: false,
            };
            if (emailCanonical) userData.email = emailCanonical;

            user = await User.create(userData);

            staff = await Staff.create({
                societyId,
                userId: user._id,
                name: user.name,
                role: designation,
                phone: mobileCanonical,
                address: address || undefined,
                shift: shiftTiming,
                gateOrArea: gateOrArea || undefined,
                isActive: false,
                status: "invited",
            });

            await MappingRepository.createMappings({
                societyId,
                userId: user._id,
                email: emailCanonical,
                mobile: mobileCanonical,
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
                const Mapping = masterDb.model("UserSocietyMapping");
                await Mapping.deleteMany({ userId: user._id, societyId }).catch(() => {});
                await Staff.deleteOne({ userId: user._id, societyId }).catch(() => {});
                await User.deleteOne({ _id: user._id }).catch(() => {});
            }
            throw err;
        }

        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const inviteLink = `${frontendUrl}/activate-account?token=${plainToken}`;

        await emailService.sendInviteEmail({
            to: email,
            recipientName: user.name,
            roleLabel: designation || "Staff",
            inviteLink,
        });

        if (process.env.NODE_ENV === "development") {
            console.log("\n=============================================");
            console.log("=== DEV STAFF INVITE LINK ===");
            console.log(`Staff: ${user.name} (${mobileCanonical}${emailCanonical ? ` / ${emailCanonical}` : ""})`);
            console.log(`Designation: ${designation} | Shift: ${shiftTiming}`);
            console.log(`Link: ${inviteLink}`);
            console.log("=============================================\n");
        }

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
