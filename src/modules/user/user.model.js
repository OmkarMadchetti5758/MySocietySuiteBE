"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES, USER_STATUS } = require("../../common/constants");

/**
 * Operational Users schema.
 *
 * Lives in mysociety_operations.users
 * Each document represents one user's membership in ONE society.
 * A person belonging to two societies has two user documents (one per society).
 *
 * societyId is the leading field in all compound indexes to ensure
 * MongoDB uses the most selective prefix for every query.
 */
const userSchema = new mongoose.Schema(
    {
        societyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Society",
            required: [true, "societyId is required"],
            index: true,
        },
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
            sparse: true,
            match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
            required: [
                function () { return !this.mobile; },
                "Either email or mobile number is required"
            ],
        },
        mobile: {
            type: String,
            trim: true,
            required: [
                function () { return !this.email; },
                "Either email or mobile number is required"
            ],
            // Uniqueness is enforced via compound index {societyId, mobile}
        },
        password: {
            type: String,
            required: [
                function () { return this.status !== USER_STATUS.INVITED; },
                "Password is required"
            ],
            minlength: [6, "Password must be at least 6 characters"],
            select: false,
        },
        role: {
            type: String,
            enum: Object.values(ROLES),
            default: ROLES.RESIDENT_OWNER,
        },
        status: {
            type: String,
            enum: Object.values(USER_STATUS),
            default: USER_STATUS.ACTIVE,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        refreshToken: {
            type: String,
            select: false,
        },
        lastLogin: {
            type: Date,
        },
    },
    { timestamps: true }
);

// ── Compound Indexes (societyId always leading field) ─────────────────────────
// Unique per society: one mobile per society
userSchema.index({ societyId: 1, mobile: 1 }, { unique: true });
// Fast lookup by email within a society
userSchema.index({ societyId: 1, email: 1 });

// ── Hooks ─────────────────────────────────────────────────────────────────────
userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    delete obj.refreshToken;
    return obj;
};

module.exports = userSchema;
