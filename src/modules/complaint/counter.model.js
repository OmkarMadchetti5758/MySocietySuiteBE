"use strict";

const mongoose = require("mongoose");

/**
 * Counter — atomic sequence counter for human-readable unique ID generation.
 * Lives in mysociety_operations.counters
 *
 * Uses MongoDB's atomic findOneAndUpdate($inc) to guarantee uniqueness
 * even under concurrent complaint creation.
 *
 * Documents:
 *   { _id: "ticket_id", seq: 1042 }
 *
 * Usage:
 *   const counter = await Counter.findOneAndUpdate(
 *       { _id: "ticket_id" },
 *       { $inc: { seq: 1 } },
 *       { upsert: true, new: true }
 *   );
 *   const ticketId = `TKT-${String(counter.seq).padStart(7, "0")}`;
 */
const counterSchema = new mongoose.Schema(
    {
        _id: {
            type: String, // e.g. "ticket_id"
            required: true,
        },
        seq: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: false }
);

module.exports = counterSchema;
