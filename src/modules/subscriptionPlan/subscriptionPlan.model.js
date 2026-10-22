"use strict";

const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Plan name is required"],
            unique: true,
            trim: true,
        },
        slug: {
            type: String,
            required: [true, "Plan slug is required"],
            unique: true,
            trim: true,
            lowercase: true,
        },
        badge: {
            type: String,
            default: "",
            trim: true,
        },
        badgeType: {
            type: String,
            enum: ["green", "purple", "amber", "blue"],
            default: "blue",
        },
        description: {
            type: String,
            default: "",
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        tagline: {
            type: String,
            default: "",
        },
        price: {
            type: Number,
            required: [true, "Plan price is required"],
            default: 0,
        },
        durationInMonths: {
            type: Number,
            required: true,
            default: 12,
        },
        maxFlats: {
            type: Number,
            default: 0,
        },
        maxUsers: {
            type: Number,
            default: 0,
        },
        modules: [{
            type: String,
            trim: true,
        }],
        features: [{
            type: String,
        }],
        modules: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "Module",
        }],
        inheritsFrom: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "SubscriptionPlan",
            default: null,
        },
        sortOrder: {
            type: Number,
            default: 0,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

module.exports = subscriptionPlanSchema;
