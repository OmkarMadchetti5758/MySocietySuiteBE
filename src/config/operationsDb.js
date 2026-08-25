"use strict";

const mongoose = require("mongoose");
const env = require("./env");

let opsConnection = null;

/**
 * Connects to the shared Operations Database (mysociety_operations).
 *
 * This replaces the old per-tenant dynamic connection model.
 * All operational collections (users, flats, complaints, etc.) live here.
 * Every document carries a mandatory `societyId` field for logical tenant isolation.
 *
 * Should be called once at server startup alongside connectMasterDB().
 */
const connectOperationsDB = async () => {
    if (opsConnection) {
        return opsConnection;
    }

    try {
        opsConnection = await mongoose.createConnection(env.MONGODB_URI, {
            dbName: env.OPERATIONS_DB_NAME,
        }).asPromise();

        // ── Register all operational collection models ──────────────────────
        // Each model uses the societyId-scoped schemas defined in their module.
        opsConnection.model("User",                  require("../modules/user/user.model"));
        opsConnection.model("Block",                 require("../modules/block/block.model"));
        opsConnection.model("Flat",                  require("../modules/flat/flat.model"));
        opsConnection.model("Resident",              require("../modules/resident/resident.model"));
        opsConnection.model("Vehicle",               require("../modules/vehicle/vehicle.model"));
        opsConnection.model("ParkingSlot",           require("../modules/parking/parkingSlot.model"));
        opsConnection.model("VisitorEntry",          require("../modules/visitor/visitorEntry.model"));
        opsConnection.model("MaintenanceBill",       require("../modules/maintenance/maintenanceBill.model"));
        opsConnection.model("PaymentTransaction",    require("../modules/payment/paymentTransaction.model"));
        opsConnection.model("Complaint",             require("../modules/complaint/complaint.model"));
        opsConnection.model("Notice",                require("../modules/notice/notice.model"));
        opsConnection.model("Poll",                  require("../modules/poll/poll.model"));
        opsConnection.model("PollVote",              require("../modules/poll/pollVote.model"));
        opsConnection.model("Amenity",               require("../modules/amenity/amenity.model"));
        opsConnection.model("AmenitySlot",           require("../modules/amenity/amenitySlot.model"));
        opsConnection.model("AmenityBooking",        require("../modules/booking/amenityBooking.model"));
        opsConnection.model("Vendor",                require("../modules/vendor/vendor.model"));
        opsConnection.model("Staff",                 require("../modules/staff/staff.model"));
        opsConnection.model("Attendance",            require("../modules/attendance/attendance.model"));
        opsConnection.model("Document",              require("../modules/document/document.model"));
        opsConnection.model("FestivalCollection",    require("../modules/festival/festivalCollection.model"));
        opsConnection.model("FestivalContribution",  require("../modules/festival/festivalContribution.model"));
        opsConnection.model("AIAssistantQueryLog",   require("../modules/auditLog/aiAssistantQueryLog.model"));
        opsConnection.model("Notification",          require("../modules/notification/notification.model"));
        opsConnection.model("RolePermissionAudit",   require("../modules/role/rolePermissionAudit.model"));
        opsConnection.model("ManagerAssignment",     require("../modules/managerAssignment/managerAssignment.model"));
        // ────────────────────────────────────────────────────────────────────

        console.log(`✅ Operations DB connected: ${opsConnection.name}`);
        return opsConnection;
    } catch (error) {
        console.error(`❌ Operations DB connection error: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Returns the active operations DB connection.
 * Must be called after connectOperationsDB() has resolved.
 *
 * Use this in repositories instead of the old getTenantConnection().
 */
const getOperationsConnection = () => {
    if (!opsConnection) {
        throw new Error(
            "Operations DB is not connected. Call connectOperationsDB() first."
        );
    }
    return opsConnection;
};

module.exports = { connectOperationsDB, getOperationsConnection };
