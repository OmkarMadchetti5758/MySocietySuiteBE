const mongoose = require("mongoose");
const { STAFF_DESIGNATIONS } = require("../common/constants");

const staffSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        designation: {
            type: String,
            enum: Object.values(STAFF_DESIGNATIONS),
            required: true,
        },
        shiftTiming: {
            type: String,
            required: true,
        },
        gateOrArea: {
            type: String,
        },
        address: {
            type: String,
        },
        status: {
            type: String,
            enum: ["Active", "Pending setup", "Inactive"],
            default: "Pending setup",
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Staff", staffSchema);
