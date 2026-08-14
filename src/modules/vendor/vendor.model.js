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
        serviceType: {
            type: String,
            required: [true, "Service type is required"],
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
        rating: {
            type: Number,
            min: 0,
            max: 5,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        documents: [String], // URLs/paths to agreement docs
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User", // If the vendor has a platform login
        },
    },
    { timestamps: true }
);

vendorSchema.index({ societyId: 1 });
vendorSchema.index({ societyId: 1, serviceType: 1 });

module.exports = vendorSchema;
