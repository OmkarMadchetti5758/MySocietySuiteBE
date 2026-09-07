"use strict";

const mongoose = require("mongoose");
const {
    PARKING_VIOLATION_TYPE,
    PARKING_VIOLATION_STATUS,
} = require("../../common/constants");

/**
 * ParkingViolation — recorded parking rule violations.
 * Lives in mysociety_operations.parkingviolations
 *
 * Evidence files (images) are stored as URL paths via the upload middleware.
 */
const parkingViolationSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        parkingSlotId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParkingSlot",
        },
        vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Resident",
        },
        // For unregistered vehicles
        unregisteredVehicleNumber: {
            type: String,
            trim: true,
            uppercase: true,
        },
        violationType: {
            type: String,
            enum: Object.values(PARKING_VIOLATION_TYPE),
            required: [true, "Violation type is required"],
        },
        description: {
            type: String,
            trim: true,
        },
        evidence: [
            {
                type: String, // URL paths to uploaded images
            },
        ],
        status: {
            type: String,
            enum: Object.values(PARKING_VIOLATION_STATUS),
            default: PARKING_VIOLATION_STATUS.OPEN,
        },
        reportedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "reportedBy is required"],
        },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        resolvedAt: {
            type: Date,
        },
        resolutionNote: {
            type: String,
            trim: true,
        },
    },
    { timestamps: true }
);

// Query support indexes
parkingViolationSchema.index({ societyId: 1, status: 1 });
parkingViolationSchema.index({ societyId: 1, parkingSlotId: 1 });
parkingViolationSchema.index({ societyId: 1, residentId: 1 });

module.exports = parkingViolationSchema;
