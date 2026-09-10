"use strict";

const mongoose = require("mongoose");

/**
 * Gate — physical entry/exit point of the society.
 */
const gateSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        name: {
            type: String,
            required: [true, "Gate name is required"],
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

gateSchema.index({ societyId: 1, isActive: 1 });

module.exports = gateSchema;
