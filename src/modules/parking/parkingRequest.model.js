"use strict";

const mongoose = require("mongoose");
const { PARKING_REQUEST_STATUS, PARKING_TYPE } = require("../../common/constants");

/**
 * ParkingRequest — resident request for parking slot allocation.
 * Lives in mysociety_operations.parkingrequests
 *
 * Flow: PENDING → APPROVED → (allocation created externally)
 *                REJECTED
 *                CANCELLED (by resident)
 */
const parkingRequestSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Resident",
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
        },
        vehicleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
        },
        requestedSlotType: {
            type: String,
            enum: Object.values(PARKING_TYPE),
        },
        notes: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(PARKING_REQUEST_STATUS),
            default: PARKING_REQUEST_STATUS.PENDING,
        },
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        reviewedAt: {
            type: Date,
        },
        rejectionReason: {
            type: String,
            trim: true,
        },
        // Link to the assignment created after approval
        assignmentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParkingAssignment",
        },
    },
    { timestamps: true }
);

// Query support indexes
parkingRequestSchema.index({ societyId: 1, status: 1 });
parkingRequestSchema.index({ societyId: 1, userId: 1 });
parkingRequestSchema.index({ societyId: 1, residentId: 1 });

module.exports = parkingRequestSchema;
