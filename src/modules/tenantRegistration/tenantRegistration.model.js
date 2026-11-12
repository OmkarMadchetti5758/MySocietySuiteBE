"use strict";

const mongoose = require("mongoose");

const documentSubSchema = new mongoose.Schema(
    {
        documentType: {
            type: String,
            required: [true, "documentType is required"],
        },
        label: {
            type: String,
            required: [true, "label is required"],
        },
        isRequired: {
            type: Boolean,
            default: false,
        },
        fileUrl: {
            type: String,
            required: [true, "fileUrl is required"],
        },
        fileKey: {
            type: String,
        },
        fileName: {
            type: String,
        },
        fileSize: {
            type: Number,
        },
        mimeType: {
            type: String,
        },
        uploadedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: true }
);

const tenantRegistrationSchema = new mongoose.Schema(
    {
        // ── Core refs ──────────────────────────────────────────────────────────
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
        ownerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "ownerId is required"],
        },
        tenantUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "tenantUserId is required"],
        },

        // ── Personal info ─────────────────────────────────────────────────────
        fullName: {
            type: String,
            required: [true, "fullName is required"],
            trim: true,
        },
        mobileNumber: {
            type: String,
            required: [true, "mobileNumber is required"],
            trim: true,
        },
        email: {
            type: String,
            required: [true, "email is required"],
            trim: true,
            lowercase: true,
        },
        dateOfBirth: {
            type: Date,
        },
        gender: {
            type: String,
            enum: ["Male", "Female", "Other"],
        },
        completeAddress: {
            type: String,
            trim: true,
        },
        emergencyContactNumber: {
            type: String,
            trim: true,
        },
        numberOfOccupants: {
            type: Number,
        },

        // ── Professional info (all optional) ──────────────────────────────────
        employmentType: {
            type: String,
            enum: ["Salaried", "Self Employed"],
        },
        companyName: {
            type: String,
            trim: true,
        },
        companyDescription: {
            type: String,
            trim: true,
        },
        organizationName: {
            type: String,
            trim: true,
        },
        organizationAddress: {
            type: String,
            trim: true,
        },
        yearOfIncorporation: {
            type: String,
            trim: true,
        },

        // ── Tenancy details ───────────────────────────────────────────────────
        moveInDate: {
            type: Date,
            required: [true, "moveInDate is required"],
        },
        moveOutDate: {
            type: Date,
        },
        monthlyRent: {
            type: Number,
        },
        securityDeposit: {
            type: Number,
        },
        rentDueDay: {
            type: Number,
            min: 1,
            max: 28,
        },
        petAllowed: {
            type: Boolean,
            default: false,
        },
        status: {
            type: String,
            enum: ["Active", "Inactive", "Vacated"],
            required: [true, "status is required"],
            default: "Active",
        },

        // ── Reference info (all optional) ─────────────────────────────────────
        referenceName: {
            type: String,
            trim: true,
        },
        referenceContactNumber: {
            type: String,
            trim: true,
        },
        referenceRelation: {
            type: String,
            enum: ["Friend", "Relative", "Colleague", "Neighbour", "Other"],
        },

        // ── Documents ─────────────────────────────────────────────────────────
        documents: [documentSubSchema],

        // ── Invite / lifecycle ────────────────────────────────────────────────
        inviteToken: {
            type: String,
        },
        inviteSentAt: {
            type: Date,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
tenantRegistrationSchema.index({ societyId: 1, flatId: 1 });
tenantRegistrationSchema.index({ societyId: 1, ownerId: 1 });
tenantRegistrationSchema.index({ societyId: 1, tenantUserId: 1 });
tenantRegistrationSchema.index({ societyId: 1, status: 1 });

module.exports = tenantRegistrationSchema;
