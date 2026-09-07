"use strict";

const mongoose = require("mongoose");
const { VEHICLE_TYPE } = require("../../common/constants");

/**
 * Vehicle — resident-owned vehicle registered with the society.
 * Lives in mysociety_operations.vehicles
 *
 * Vehicle number uniqueness is enforced via a PARTIAL unique index
 * (only active vehicles). Deactivated vehicle records don't block
 * future re-registration of the same plate number.
 */
const vehicleSchema = new mongoose.Schema(
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
        regNumber: {
            type: String,
            required: [true, "Vehicle registration number is required"],
            trim: true,
            uppercase: true,
        },
        type: {
            type: String,
            enum: Object.values(VEHICLE_TYPE),
            required: [true, "Vehicle type is required"],
        },
        make: {
            type: String,
            trim: true,
        },
        model: {
            type: String,
            trim: true,
        },
        color: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

/**
 * Partial unique index: only ACTIVE vehicles must have unique registration numbers.
 * Deactivated/historical records are excluded and can share the same regNumber.
 */
vehicleSchema.index(
    { societyId: 1, regNumber: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
        name: "unique_active_vehicle_per_society",
    }
);

// Query support indexes
vehicleSchema.index({ societyId: 1, userId: 1 });
vehicleSchema.index({ societyId: 1, residentId: 1 });
vehicleSchema.index({ societyId: 1, flatId: 1 });

module.exports = vehicleSchema;
