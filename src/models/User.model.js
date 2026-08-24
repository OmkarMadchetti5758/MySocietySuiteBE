const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { ROLES } = require("../common/constants");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },
        email: {
            type: String,
            required: false,
            unique: true,
            sparse: true,  // allows multiple docs with no email (null/undefined)
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
        },
        mobile: {
            type: String,
            trim: true,
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: [6, "Password must be at least 6 characters"],
            select: false, // exclude password from queries by default
        },
        role: {
            type: String,
            enum: Object.values(ROLES),
            default: ROLES.RESIDENT,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        refreshToken: {
            type: String,
            select: false,
        },
    },
    {
        timestamps: true,
    }
);

// Hash password before saving
userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive fields from JSON output
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    delete obj.refreshToken;
    return obj;
};

const User = mongoose.model("User", userSchema);

module.exports = User;
