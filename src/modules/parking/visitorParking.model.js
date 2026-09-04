"use strict";

const mongoose = require("mongoose");
const { VISITOR_PARKING_STATUS, VEHICLE_TYPE } = require("../../common/constants");

/**
 * VisitorParking — records visitor vehicle parking sessions.
 * Lives in mysociety_operations.visitorparkings
 *
 * Visitor slots (type=VISITOR) only — cannot use resident slots.
 */
const visitorParkingSchema = new mongoose.Schema(
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
        visitorName: {
            type: String,
            required: [true, "Visitor name is required"],
            trim: true,
        },
        vehicleNumber: {
            type: String,
            required: [true, "Vehicle number is required"],
            trim: true,
            uppercase: true,
        },
        vehicleType: {
            type: String,
            enum: Object.values(VEHICLE_TYPE),
            required: [true, "Vehicle type is required"],
        },
        hostResidentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Resident",
        },
        hostUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        hostFlatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        entryTime: {
            type: Date,
            default: Date.now,
        },
        expectedExitTime: {
            type: Date,
        },
        actualExitTime: {
            type: Date,
        },
        status: {
            type: String,
            enum: Object.values(VISITOR_PARKING_STATUS),
            default: VISITOR_PARKING_STATUS.ACTIVE,
        },
        recordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        exitRecordedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        notes: {
            type: String,
            trim: true,
        },
    },
    { timestamps: true }
);

// Prevent a visitor slot from having two simultaneous active sessions
visitorParkingSchema.index(
    { parkingSlotId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: "active" },
        name: "unique_active_visitor_session_per_slot",
    }
);

// Query support indexes
visitorParkingSchema.index({ societyId: 1, status: 1 });
visitorParkingSchema.index({ societyId: 1, hostFlatId: 1 });
visitorParkingSchema.index({ societyId: 1, vehicleNumber: 1 });

module.exports = visitorParkingSchema;
