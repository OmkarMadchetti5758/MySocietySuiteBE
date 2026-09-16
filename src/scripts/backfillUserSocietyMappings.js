"use strict";

/**
 * Backfill UserSocietyMapping so every user can log in with email AND mobile.
 *
 * Usage (from BE folder):
 *   node src/scripts/backfillUserSocietyMappings.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const mongoose = require("mongoose");
const { connectMasterDB } = require("../config/masterDb");
const { connectOperationsDB, getOperationsConnection } = require("../config/operationsDb");
const MappingRepository = require("../modules/userSocietyMapping/userSocietyMapping.repository");

async function backfill() {
    await connectMasterDB();
    await connectOperationsDB();

    const User = getOperationsConnection().model("User");
    const users = await User.find({}).select("_id societyId email mobile role").lean();

    let repaired = 0;
    let skipped = 0;

    for (const user of users) {
        const identifiers = MappingRepository.collectIdentifiers(user.email, user.mobile);
        if (identifiers.length === 0 || !user.societyId) {
            skipped += 1;
            continue;
        }

        const before = (await MappingRepository._getModel().find({
            societyId: user.societyId,
            userId: user._id,
        }).lean()).length;

        await MappingRepository.ensureIdentifierMappings(user.societyId, user);

        const after = (await MappingRepository._getModel().find({
            societyId: user.societyId,
            userId: user._id,
        }).lean()).length;

        if (after > before) repaired += 1;
    }

    console.log(`Backfill complete. Users scanned: ${users.length}, mappings added for: ${repaired}, skipped: ${skipped}`);
}

backfill()
    .catch((err) => {
        console.error("Backfill failed:", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
