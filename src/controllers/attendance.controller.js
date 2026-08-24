"use strict";

const mongoose = require("mongoose");
const { getOperationsConnection } = require("../config/operationsDb");
const AppError = require("../common/AppError");
const { sendSuccess } = require("../utils/response.utils");
const { ROLES } = require("../common/constants");

// @desc    Mark attendance for a staff member
// @route   POST /api/attendance
// @access  Private (Facility Manager / Admin — STAFF_MANAGEMENT MANAGE)
exports.markAttendance = async (req, res, next) => {
    try {
        const { staffId, date, status, notes, checkInTime, checkOutTime } = req.body;

        if (!staffId || !date || !status) {
            return next(new AppError("staffId, date, and status are required", 400));
        }

        // Defense-in-depth role guard (beyond checkPermission middleware)
        const callerRole = req.user?.role;
        const callerRoleKeys = req.user?.roleKeys || [];
        const canMark = [ROLES.FACILITY_MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.COMMITTEE_MEMBER]
            .some(r => callerRole === r || callerRoleKeys.includes(r));
        if (!canMark) {
            return next(new AppError("Only facility managers and admins can mark staff attendance", 403));
        }

        const opsDb = getOperationsConnection();
        const Attendance = opsDb.model("Attendance");

        // Normalize date to start of UTC day
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        // Upsert: update if exists, create if not
        const updatePayload = {
            status,
            markedBy: req.user._id,
            markedAt: new Date(),
        };
        if (notes !== undefined)        updatePayload.notes = notes;
        if (checkInTime !== undefined)  updatePayload.checkInTime = checkInTime;
        if (checkOutTime !== undefined) updatePayload.checkOutTime = checkOutTime;

        const attendance = await Attendance.findOneAndUpdate(
            { societyId: req.societyId, staff: staffId, date: startOfDay },
            updatePayload,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        return sendSuccess(res, 200, "Attendance marked successfully", attendance);
    } catch (error) {
        next(error);
    }
};

// @desc    Get attendance for a specific date
// @route   GET /api/attendance?date=YYYY-MM-DD
// @access  Private
exports.getAttendance = async (req, res, next) => {
    try {
        const { date } = req.query;
        if (!date) {
            return next(new AppError("Date is required", 400));
        }

        const opsDb = getOperationsConnection();
        const Attendance = opsDb.model("Attendance");

        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const attendanceList = await Attendance.find({ societyId: req.societyId, date: startOfDay }).lean();

        return sendSuccess(res, 200, "Attendance retrieved", attendanceList);
    } catch (error) {
        next(error);
    }
};

// @desc    Get monthly report per staff
// @route   GET /api/attendance/report?month=8&year=2026
// @access  Private
exports.getMonthlyReport = async (req, res, next) => {
    try {
        const { month, year } = req.query;

        if (!month || !year) {
            return next(new AppError("Month and year are required", 400));
        }

        const opsDb = getOperationsConnection();
        const Attendance = opsDb.model("Attendance");

        const startDate = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, 1));
        const endDate = new Date(Date.UTC(parseInt(year), parseInt(month), 0, 23, 59, 59));

        const reports = await Attendance.aggregate([
            {
                $match: {
                    societyId: new mongoose.Types.ObjectId(req.societyId),
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: "$staff",
                    present: { $sum: { $cond: [{ $eq: ["$status", "present"] }, 1, 0] } },
                    absent:  { $sum: { $cond: [{ $eq: ["$status", "absent"]  }, 1, 0] } },
                    leave:   { $sum: { $cond: [{ $eq: ["$status", "on-leave"]}, 1, 0] } },
                    total:   { $sum: 1 }
                }
            }
        ]);

        return sendSuccess(res, 200, "Monthly report retrieved", reports);
    } catch (error) {
        next(error);
    }
};

// @desc    Get attendance summary counts for a specific date (for stat cards)
// @route   GET /api/attendance/summary?date=YYYY-MM-DD
// @access  Private (VIEW)
exports.getSummary = async (req, res, next) => {
    try {
        const { date } = req.query;
        if (!date) {
            return next(new AppError("Date is required", 400));
        }

        const opsDb = getOperationsConnection();
        const Attendance = opsDb.model("Attendance");
        const Staff = opsDb.model("Staff");

        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const [totalStaff, statsCounts] = await Promise.all([
            Staff.countDocuments({ societyId: req.societyId }),
            Attendance.aggregate([
                { $match: { societyId: new mongoose.Types.ObjectId(req.societyId), date: startOfDay } },
                {
                    $group: {
                        _id: null,
                        present:  { $sum: { $cond: [{ $eq: ["$status", "present"]  }, 1, 0] } },
                        absent:   { $sum: { $cond: [{ $eq: ["$status", "absent"]   }, 1, 0] } },
                        onLeave:  { $sum: { $cond: [{ $eq: ["$status", "on-leave"] }, 1, 0] } },
                    },
                },
            ]),
        ]);

        const counts = statsCounts[0] || { present: 0, absent: 0, onLeave: 0 };

        return sendSuccess(res, 200, "Attendance summary retrieved", {
            total:   totalStaff,
            present: counts.present,
            absent:  counts.absent,
            onLeave: counts.onLeave,
        });
    } catch (error) {
        next(error);
    }
};
