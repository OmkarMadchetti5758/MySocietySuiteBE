"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const superAdminSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
            select: false,
        },
        role: {
            type: String,
            default: "super_admin",
            immutable: true,
        },
        refreshToken: {
            type: String,
            select: false,
        },
        lastLogin: {
            type: Date,
        },
        isActive: {
            type: Boolean,
            default: true,
        }
    },
    { timestamps: true }
);

// Hash password before saving
superAdminSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
superAdminSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = superAdminSchema;
