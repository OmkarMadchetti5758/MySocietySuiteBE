"use strict";

const mongoose = require("mongoose");

const wingSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Wing name is required"],
            trim: true,
        },
        code: {
            type: String,
            required: [true, "Wing code is required"],
            trim: true,
        },
        totalFloors: {
            type: Number,
            required: [true, "Number of floors is required"],
            min: 1,
        },
        totalFlats: {
            type: Number,
            min: 0,
        },
        status: {
            type: String,
            enum: ["Active", "Inactive", "Under Maintenance"],
            default: "Active",
        },
        assignedStaff: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Staff",
        },
    },
    { _id: true }
);

/**
 * Block — one document per society, containing all its wings.
 * Lives in mysociety_operations.blocks
 */
const blockSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
            unique: true, // One record per society
        },
        wings: [wingSchema],
    },
    { timestamps: true }
);

blockSchema.index({ societyId: 1 }, { unique: true });

module.exports = blockSchema;
