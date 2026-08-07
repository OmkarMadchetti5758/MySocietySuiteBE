"use strict";

const mongoose = require("mongoose");

const globalSettingSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            uppercase: true,
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        description: {
            type: String,
        }
    },
    { timestamps: true }
);

module.exports = globalSettingSchema;
