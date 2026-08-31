"use strict";

/**
 * SLA Escalation Scheduler
 *
 * Runs periodically to find complaints that have breached their SLA window
 * and haven't been escalated yet. Safe to run multiple times — idempotent.
 *
 * Scheduling:
 *  - Runs every hour by default (configurable via SLA_CRON_INTERVAL_MS env var).
 *  - Call startSlaScheduler() once at server startup after DB connection is established.
 *  - Call stopSlaScheduler() for graceful shutdown.
 *
 * Design decisions:
 *  - Uses setInterval rather than a cron library to avoid extra dependencies.
 *    Swap to node-cron if more complex scheduling is needed.
 *  - History failures are caught and logged but do NOT fail the escalation.
 *  - Application restarts are safe: the idempotent updateMany only touches un-escalated tickets.
 */

const ComplaintService = require("../modules/complaint/complaint.service");

let intervalHandle = null;

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const runEscalation = async () => {
    try {
        const { escalatedCount } = await ComplaintService.runSlaEscalation();
        if (escalatedCount > 0) {
            console.log(`[SLA Scheduler] ✅ Escalated ${escalatedCount} complaint(s).`);
        }
    } catch (err) {
        // Log but don't crash the process — scheduler will retry on next tick
        console.error("[SLA Scheduler] ❌ Error during escalation run:", err.message);
    }
};

/**
 * Start the SLA escalation scheduler.
 * Safe to call multiple times — will not start a second interval.
 */
const startSlaScheduler = () => {
    if (intervalHandle) return; // Already running

    const intervalMs = parseInt(process.env.SLA_CRON_INTERVAL_MS, 10) || DEFAULT_INTERVAL_MS;

    // Run once immediately on startup to catch any pending escalations
    runEscalation();

    intervalHandle = setInterval(runEscalation, intervalMs);

    console.log(`[SLA Scheduler] 🕐 Started. Escalation check every ${intervalMs / 1000 / 60} minute(s).`);
};

/**
 * Stop the scheduler (for graceful shutdown / tests).
 */
const stopSlaScheduler = () => {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log("[SLA Scheduler] 🛑 Stopped.");
    }
};

module.exports = { startSlaScheduler, stopSlaScheduler };
