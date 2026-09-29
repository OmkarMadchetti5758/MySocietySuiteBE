"use strict";

/**
 * Daily dunning: apply overdue fines for every society with an ACTIVE fine rule.
 * Idempotent via FineApplication.idempotencyKey.
 */

const { getOperationsConnection } = require("../config/operationsDb");
const DunningService = require("../modules/billing/dunning.service");
const { getDunningModels } = require("../modules/billing/dunning.model");

let intervalHandle = null;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const runDunningForAllSocieties = async () => {
    try {
        const db = getOperationsConnection();
        const { FineRule } = getDunningModels(db);
        const societyIds = await FineRule.distinct("societyId", { status: "ACTIVE" });
        if (!societyIds.length) return;

        for (const societyId of societyIds) {
            try {
                const result = await DunningService.runDunningProcess({
                    opsDb: db,
                    user: { societyId, id: societyId },
                    societyId,
                });
                if (result?.appliedCount > 0) {
                    console.log(`[Dunning Scheduler] Society ${societyId}: applied fines to ${result.appliedCount} invoice(s).`);
                }
            } catch (err) {
                console.error(`[Dunning Scheduler] Society ${societyId}:`, err.message);
            }
        }
    } catch (err) {
        console.error("[Dunning Scheduler] ❌", err.message);
    }
};

const startDunningScheduler = () => {
    if (intervalHandle) return;
    const intervalMs = parseInt(process.env.DUNNING_CRON_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;
    runDunningForAllSocieties();
    intervalHandle = setInterval(runDunningForAllSocieties, intervalMs);
    console.log(`[Dunning Scheduler] 🕐 Started. Fine check every ${Math.round(intervalMs / 1000 / 60)} minute(s).`);
};

const stopDunningScheduler = () => {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log("[Dunning Scheduler] 🛑 Stopped.");
    }
};

module.exports = { startDunningScheduler, stopDunningScheduler, runDunningForAllSocieties };
