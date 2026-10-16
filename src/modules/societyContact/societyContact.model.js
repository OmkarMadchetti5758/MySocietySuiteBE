"use strict";

const mongoose = require("mongoose");

/**
 * SocietyContact - essential, emergency, and service contacts for a society.
 * Lives in mysociety_operations.societycontacts
 */
const societyContactSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        contactType: {
            type: String,
            trim: true,
        },
        category: {
            type: String,
            enum: ["Essential", "Emergency", "Service Providers", "Other"],
            required: [true, "Category is required"],
        },
        nameCompany: {
            type: String,
            trim: true,
        },
        contactPerson: {
            type: String,
            trim: true,
        },
        mobileNumber: {
            type: String,
            trim: true,
        },
        emailId: {
            type: String,
            trim: true,
            lowercase: true,
        },
        roleDesignation: {
            type: String,
            trim: true,
        },
        iconType: {
            type: String,
            trim: true,
        },
        status: {
            type: String,
            enum: ["Active", "Inactive"],
            default: "Active",
        },
    },
    { timestamps: true }
);

societyContactSchema.index({ societyId: 1, category: 1 });

module.exports = societyContactSchema;
