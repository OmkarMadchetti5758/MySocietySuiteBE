"use strict";

const mongoose = require("mongoose");

const permissionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true, // e.g., "create_user"
        },
        resource: {
            type: String,
            required: true,
            trim: true, // e.g., "User"
        },
        action: {
            type: String,
            required: true,
            enum: ["create", "read", "update", "delete", "manage"],
        },
        description: {
            type: String,
        }
    },
    { timestamps: true }
);

module.exports = permissionSchema;
