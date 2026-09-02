"use strict";

const mongoose = require("mongoose");

/**
 * Vendor — external service provider registered with a society.
 * Lives in mysociety_operations.vendors
 */
const vendorSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
        },
        name: {
            type: String,
            required: [true, "Vendor name is required"],
            trim: true,
        },
        serviceCategory: {
            type: String,
            required: [true, "Service category is required"],
            trim: true, // e.g. "Plumbing", "Electrical", "Cleaning"
        },
        contactPerson: {
            type: String,
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
        },
        address: {
            type: String,
            trim: true,
        },
        gstin: {
            type: String,
            trim: true,
            uppercase: true,
        },
        status: {
            type: String,
            enum: ["INVITED", "ACTIVE", "INACTIVE"],
            default: "INVITED",
        },
        contractStartDate: {
            type: Date,
        },
        contractEndDate: {
            type: Date,
        },
        documents: [String], // URLs/paths to agreement docs
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // If the vendor has a platform login
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

vendorSchema.index({ societyId: 1, status: 1 });
vendorSchema.index({ societyId: 1, serviceCategory: 1 });
vendorSchema.index({ societyId: 1, contractEndDate: 1 });

module.exports = vendorSchema;
