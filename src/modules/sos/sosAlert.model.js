"use strict";

const mongoose = require("mongoose");
const { SOS_STATUS } = require("../../common/constants");

/**
 * SOSAlert — Emergency alerts triggered by residents.
 */
const sosAlertSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        residentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "residentId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
        },
        status: {
            type: String,
            enum: Object.values(SOS_STATUS),
            default: SOS_STATUS.ACTIVE,
        },
        acknowledgedByGuardId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        acknowledgedAt: {
            type: Date,
        },
        resolutionNote: {
            type: String,
            trim: true,
        },
        resolvedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);

sosAlertSchema.index({ societyId: 1, status: 1 });

module.exports = sosAlertSchema;
