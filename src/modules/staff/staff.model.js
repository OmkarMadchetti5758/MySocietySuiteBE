"use strict";

const mongoose = require("mongoose");
const { STAFF_TYPE } = require("../../common/constants");

/**
 * Staff — society-employed or contracted staff member.
 * Lives in mysociety_operations.staff
 */
const staffSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // If the staff member has a platform login
        },
        name: {
            type: String,
            required: [true, "Staff name is required"],
            trim: true,
        },
        role: {
            type: String,
            enum: Object.values(STAFF_TYPE),
            required: [true, "Staff role is required"],
        },
        phone: {
            type: String,
            trim: true,
        },
        address: {
            type: String,
            trim: true,
        },
        shift: {
            type: String,
            trim: true, // e.g. "Morning", "Evening", "Night"
        },
        gateOrArea: {
            type: String,
            trim: true,
        },
        joiningDate: {
            type: Date,
        },
        salary: {
            type: Number,
            min: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: ["active", "invited", "deactivated"],
            default: "active",
        },
        documents: [String], // ID proof, contract etc.
    },
    { timestamps: true }
);

staffSchema.index({ societyId: 1, role: 1 });
staffSchema.index({ societyId: 1 });

module.exports = staffSchema;
