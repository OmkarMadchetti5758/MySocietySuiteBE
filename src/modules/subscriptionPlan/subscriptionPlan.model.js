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
        },
        maxUsers: {
            type: Number,
            required: true,
        },
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
