"use strict";

const mongoose = require("mongoose");

const moduleSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: [true, "Module key is required"],
            unique: true,
            trim: true,
            lowercase: true,
        },
        name: {
            type: String,
            required: [true, "Module name is required"],
            trim: true,
        },
        description: {
            type: String,
            default: "",
            trim: true,
        },
        icon: {
            type: String,
            default: "",
            trim: true,
        },
        category: {
            type: String,
            default: "Core",
            trim: true,
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

module.exports = moduleSchema;
