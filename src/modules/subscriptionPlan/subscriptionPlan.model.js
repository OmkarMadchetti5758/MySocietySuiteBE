"use strict";

const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
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
            required: true,
        },
        durationInMonths: {
            type: Number,
            required: true,
            default: 12,
        },
        maxFlats: {
            type: Number,
            required: true,
            default: 1000,
        },
        maxUsers: {
            type: Number,
            required: true,
            default: 5000,
        },
        modules: [{
            type: String,
            trim: true,
        }],
        features: [{
            type: String
        }],
        isActive: {
            type: Boolean,
            default: true,
        }
    },
    { timestamps: true }
);

module.exports = subscriptionPlanSchema;
