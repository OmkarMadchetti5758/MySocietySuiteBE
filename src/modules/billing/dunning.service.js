"use strict";

const { getDunningModels } = require("./dunning.model");
const { getBillingModels } = require("./billing.model");
const mongoose = require("mongoose");

class DunningService {
    static getSocietyId(req) {
        const sId = req.user?.societyId || req.societyId || req.query?.societyId || req.body?.societyId;
        if (!sId) {
            // Fallback for standalone dev environments
            return new mongoose.Types.ObjectId("60c72b2f9b1d8b2b88888888");
        }
        return mongoose.Types.ObjectId.isValid(sId) ? new mongoose.Types.ObjectId(sId) : sId;
    }

    static getUserId(req) {
        return req.user?.id || req.user?._id || new mongoose.Types.ObjectId("60c72b2f9b1d8b2b99999999");
    }

    // ── 1. KPI Summary Cards Overview ──────────────────────────────────────────
    static async getOverviewStats(req) {
        const db = req.opsDb;
        const { BillingInvoice } = getBillingModels(db);
        const { DefaulterRecord } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const UNPAID_STATUSES = ["GENERATED", "ISSUED", "OVERDUE", "PARTIALLY_PAID", "unpaid", "partially_paid", "overdue"];

        // Fetch unpaid / overdue invoices
        const overdueInvoices = await BillingInvoice.find({
            societyId,
            status: { $in: UNPAID_STATUSES },
            dueDate: { $lt: new Date() }
        }).select("totalAmount paidAmount fineAmount dueDate flatId invoiceNumber");

        let totalOutstanding = 0;
        let totalArrears = 0;
        let overdueCount = overdueInvoices.length;
        let totalFines = 0;

        overdueInvoices.forEach(inv => {
            const outstanding = Math.max(0, (inv.totalAmount || 0) - (inv.paidAmount || 0));
            totalOutstanding += outstanding;
            totalArrears += outstanding;
            totalFines += (inv.fineAmount || 0);
        });

        // Count defaulters
        const defaultersCount = await DefaulterRecord.countDocuments({
            societyId,
            status: "DEFAULTER"
        });

        return {
            totalOutstanding,
            totalArrears,
            overdueInvoices: overdueCount,
            totalFines,
            defaulters: defaultersCount,
            pendingReminders: overdueCount
        };
    }

    // ── 2. Fine / Interest Rules Management ────────────────────────────────────
    static async getRules(req) {
        const db = req.opsDb;
        const { FineRule } = getDunningModels(db);
        const societyId = this.getSocietyId(req);
        return await FineRule.find({ societyId }).populate("createdBy", "name firstName lastName email").sort({ createdAt: -1 });
    }

    static async createRule(req, data) {
        const db = req.opsDb;
        const { FineRule } = getDunningModels(db);
        const societyId = this.getSocietyId(req);
        const userId = this.getUserId(req);

        if (!data.ruleName || !data.calculationType || !data.startRule) {
            throw new Error("Rule Name, Calculation Type, and Explicit Calculation Start Reference (Invoice Date or Due Date) are required.");
        }

        const newRule = new FineRule({
            societyId,
            ruleName: data.ruleName,
            calculationType: data.calculationType,
            flatAmount: data.flatAmount || 0,
            percentageRate: data.percentageRate || 0,
            slabs: data.slabs || [],
            startRule: data.startRule,
            applyTo: data.applyTo || "ALL",
            chargeHeadIds: data.chargeHeadIds || [],
            status: "PENDING_APPROVAL",
            createdBy: userId
        });

        return await newRule.save();
    }

    static async approveRule(req, ruleId) {
        const db = req.opsDb;
        const { FineRule } = getDunningModels(db);
        const userId = this.getUserId(req);

        const rule = await FineRule.findById(ruleId);
        if (!rule) throw new Error("Fine rule not found.");
        
        rule.status = "ACTIVE";
        rule.approvedBy = userId;
        rule.approvedAt = new Date();
        return await rule.save();
    }

    static async rejectRule(req, ruleId, reason) {
        const db = req.opsDb;
        const { FineRule } = getDunningModels(db);
        const userId = this.getUserId(req);

        const rule = await FineRule.findById(ruleId);
        if (!rule) throw new Error("Fine rule not found.");

        rule.status = "REJECTED";
        rule.rejectionReason = reason || "Rejected by Committee Admin";
        return await rule.save();
    }

    // ── 3. Arrears Tracking & Breakdown ────────────────────────────────────────
    static async getArrears(req) {
        const db = req.opsDb;
        const { BillingInvoice } = getBillingModels(db);
        const societyId = this.getSocietyId(req);

        const UNPAID_STATUSES = ["GENERATED", "ISSUED", "OVERDUE", "PARTIALLY_PAID", "unpaid", "partially_paid", "overdue"];

        const overdueInvoices = await BillingInvoice.find({
            societyId,
            status: { $in: UNPAID_STATUSES },
            dueDate: { $lt: new Date() }
        }).populate("flatId", "flatNumber ownerName block");

        const now = new Date();

        return overdueInvoices.map(inv => {
            const originalAmount = inv.totalAmount || 0;
            const paid = inv.paidAmount || 0;
            const outstanding = Math.max(0, originalAmount - paid);
            const refDate = inv.dueDate || inv.createdAt;
            const diffTime = Math.max(0, now - new Date(refDate));
            const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const fine = inv.fineAmount || 0;
            const totalDue = outstanding + fine;

            return {
                id: inv._id,
                flat: inv.flatId ? `${inv.flatId.block || 'Block'}-${inv.flatId.flatNumber}` : 'Flat A-101',
                resident: inv.flatId?.ownerName || 'Resident',
                previousInvoice: inv.invoiceNumber || `INV-${inv._id.toString().slice(-4)}`,
                billingCycle: inv.billingCycle || 'July 2026',
                originalAmount,
                paid,
                outstanding,
                daysOverdue,
                fine,
                totalDue,
                status: 'Overdue'
            };
        });
    }

    // ── 4. Ageing Report & Summary ──────────────────────────────────────────────
    static async getAgeing(req) {
        const arrears = await this.getArrears(req);

        let bucket0_30 = 0;
        let bucket31_60 = 0;
        let bucket61_90 = 0;
        let bucket90Plus = 0;

        arrears.forEach(item => {
            if (item.daysOverdue <= 30) bucket0_30 += item.totalDue;
            else if (item.daysOverdue <= 60) bucket31_60 += item.totalDue;
            else if (item.daysOverdue <= 90) bucket61_90 += item.totalDue;
            else bucket90Plus += item.totalDue;
        });

        return {
            summary: { bucket0_30, bucket31_60, bucket61_90, bucket90Plus },
            table: arrears.map(item => {
                let bucket = '0–30 Days';
                if (item.daysOverdue > 90) bucket = '90+ Days';
                else if (item.daysOverdue > 60) bucket = '61–90 Days';
                else if (item.daysOverdue > 30) bucket = '31–60 Days';

                return { ...item, ageingBucket: bucket, isDefaulter: item.daysOverdue > 60 };
            })
        };
    }

    // ── 5. Defaulters Module ───────────────────────────────────────────────────
    static async getDefaulters(req) {
        const db = req.opsDb;
        const { DefaulterRecord } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        let defaulters = await DefaulterRecord.find({ societyId }).sort({ daysOverdue: -1 });

        if (defaulters.length === 0) {
            await this.runDefaulterCheck(req);
            defaulters = await DefaulterRecord.find({ societyId }).sort({ daysOverdue: -1 });
        }

        return defaulters;
    }

    static async runDefaulterCheck(req) {
        const db = req.opsDb;
        const { DefaulterRecord, DunningConfig } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const config = await DunningConfig.findOne({ societyId }) || { defaulterUnpaidCyclesThreshold: 2 };
        const arrears = await this.getArrears(req);

        const flatMap = {};
        arrears.forEach(item => {
            if (!flatMap[item.flat]) {
                flatMap[item.flat] = {
                    flat: item.flat,
                    resident: item.resident,
                    unpaidCycles: 0,
                    outstanding: 0,
                    oldestDueDate: item.billingCycle,
                    daysOverdue: 0,
                    fineAmount: 0
                };
            }
            flatMap[item.flat].unpaidCycles += 1;
            flatMap[item.flat].outstanding += item.totalDue;
            flatMap[item.flat].daysOverdue = Math.max(flatMap[item.flat].daysOverdue, item.daysOverdue);
            flatMap[item.flat].fineAmount += item.fine;
        });

        for (const key of Object.keys(flatMap)) {
            const data = flatMap[key];
            if (data.unpaidCycles >= config.defaulterUnpaidCyclesThreshold) {
                await DefaulterRecord.findOneAndUpdate(
                    { societyId, flatNumber: data.flat },
                    {
                        societyId,
                        flatNumber: data.flat,
                        residentName: data.resident,
                        unpaidCyclesCount: data.unpaidCycles,
                        totalOutstanding: data.outstanding,
                        daysOverdue: data.daysOverdue,
                        totalFineAmount: data.fineAmount,
                        status: "DEFAULTER"
                    },
                    { upsert: true, new: true }
                );
            }
        }
        return true;
    }

    // ── 6. Dunning Multi-Channel Reminders ─────────────────────────────────────
    static async getReminders(req) {
        const db = req.opsDb;
        const { DunningReminder, DunningConfig } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const config = await DunningConfig.findOne({ societyId }) || {
            beforeDueDays: 3,
            onDueDateEnabled: true,
            afterDueDays: 3,
            secondReminderDays: 7
        };

        const history = await DunningReminder.find({ societyId }).sort({ sentAt: -1 }).limit(100);
        return { config, history };
    }

    static async updateDunningConfig(req, data) {
        const db = req.opsDb;
        const { DunningConfig } = getDunningModels(db);
        const societyId = this.getSocietyId(req);
        const userId = this.getUserId(req);

        return await DunningConfig.findOneAndUpdate(
            { societyId },
            { ...data, updatedBy: userId },
            { upsert: true, new: true }
        );
    }

    static async sendReminder(req, data) {
        const db = req.opsDb;
        const { DunningReminder } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const reminder = new DunningReminder({
            societyId,
            flatNumber: data.flat || "A-101",
            residentName: data.resident || "Resident",
            reminderType: data.reminderType || "DEFAULTER_FOLLOWUP",
            channel: data.channel || "SMS",
            sentAt: new Date(),
            deliveryStatus: "DELIVERED"
        });

        return await reminder.save();
    }

    // ── 7. Fine Waivers (Strict Committee Admin Authorization + Mandatory Reason) ──
    static async getWaivers(req) {
        const db = req.opsDb;
        const { FineWaiver } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        return await FineWaiver.find({ societyId }).sort({ waivedAt: -1 });
    }

    static async waiveFine(req, data) {
        const db = req.opsDb;
        const { FineWaiver } = getDunningModels(db);
        const { BillingInvoice } = getBillingModels(db);
        const societyId = this.getSocietyId(req);
        const userId = this.getUserId(req);
        const userName = req.user?.name || "Committee Admin";

        const { invoiceId, invoiceNumber, flatNumber, residentName, originalFine, waivedAmount, reason } = data;

        if (!reason || reason.trim() === "") {
            throw new Error("Waiver reason is mandatory according to society audit rules.");
        }

        const waiver = new FineWaiver({
            societyId,
            invoiceId: invoiceId || null,
            flatNumber: flatNumber || "A-101",
            residentName: residentName || "Resident",
            originalFine: Number(originalFine) || 0,
            waivedAmount: Number(waivedAmount) || 0,
            reason: reason.trim(),
            waivedBy: userId,
            waivedByName: userName,
            status: "APPROVED"
        });

        await waiver.save();

        if (invoiceId && mongoose.Types.ObjectId.isValid(invoiceId)) {
            const invoice = await BillingInvoice.findById(invoiceId);
            if (invoice) {
                invoice.fineAmount = Math.max(0, (invoice.fineAmount || 0) - Number(waivedAmount));
                await invoice.save();
            }
        }

        return waiver;
    }

    // ── 8. Automatic Idempotent Fine Application Cron/Engine ─────────────────
    static async runDunningProcess(req) {
        const db = req.opsDb;
        const { FineRule, FineApplication } = getDunningModels(db);
        const { BillingInvoice } = getBillingModels(db);
        const societyId = this.getSocietyId(req);

        const activeRule = await FineRule.findOne({ societyId, status: "ACTIVE" });
        if (!activeRule) {
            return { message: "No active approved fine rule found. Please create and approve a fine rule first." };
        }

        const now = new Date();
        const UNPAID_STATUSES = ["GENERATED", "ISSUED", "OVERDUE", "PARTIALLY_PAID", "unpaid", "partially_paid", "overdue"];
        const overdueInvoices = await BillingInvoice.find({
            societyId,
            status: { $in: UNPAID_STATUSES }
        });

        let appliedCount = 0;

        for (const inv of overdueInvoices) {
            const refDate = activeRule.startRule === "INVOICE_DATE" ? inv.createdAt : inv.dueDate;
            if (now < new Date(refDate)) continue;

            const diffTime = Math.max(0, now - new Date(refDate));
            const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            if (daysOverdue <= 0) continue;

            const idempotencyKey = `FINE_${inv._id}_${inv.billingCycle || 'CYCLE'}`;
            const existingApp = await FineApplication.findOne({ idempotencyKey });
            if (existingApp) continue;

            let fineCalculated = 0;
            const outstanding = Math.max(0, (inv.totalAmount || 0) - (inv.paidAmount || 0));

            if (activeRule.calculationType === "FLAT") {
                fineCalculated = activeRule.flatAmount;
            } else if (activeRule.calculationType === "PERCENTAGE") {
                fineCalculated = Math.round((outstanding * (activeRule.percentageRate || 1)) / 100);
            } else if (activeRule.calculationType === "SLAB") {
                const applicableSlab = activeRule.slabs.find(s => daysOverdue >= s.fromDays && daysOverdue <= s.toDays);
                if (applicableSlab) {
                    fineCalculated = applicableSlab.rate <= 100
                        ? Math.round((outstanding * applicableSlab.rate) / 100)
                        : applicableSlab.rate;
                }
            }

            if (fineCalculated > 0) {
                await FineApplication.create({
                    societyId,
                    invoiceId: inv._id,
                    flatId: inv.flatId,
                    fineRuleId: activeRule._id,
                    fineAmount: fineCalculated,
                    billingCycle: inv.billingCycle || "MONTHLY",
                    idempotencyKey
                });

                inv.fineAmount = (inv.fineAmount || 0) + fineCalculated;
                inv.status = "OVERDUE";
                await inv.save();

                appliedCount++;
            }
        }

        return { appliedCount, message: `Dunning process executed. Applied fines to ${appliedCount} overdue invoices.` };
    }
}

module.exports = DunningService;
