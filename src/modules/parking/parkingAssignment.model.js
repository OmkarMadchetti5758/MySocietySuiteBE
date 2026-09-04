"use strict";

const mongoose = require("mongoose");
const {
    PARKING_ASSIGNMENT_STATUS,
    PARKING_ASSIGNMENT_TYPE,
} = require("../../common/constants");

/**
 * ParkingAssignment — links a parking slot to a resident/vehicle.
 * Lives in mysociety_operations.parkingassignments
 *
 * Double-booking protection:
 *   A partial unique index on `parkingSlotId` where status === "active"
 *   ensures only ONE active assignment per slot at any time.
 *   MongoDB rejects the duplicate with error code 11000, which the service
 *   maps to PARKING_SLOT_NOT_AVAILABLE.
 */
const parkingAssignmentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        parkingSlotId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParkingSlot",
            required: [true, "parkingSlotId is required"],
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Resident",
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
        },
        assignmentType: {
            type: String,
            enum: Object.values(PARKING_ASSIGNMENT_TYPE),
            default: PARKING_ASSIGNMENT_TYPE.PERMANENT,
        },
        status: {
            type: String,
            enum: Object.values(PARKING_ASSIGNMENT_STATUS),
            default: PARKING_ASSIGNMENT_STATUS.ACTIVE,
        },
        startDate: {
            type: Date,
            default: Date.now,
        },
        endDate: {
            type: Date, // null = open-ended (permanent)
        },
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        releasedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        releasedAt: {
            type: Date,
        },
        releaseReason: {
            type: String,
            trim: true,
        },
        transferredFrom: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParkingAssignment",
        },
        notes: {
            type: String,
            trim: true,
        },
    },
    { timestamps: true }
);

/**
 * Critical concurrency guard:
 * Only ONE active assignment is allowed per slot (partial unique index).
 */
parkingAssignmentSchema.index(
    { parkingSlotId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: "active" },
        name: "unique_active_assignment_per_slot",
    }
);

/**
 * One active vehicle assignment per vehicle (prevent same vehicle
 * being in two slots simultaneously).
 */
parkingAssignmentSchema.index(
    { vehicleId: 1 },
    {
        unique: true,
        sparse: true,
        partialFilterExpression: { status: "active" },
        name: "unique_active_vehicle_assignment",
    }
);

// Query support indexes
parkingAssignmentSchema.index({ societyId: 1, status: 1 });
parkingAssignmentSchema.index({ societyId: 1, residentId: 1, status: 1 });
parkingAssignmentSchema.index({ societyId: 1, flatId: 1, status: 1 });
parkingAssignmentSchema.index({ societyId: 1, userId: 1, status: 1 });

module.exports = parkingAssignmentSchema;
