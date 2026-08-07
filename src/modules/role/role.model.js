"use strict";

const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
        },
        description: {
            type: String,
        },
        permissions: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "Permission",
        }]
    },
    { timestamps: true }
);

module.exports = roleSchema;
