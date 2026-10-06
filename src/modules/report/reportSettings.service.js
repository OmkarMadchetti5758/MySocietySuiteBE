"use strict";
const { getReportModels } = require("./report.model");

class ReportSettingsService {

    static async getSettings(societyId, db) {
        const { ReportSettings } = getReportModels(db);
        let settings = await ReportSettings.findOne({ societyId }).lean();
        if (!settings) {
            // First access: insert defaults (upsert to avoid race)
            settings = await ReportSettings.findOneAndUpdate(
                { societyId },
                { $setOnInsert: { societyId } },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            ).lean();
        }
        return settings;
    }

    static async updateSettings(societyId, userId, updates, db) {
        const { ReportSettings } = getReportModels(db);
        const allowed = ["accountingBasis", "ageingBasis", "gstSplit", "tallyVersion", "fyStartMonth", "timezone"];
        const patch = {};
        for (const key of allowed) {
            if (updates[key] !== undefined) patch[key] = updates[key];
        }
        patch.updatedBy = userId;
        return ReportSettings.findOneAndUpdate(
            { societyId },
            { $set: patch },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();
    }
}

module.exports = { ReportSettingsService };
