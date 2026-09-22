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

    // Helper: Map flat wing names from Block & Flat models
    static async _getFlatsWingsMap(db, societyId) {
        const map = {};
        try {
            const blockSchema = require("../block/block.model");
            const flatSchema = require("../flat/flat.model");
            const BlockModel = db.models.Block || db.model("Block", blockSchema);
            const FlatModel = db.models.Flat || db.model("Flat", flatSchema);

            const wingsMap = {};
            const blockDoc = await BlockModel.findOne({ societyId }).lean();
            if (blockDoc && Array.isArray(blockDoc.wings)) {
                for (const w of blockDoc.wings) {
                    wingsMap[String(w._id)] = w.name || w.code || "";
                }
            }

            const flats = await FlatModel.find({ societyId }).select("_id flatNumber blockId wing").lean();
            for (const f of flats) {
                let wingName = f.wing || (f.blockId ? wingsMap[String(f.blockId)] : "") || "";
                if (!wingName && f.flatNumber) {
                    const match = String(f.flatNumber).match(/^([A-Za-z]+)[-\s]?/);
                    if (match) wingName = `Wing ${match[1].toUpperCase()}`;
                }
                map[String(f._id)] = wingName;
            }
        } catch (_) { }
        return map;
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
        })
        .populate({
            path: "flatId",
            select: "flatNumber ownerName block wing wingName buildingName blockId",
            populate: { path: "blockId", select: "name wings" }
        })
        .sort({ dueDate: 1 });

        const now = new Date();
        const flatsWingsMap = await this._getFlatsWingsMap(db, societyId);

        return overdueInvoices.map(inv => {
            const originalAmount = inv.totalAmount || 0;
            const paid = inv.paidAmount || 0;
            const outstanding = Math.max(0, originalAmount - paid);
            const refDate = inv.dueDate || inv.createdAt;
            const diffTime = Math.max(0, now - new Date(refDate));
            const daysOverdue = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const fine = inv.fineAmount || 0;
            const totalDue = outstanding + fine;

            const flatIdStr = inv.flatId?._id ? String(inv.flatId._id) : (inv.flatId ? String(inv.flatId) : '');
            let wing = flatsWingsMap[flatIdStr] || inv.flatId?.wingName || inv.flatId?.wing || inv.blockName || inv.flatId?.blockId?.name || '';
            if (!wing && inv.flatId?.flatNumber) {
                const match = String(inv.flatId.flatNumber).match(/^([A-Za-z]+)[-\s]?/);
                if (match) wing = `Wing ${match[1].toUpperCase()}`;
            }
            if (!wing && inv.flatNumber) {
                const match = String(inv.flatNumber).match(/^([A-Za-z]+)[-\s]?/);
                if (match) wing = `Wing ${match[1].toUpperCase()}`;
            }
            if (!wing) wing = 'Wing A';

            return {
                id: inv._id,
                flat: inv.flatId?.flatNumber ? `${inv.flatId.flatNumber}` : (inv.flatNumber || '101'),
                wing,
                resident: inv.flatId?.ownerName || inv.residentName || 'Resident',
                previousInvoice: inv.invoiceNumber || `INV-${inv._id.toString().slice(-4)}`,
                billingCycle: inv.billingCycle || inv.billingPeriod || 'July 2026',
                dueDate: inv.dueDate || inv.createdAt,
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

        await this.runDefaulterCheck(req);
        return await DefaulterRecord.find({ societyId, status: "DEFAULTER" }).sort({ daysOverdue: -1 });
    }

    static async runDefaulterCheck(req) {
        const db = req.opsDb;
        const { DefaulterRecord, DunningConfig, DunningReminder } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const config = await DunningConfig.findOne({ societyId }) || { defaulterUnpaidCyclesThreshold: 2 };
        const arrears = await this.getArrears(req);

        const flatMap = {};
        arrears.forEach(item => {
            if (!flatMap[item.flat]) {
                flatMap[item.flat] = {
                    flat: item.flat,
                    wing: item.wing || 'Wing A',
                    resident: item.resident,
                    unpaidCycles: 0,
                    outstanding: 0,
                    oldestDueDate: item.dueDate ? new Date(item.dueDate) : new Date(),
                    daysOverdue: 0,
                    fineAmount: 0
                };
            } else {
                if (item.dueDate && new Date(item.dueDate) < new Date(flatMap[item.flat].oldestDueDate)) {
                    flatMap[item.flat].oldestDueDate = new Date(item.dueDate);
                }
            }
            flatMap[item.flat].unpaidCycles += 1;
            flatMap[item.flat].outstanding += (item.outstanding !== undefined ? item.outstanding : (item.totalDue - item.fine));
            flatMap[item.flat].daysOverdue = Math.max(flatMap[item.flat].daysOverdue, item.daysOverdue);
            flatMap[item.flat].fineAmount += item.fine;
        });

        for (const key of Object.keys(flatMap)) {
            const data = flatMap[key];
            if (data.unpaidCycles >= config.defaulterUnpaidCyclesThreshold) {
                const latestReminder = await DunningReminder.findOne({
                    societyId,
                    $or: [{ flatNumber: data.flat }, { flat: data.flat }]
                }).sort({ sentAt: -1 });

                await DefaulterRecord.findOneAndUpdate(
                    { societyId, flatNumber: data.flat },
                    {
                        societyId,
                        flatNumber: data.flat,
                        wingName: data.wing,
                        residentName: data.resident,
                        unpaidCyclesCount: data.unpaidCycles,
                        totalOutstanding: data.outstanding,
                        oldestDueDate: data.oldestDueDate,
                        daysOverdue: data.daysOverdue,
                        totalFineAmount: data.fineAmount,
                        lastReminderSentAt: latestReminder ? latestReminder.sentAt : null,
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

        const rawHistory = await DunningReminder.find({ societyId })
            .populate("invoiceId", "invoiceNumber")
            .sort({ sentAt: -1 })
            .limit(100);

        const history = rawHistory.map(rem => {
            const obj = rem.toObject ? rem.toObject() : rem;
            const invNum = obj.invoiceNumber || obj.invoice || obj.invoiceId?.invoiceNumber || 'N/A';
            return {
                ...obj,
                invoice: invNum,
                invoiceNumber: invNum
            };
        });

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
        const { DunningReminder, DefaulterRecord } = getDunningModels(db);
        const { BillingInvoice } = getBillingModels(db);
        const societyId = this.getSocietyId(req);

        const sentAt = new Date();
        const targetFlat = data.flat || data.flatNumber || "A-101";

        let invId = data.invoiceId || null;
        let invNum = data.invoice || data.invoiceNumber || "";
        let residentEmail = null;
        let residentName = data.resident || data.residentName || "Resident";

        // Find invoice or flat to resolve registered email
        try {
            const flatSchema = require("../flat/flat.model");
            const userSchema = require("../user/user.model");
            const FlatModel = db.models.Flat || db.model("Flat", flatSchema);
            const UserModel = db.models.User || db.model("User", userSchema);

            const flatDoc = await FlatModel.findOne({
                societyId,
                $or: [
                    { flatNumber: targetFlat },
                    { flatNumber: `Flat ${targetFlat}` },
                    { flatNumber: String(targetFlat).replace(/^(Block|Flat)[-\s]*/i, '') }
                ]
            }).populate("primaryOwner activeTenant");

            if (flatDoc) {
                const residentUser = flatDoc.activeTenant || flatDoc.primaryOwner;
                if (residentUser?.email) {
                    residentEmail = residentUser.email;
                    if (residentUser.name) residentName = residentUser.name;
                }
            }

            if (!residentEmail) {
                const userDoc = await UserModel.findOne({
                    societyId,
                    $or: [
                        { name: new RegExp(`^${residentName}$`, "i") },
                        { email: { $exists: true, $ne: null } }
                    ]
                });
                if (userDoc?.email) {
                    residentEmail = userDoc.email;
                }
            }
        } catch (err) {
            console.warn("[DunningService] Resident email lookup warning:", err.message);
        }

        let pendingAmount = Number(data.totalOutstanding || data.pendingAmount) || 0;
        let fineAmount = Number(data.fineAmount) || 0;

        if (targetFlat) {
            const cleanTarget = String(targetFlat).toLowerCase().replace(/^(block|flat)[-\s]*/i, '').trim();

            // 1. Try to fetch directly from DefaulterRecord for aggregate total outstanding & fine if not passed
            const defaulterRec = await DefaulterRecord.findOne({
                societyId,
                $or: [
                    { flatNumber: targetFlat },
                    { flatNumber: cleanTarget },
                    { flatNumber: `Flat ${cleanTarget}` },
                    { flatNumber: `101` }
                ]
            });

            if (defaulterRec) {
                if (!pendingAmount && defaulterRec.totalOutstanding > 0) pendingAmount = defaulterRec.totalOutstanding;
                if (!fineAmount && defaulterRec.totalFineAmount > 0) fineAmount = defaulterRec.totalFineAmount;
            }

            // 2. Fetch from arrearsList as secondary fallback or refine invoice details
            const arrearsList = await this.getArrears(req);
            const flatArrears = arrearsList.filter(item => {
                const cleanItem = String(item.flat).toLowerCase().replace(/^(block|flat)[-\s]*/i, '').trim();
                return cleanItem === cleanTarget || String(item.flat).toLowerCase() === String(targetFlat).toLowerCase();
            });

            if (flatArrears.length > 0) {
                if (!invNum) {
                    const oldest = flatArrears[0];
                    invId = oldest.id;
                    invNum = oldest.previousInvoice;
                }

                if (!pendingAmount || !fineAmount) {
                    let calcTotalOutstanding = 0;
                    let calcTotalFine = 0;
                    flatArrears.forEach(item => {
                        calcTotalOutstanding += (item.outstanding !== undefined ? item.outstanding : (item.totalDue - (item.fine || 0)));
                        calcTotalFine += (item.fine || 0);
                    });

                    if (!pendingAmount && calcTotalOutstanding > 0) pendingAmount = calcTotalOutstanding;
                    if (!fineAmount && calcTotalFine > 0) fineAmount = calcTotalFine;
                }
            }
        }

        // Send email via EmailService if registered email is found
        let deliveryStatus = "DELIVERED";
        let failureReason = null;

        if (residentEmail) {
            try {
                const emailService = require("../../services/email.service");
                const subject = `Overdue Maintenance Dues Reminder - Flat ${targetFlat}`;
                const formattedPending = pendingAmount > 0 ? `₹${pendingAmount.toLocaleString()}` : 'N/A';
                const formattedFine = fineAmount > 0 ? `₹${fineAmount.toLocaleString()}` : '₹0';

                const text = `Dear ${residentName},\n\nThis is a reminder regarding your pending maintenance dues for Flat ${targetFlat}.\nInvoice Ref: ${invNum || 'N/A'}\nTotal Pending Dues: ${formattedPending}\nLate Fee / Fine: ${formattedFine}\n\nPlease settle the outstanding balance at your earliest convenience.\n\nThank you,\nSociety Management`;
                const html = `
                    <div style="font-family:Arial,sans-serif;max-width:550px;margin:0 auto;color:#1a1a1a;border:1px solid #e5e7eb;padding:24px;border-radius:16px">
                      <h2 style="color:#ea580c;margin-top:0">Overdue Maintenance Dues Reminder</h2>
                      <p>Dear <strong>${residentName}</strong>,</p>
                      <p>This is an automated reminder regarding your overdue maintenance dues for <strong>Flat ${targetFlat}</strong>.</p>
                      <div style="background:#fff7ed;padding:18px;border-radius:12px;border:1px solid #ffedd5;margin:20px 0">
                        <p style="margin:6px 0;font-size:14px"><strong>Flat / Unit:</strong> ${targetFlat}</p>
                        <p style="margin:6px 0;font-size:14px"><strong>Invoice Reference:</strong> ${invNum || 'N/A'}</p>
                        <p style="margin:6px 0;font-size:16px;color:#dc2626"><strong>Total Pending Dues:</strong> ${formattedPending}</p>
                        ${fineAmount > 0 ? `<p style="margin:6px 0;font-size:14px;color:#9333ea"><strong>Applied Fine / Interest:</strong> ${formattedFine}</p>` : ''}
                      </div>
                      <p>Please clear your pending dues at your earliest convenience to avoid additional penalties.</p>
                      <p style="color:#6b7280;font-size:12px;margin-top:24px;border-top:1px solid #e5e7eb;pt-4">This notification was sent to your registered email address (${residentEmail}).</p>
                    </div>
                `;

                await emailService._send({ to: residentEmail, subject, text, html });
            } catch (err) {
                console.error("[DunningService] Failed sending reminder email:", err.message);
                failureReason = err.message;
            }
        }

        const reminder = new DunningReminder({
            societyId,
            invoiceId: invId,
            invoiceNumber: invNum,
            flatNumber: targetFlat,
            residentName: residentName,
            reminderType: data.reminderType || "DEFAULTER_FOLLOWUP",
            channel: "EMAIL",
            sentAt,
            deliveryStatus,
            failureReason
        });

        await reminder.save();

        await DefaulterRecord.findOneAndUpdate(
            { societyId, flatNumber: targetFlat },
            { lastReminderSentAt: sentAt }
        );

        return {
            ...reminder.toObject(),
            message: residentEmail 
                ? `Reminder email dispatched successfully to ${residentEmail}` 
                : `Reminder logged via EMAIL for Flat ${targetFlat}`
        };
    }

    // ── 7. Fine Waivers (Strict Committee Admin Authorization + Mandatory Reason) ──
    static async getWaivers(req) {
        const db = req.opsDb;
        const { FineWaiver } = getDunningModels(db);
        const societyId = this.getSocietyId(req);

        const rawWaivers = await FineWaiver.find({ societyId })
            .populate("invoiceId", "invoiceNumber")
            .populate("waivedBy", "name firstName lastName email")
            .sort({ waivedAt: -1 });

        return rawWaivers.map(wav => {
            const obj = wav.toObject ? wav.toObject() : wav;
            const invNum = obj.invoiceNumber || obj.invoice || obj.invoiceId?.invoiceNumber || 'N/A';
            
            let adminName = obj.waivedByName;
            if (obj.waivedBy && typeof obj.waivedBy === 'object') {
                const full = `${obj.waivedBy.firstName || ''} ${obj.waivedBy.lastName || ''}`.trim();
                adminName = obj.waivedBy.name || full || obj.waivedBy.email || adminName;
            }
            if (!adminName || adminName === 'Committee Admin') {
                adminName = req.user?.name || req.user?.firstName || 'Committee Admin';
            }

            return {
                ...obj,
                invoice: invNum,
                invoiceNumber: invNum,
                waivedByName: adminName,
                waivedBy: adminName
            };
        });
    }

    static async waiveFine(req, data) {
        const db = req.opsDb;
        const { FineWaiver } = getDunningModels(db);
        const { BillingInvoice } = getBillingModels(db);
        const societyId = this.getSocietyId(req);
        const userId = this.getUserId(req);
        
        let userName = req.user?.name || `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email || "Committee Admin";

        const { invoiceId, invoiceNumber, flatNumber, residentName, originalFine, waivedAmount, reason } = data;

        if (!reason || reason.trim() === "") {
            throw new Error("Waiver reason is mandatory according to society audit rules.");
        }

        let targetInvoiceId = invoiceId || null;
        let targetInvoiceNum = invoiceNumber || data.invoice || "";
        let calculatedOriginalFine = Number(originalFine) || 0;
        let pendingAmount = Number(data.pendingAmount) || 0;

        let queryConditions = [];
        if (targetInvoiceId && mongoose.Types.ObjectId.isValid(targetInvoiceId)) {
            queryConditions.push({ _id: targetInvoiceId });
        }
        if (targetInvoiceNum) {
            queryConditions.push({ invoiceNumber: targetInvoiceNum });
        }
        if (queryConditions.length === 0 && flatNumber) {
            queryConditions.push({ flatNumber }, { invoiceNumber: flatNumber });
        }

        const inv = await BillingInvoice.findOne({
            societyId,
            $or: queryConditions
        }).sort({ createdAt: -1 });

        if (inv) {
            targetInvoiceId = inv._id;
            targetInvoiceNum = inv.invoiceNumber;
            calculatedOriginalFine = Number(originalFine) !== undefined ? Number(originalFine) : (inv.fineAmount || 0);
            const outstanding = Math.max(0, (inv.totalAmount || 0) - (inv.paidAmount || 0));
            pendingAmount = Number(data.pendingAmount) || (outstanding + calculatedOriginalFine);
        }

        const waiver = new FineWaiver({
            societyId,
            invoiceId: targetInvoiceId,
            invoiceNumber: targetInvoiceNum,
            flatNumber: flatNumber || "A-101",
            residentName: residentName || "Resident",
            originalFine: calculatedOriginalFine,
            pendingAmount: pendingAmount,
            waivedAmount: Number(waivedAmount) || 0,
            reason: reason.trim(),
            waivedBy: userId,
            waivedByName: userName,
            status: "APPROVED"
        });

        await waiver.save();

        if (inv) {
            inv.fineAmount = Math.max(0, (inv.fineAmount || 0) - Number(waivedAmount));
            await inv.save();
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
