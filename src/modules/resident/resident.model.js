"use strict";

const mongoose = require("mongoose");
const { RESIDENT_TYPE } = require("../../common/constants");

/**
 * Resident — links a user to a flat within a society.
 * Lives in mysociety_operations.residents
 */
const residentSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        flatId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Flat",
            required: [true, "flatId is required"],
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "userId is required"],
        },
        residentType: {
            type: String,
            enum: Object.values(RESIDENT_TYPE),
            required: [true, "Resident type is required"],
        },
        moveInDate: {
            type: Date,
        },
        moveOutDate: {
            type: Date,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        emergencyContact: {
            name: String,
            phone: String,
            relation: String,
        },
    },
    { timestamps: true }
);

residentSchema.index({ societyId: 1, flatId: 1 });
residentSchema.index({ societyId: 1, userId: 1 });

module.exports = residentSchema;
