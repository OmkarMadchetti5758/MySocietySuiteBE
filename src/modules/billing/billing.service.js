"use strict";

const AppError = require("../../common/AppError");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const {
    getBillingModels,
} = require("./billing.model");
const {
    requiresCommitteeApproval,
    checkSelfApproval,
    canAccessBillingResource,
} = require("../../services/billingAuthorization.service");
const { logBillingAction } = require("../../services/billingAudit.service");

class BillingService {

    // ── 1. Charge Heads ────────────────────────────────────────────────────────
    static async createChargeHead(req, data) {
        const { ChargeHead } = getBillingModels(req.opsDb);
        const {
            name,
            code,
            description,
            category = "INCOME",
            calculationType = "FIXED",
            defaultAmount,
            ratePerSqFt,
            gstApplicable = false,
            gstRate,
            applicability,
            ledgerAccountId,
            status = "PENDING_APPROVAL",
        } = data;

        // 1. Validation: Name & Code
        const finalName = (name || data.title || "").trim();
        if (!finalName) {
            throw new AppError("Charge head name is mandatory.", 400);
        }

        const generatedCode = (code || finalName.toUpperCase().replace(/[^A_Z0-9]/g, "_")).trim().toUpperCase();
        if (!generatedCode) {
            throw new AppError("Charge head code is mandatory.", 400);
        }

        // Check unique code / name within society
        const existing = await ChargeHead.findOne({
            societyId: req.user.societyId,
            deletedAt: null,
            $or: [
                { code: generatedCode },
                { name: { $regex: new RegExp(`^${finalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } }
            ]
        });
        if (existing) {
            throw new AppError(`A charge head with code '${generatedCode}' or name '${finalName}' already exists in your society.`, 409);
        }

        // 2. Validation: Category & Calculation Type
        if (!["INCOME", "EXPENSE"].includes(category.toUpperCase())) {
            throw new AppError("Category must be either INCOME or EXPENSE.", 400);
        }

        const calcType = calculationType.toUpperCase();
        if (!["FIXED", "PER_SQ_FT"].includes(calcType)) {
            throw new AppError("Calculation type must be either FIXED or PER_SQ_FT.", 400);
        }

        let parsedDefaultAmount = Number(defaultAmount || data.rate || 0);
        let parsedRatePerSqFt = Number(ratePerSqFt || 0);

        if (calcType === "FIXED") {
            if (isNaN(parsedDefaultAmount) || parsedDefaultAmount <= 0) {
                throw new AppError("Fixed calculation type requires a default amount greater than 0.", 400);
            }
            parsedRatePerSqFt = 0;
        } else if (calcType === "PER_SQ_FT") {
            if (isNaN(parsedRatePerSqFt) || parsedRatePerSqFt <= 0) {
                if (parsedDefaultAmount > 0) parsedRatePerSqFt = parsedDefaultAmount; // fallback mapping
                else throw new AppError("Per Sq Ft calculation type requires a rate per sq.ft greater than 0.", 400);
            }
            parsedDefaultAmount = 0;
        }

        // 3. Validation: GST Settings
        let isGst = Boolean(gstApplicable);
        let parsedGstRate = null;
        if (isGst) {
            parsedGstRate = Number(gstRate);
            if (isNaN(parsedGstRate) || parsedGstRate <= 0) {
                throw new AppError("GST rate must be greater than 0 when GST is applicable.", 400);
            }
        }

        // 4. Validation: Applicability
        const finalApplicability = {
            residentTypes: Array.isArray(applicability?.residentTypes) && applicability.residentTypes.length > 0
                ? applicability.residentTypes.map(r => r.toUpperCase())
                : ["OWNER", "TENANT"],
            allBlocks: applicability?.allBlocks !== undefined ? Boolean(applicability.allBlocks) : true,
            selectedBlocks: Array.isArray(applicability?.selectedBlocks) ? applicability.selectedBlocks : [],
        };

        const targetStatus = ["DRAFT", "PENDING_APPROVAL"].includes(status.toUpperCase()) ? status.toUpperCase() : "PENDING_APPROVAL";

        const chargeHead = await ChargeHead.create({
            societyId: req.user.societyId,
            name: finalName,
            code: generatedCode,
            description: description || "",
            category: category.toUpperCase(),
            calculationType: calcType,
            defaultAmount: parsedDefaultAmount,
            ratePerSqFt: parsedRatePerSqFt,
            gstApplicable: isGst,
            gstRate: parsedGstRate,
            applicability: finalApplicability,
            ledgerAccountId: ledgerAccountId || null,
            status: targetStatus,
            isActive: true,
            createdBy: req.user.id,
            // Legacy backwards-compatibility properties
            title: finalName,
            type: category.toLowerCase(),
            rate: calcType === "FIXED" ? parsedDefaultAmount : parsedRatePerSqFt,
            frequency: data.frequency || "monthly",
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CHARGE_HEAD_CREATE,
            resource: "ChargeHead",
            resourceId: chargeHead._id,
            details: { name: finalName, code: generatedCode, category, calculationType: calcType, status: targetStatus },
        });

        return chargeHead;
    }

    static async updateChargeHead(req, chargeHeadId, data) {
        const { ChargeHead } = getBillingModels(req.opsDb);
        
        const existing = await ChargeHead.findOne({
            _id: chargeHeadId,
            societyId: req.user.societyId,
            deletedAt: null,
        });

        if (!existing) {
            throw new AppError("Charge head not found.", 404);
        }

        // If existing charge head is already APPROVED or ACTIVE, per BRD section 18,
        // do not mutate historical active configuration. Create a new candidate version in PENDING_APPROVAL.
        if (existing.status === "APPROVED" || existing.status === "active") {
            const newVersionNumber = (existing.version || 1) + 1;
            const updatedName = (data.name || existing.name).trim();
            const updatedCategory = (data.category || existing.category).toUpperCase();
            const updatedCalcType = (data.calculationType || existing.calculationType).toUpperCase();
            
            let parsedDefaultAmount = data.defaultAmount !== undefined ? Number(data.defaultAmount) : existing.defaultAmount;
            let parsedRatePerSqFt = data.ratePerSqFt !== undefined ? Number(data.ratePerSqFt) : existing.ratePerSqFt;

            if (updatedCalcType === "FIXED" && parsedDefaultAmount <= 0) {
                throw new AppError("Fixed calculation type requires a default amount greater than 0.", 400);
            }
            if (updatedCalcType === "PER_SQ_FT" && parsedRatePerSqFt <= 0) {
                throw new AppError("Per Sq Ft calculation type requires a rate per sq.ft greater than 0.", 400);
            }

            const isGst = data.gstApplicable !== undefined ? Boolean(data.gstApplicable) : existing.gstApplicable;
            let parsedGstRate = null;
            if (isGst) {
                parsedGstRate = data.gstRate !== undefined ? Number(data.gstRate) : existing.gstRate;
                if (isNaN(parsedGstRate) || parsedGstRate <= 0) {
                    throw new AppError("GST rate must be greater than 0 when GST is applicable.", 400);
                }
            }

            const pendingCandidate = await ChargeHead.create({
                societyId: req.user.societyId,
                name: updatedName,
                code: existing.code,
                description: data.description !== undefined ? data.description : existing.description,
                category: updatedCategory,
                calculationType: updatedCalcType,
                defaultAmount: updatedCalcType === "FIXED" ? parsedDefaultAmount : 0,
                ratePerSqFt: updatedCalcType === "PER_SQ_FT" ? parsedRatePerSqFt : 0,
                gstApplicable: isGst,
                gstRate: parsedGstRate,
                applicability: data.applicability || existing.applicability,
                ledgerAccountId: data.ledgerAccountId !== undefined ? data.ledgerAccountId : existing.ledgerAccountId,
                status: "PENDING_APPROVAL",
                isActive: true,
                version: newVersionNumber,
                parentChargeHeadId: existing._id,
                createdBy: req.user.id,
                updatedBy: req.user.id,
                title: updatedName,
                type: updatedCategory.toLowerCase(),
                rate: updatedCalcType === "FIXED" ? parsedDefaultAmount : parsedRatePerSqFt,
            });

            await logBillingAction({
                req,
                action: BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE,
                resource: "ChargeHead",
                resourceId: pendingCandidate._id,
                details: { mode: "NEW_VERSION_SUBMITTED", parentId: existing._id, version: newVersionNumber },
            });

            return pendingCandidate;
        }

        // Otherwise (status is DRAFT, PENDING_APPROVAL, or REJECTED), update in place
        if (data.name) existing.name = data.name.trim();
        if (data.description !== undefined) existing.description = data.description;
        if (data.category) existing.category = data.category.toUpperCase();
        if (data.calculationType) existing.calculationType = data.calculationType.toUpperCase();
        if (data.defaultAmount !== undefined) existing.defaultAmount = Number(data.defaultAmount);
        if (data.ratePerSqFt !== undefined) existing.ratePerSqFt = Number(data.ratePerSqFt);
        if (data.gstApplicable !== undefined) existing.gstApplicable = Boolean(data.gstApplicable);
        if (data.gstRate !== undefined) existing.gstRate = existing.gstApplicable ? Number(data.gstRate) : null;
        if (data.applicability) existing.applicability = data.applicability;
        if (data.ledgerAccountId !== undefined) existing.ledgerAccountId = data.ledgerAccountId;
        existing.status = "PENDING_APPROVAL";
        existing.updatedBy = req.user.id;

        await existing.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE,
            resource: "ChargeHead",
            resourceId: existing._id,
            details: { mode: "IN_PLACE_UPDATE", status: existing.status },
        });

        return existing;
    }

    static async submitChargeHead(req, chargeHeadId) {
        const { ChargeHead } = getBillingModels(req.opsDb);
        const chargeHead = await ChargeHead.findOne({
            _id: chargeHeadId,
            societyId: req.user.societyId,
            deletedAt: null,
        });

        if (!chargeHead) {
            throw new AppError("Charge head not found.", 404);
        }
        if (chargeHead.status === "APPROVED") {
            throw new AppError("Charge head is already approved.", 400);
        }

        chargeHead.status = "PENDING_APPROVAL";
        chargeHead.updatedBy = req.user.id;
        await chargeHead.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE,
            resource: "ChargeHead",
            resourceId: chargeHead._id,
            details: { action: "SUBMIT_FOR_APPROVAL" },
        });

        return chargeHead;
    }

    static async approveChargeHead(req, chargeHeadId, action = "approve", rejectionReason = null) {
        const { ChargeHead } = getBillingModels(req.opsDb);

        const chargeHead = await ChargeHead.findOne({
            _id: chargeHeadId,
            societyId: req.user.societyId,
            deletedAt: null,
        });

        if (!chargeHead) {
            throw new AppError("Charge head not found.", 404);
        }

        if (chargeHead.status !== "PENDING_APPROVAL" && chargeHead.status !== "pending_approval") {
            throw new AppError(`Charge head is in '${chargeHead.status}' status and cannot be ${action}d.`, 409);
        }

        // Self approval prevention check
        if (checkSelfApproval(req.user, chargeHead)) {
            throw new AppError("Self-approval is forbidden. Another Committee Admin must approve.", 403);
        }

        if (action === "reject") {
            if (!rejectionReason || !rejectionReason.trim()) {
                throw new AppError("Rejection reason is mandatory when rejecting a charge head configuration.", 400);
            }

            chargeHead.status = "REJECTED";
            chargeHead.rejectedBy = req.user.id;
            chargeHead.rejectedAt = new Date();
            chargeHead.rejectionReason = rejectionReason.trim();
            await chargeHead.save();

            await logBillingAction({
                req,
                action: BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE,
                resource: "ChargeHead",
                resourceId: chargeHead._id,
                details: { status: "REJECTED", rejectionReason: chargeHead.rejectionReason },
            });

            return chargeHead;
        }

        // Action === "approve"
        chargeHead.status = "APPROVED";
        chargeHead.approvedBy = req.user.id;
        chargeHead.approvedAt = new Date();
        chargeHead.effectiveFrom = req.body?.effectiveFrom ? new Date(req.body.effectiveFrom) : new Date();
        
        // If this version has a parent charge head, deactivate/archive old parent version
        if (chargeHead.parentChargeHeadId) {
            await ChargeHead.updateOne(
                { _id: chargeHead.parentChargeHeadId, societyId: req.user.societyId },
                { $set: { effectiveTo: chargeHead.effectiveFrom, isActive: false, status: "ARCHIVED" } }
            );
        }

        await chargeHead.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CHARGE_HEAD_APPROVE,
            resource: "ChargeHead",
            resourceId: chargeHead._id,
            details: { status: "APPROVED", effectiveFrom: chargeHead.effectiveFrom },
        });

        return chargeHead;
    }

    static async getChargeHeads(req) {
        const { ChargeHead } = getBillingModels(req.opsDb);
        const { category, status, isActive, gstApplicable, calculationType, search } = req.query;

        const filter = {
            societyId: req.user.societyId,
            deletedAt: null,
        };

        if (category) filter.category = category.toUpperCase();
        if (status) filter.status = status.toUpperCase();
        if (isActive !== undefined) filter.isActive = isActive === "true" || isActive === true;
        if (gstApplicable !== undefined) filter.gstApplicable = gstApplicable === "true" || gstApplicable === true;
        if (calculationType) filter.calculationType = calculationType.toUpperCase();

        if (search) {
            const regex = new RegExp(search.trim(), "i");
            filter.$or = [{ name: regex }, { code: regex }, { title: regex }];
        }

        return ChargeHead.find(filter).sort({ createdAt: -1 }).lean();
    }

    static async getChargeHeadById(req, chargeHeadId) {
        const { ChargeHead } = getBillingModels(req.opsDb);
        const chargeHead = await ChargeHead.findOne({
            _id: chargeHeadId,
            societyId: req.user.societyId,
            deletedAt: null,
        }).lean();

        if (!chargeHead) {
            throw new AppError("Charge head not found.", 404);
        }

        return chargeHead;
    }

    static async deleteChargeHead(req, chargeHeadId) {
        const { ChargeHead, BillingInvoice } = getBillingModels(req.opsDb);
        const chargeHead = await ChargeHead.findOne({
            _id: chargeHeadId,
            societyId: req.user.societyId,
            deletedAt: null,
        });

        if (!chargeHead) {
            throw new AppError("Charge head not found.", 404);
        }

        // Check if charge head is referenced in any invoice line items
        const inUseCount = await BillingInvoice.countDocuments({
            societyId: req.user.societyId,
            "lineItems.chargeHeadId": chargeHead._id,
        });

        if (inUseCount > 0) {
            // Archive instead of physical/soft delete
            chargeHead.isActive = false;
            chargeHead.status = "ARCHIVED";
            chargeHead.deletedAt = new Date();
            await chargeHead.save();
        } else {
            chargeHead.deletedAt = new Date();
            chargeHead.isActive = false;
            await chargeHead.save();
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CHARGE_HEAD_UPDATE,
            resource: "ChargeHead",
            resourceId: chargeHead._id,
            details: { action: "DELETE", archivedOnly: inUseCount > 0 },
        });

        return { message: inUseCount > 0 ? "Charge head archived due to historical invoices." : "Charge head soft-deleted successfully." };
    }

    // Contract function for future Invoice Generation Module
    static async getApplicableChargeHeads(societyId, flatId, residentType, blockId, billingDate = new Date()) {
        const { ChargeHead } = getBillingModels();
        const date = new Date(billingDate);

        const chargeHeads = await ChargeHead.find({
            societyId,
            status: "APPROVED",
            isActive: true,
            deletedAt: null,
            effectiveFrom: { $lte: date },
            $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
        }).lean();

        // Filter by resident type & block applicability
        return chargeHeads.filter((ch) => {
            const residentTypes = ch.applicability?.residentTypes || ["OWNER", "TENANT"];
            if (residentType && !residentTypes.includes(residentType.toUpperCase())) {
                return false;
            }

            if (!ch.applicability?.allBlocks) {
                const blocks = (ch.applicability?.selectedBlocks || []).map(b => String(b));
                if (blockId && !blocks.includes(String(blockId))) {
                    return false;
                }
            }

            return true;
        });
    }

    // ── 1B. Society Billing Configuration ─────────────────────────────────────
    static async getBillingConfig(req) {
        const { BillingConfiguration } = getBillingModels(req.opsDb);
        let config = await BillingConfiguration.findOne({ societyId: req.user.societyId }).lean();

        if (!config) {
            config = {
                societyId: req.user.societyId,
                billingFrequency: "MONTHLY",
                billingDay: 1,
                dueDays: 10,
                arrearsDisplayMode: "SINGLE_TOTAL",
                defaultTaxSettings: { taxName: "GST", taxRate: 18 },
                currency: "INR",
                isActive: true,
            };
        }

        return config;
    }

    static async upsertBillingConfig(req, data) {
        const { BillingConfiguration } = getBillingModels(req.opsDb);
        const {
            billingFrequency = "MONTHLY",
            billingDay = 1,
            dueDays = 10,
            arrearsDisplayMode = "SINGLE_TOTAL",
            defaultTaxSettings,
            currency = "INR",
        } = data;

        if (!["MONTHLY", "QUARTERLY"].includes(billingFrequency.toUpperCase())) {
            throw new AppError("Billing frequency must be MONTHLY or QUARTERLY.", 400);
        }

        const bDay = Number(billingDay);
        if (isNaN(bDay) || bDay < 1 || bDay > 28) {
            throw new AppError("Billing day must be between 1 and 28.", 400);
        }

        const dDays = Number(dueDays);
        if (isNaN(dDays) || dDays < 1 || dDays > 90) {
            throw new AppError("Due days must be between 1 and 90.", 400);
        }

        if (!["SINGLE_TOTAL", "LINE_BY_LINE"].includes(arrearsDisplayMode.toUpperCase())) {
            throw new AppError("Arrears display mode must be SINGLE_TOTAL or LINE_BY_LINE.", 400);
        }

        const config = await BillingConfiguration.findOneAndUpdate(
            { societyId: req.user.societyId },
            {
                $set: {
                    billingFrequency: billingFrequency.toUpperCase(),
                    billingDay: bDay,
                    dueDays: dDays,
                    arrearsDisplayMode: arrearsDisplayMode.toUpperCase(),
                    defaultTaxSettings: {
                        taxName: defaultTaxSettings?.taxName || "GST",
                        taxRate: defaultTaxSettings?.taxRate !== undefined ? Number(defaultTaxSettings.taxRate) : 18,
                    },
                    currency: currency || "INR",
                    updatedBy: req.user.id,
                },
                $setOnInsert: {
                    createdBy: req.user.id,
                    isActive: true,
                },
            },
            { upsert: true, new: true, runValidators: true }
        );

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CONFIG_UPDATE,
            resource: "BillingConfiguration",
            resourceId: config._id,
            details: { billingFrequency, billingDay: bDay, dueDays: dDays, arrearsDisplayMode },
        });

        return config;
    }

    // ── 2. Invoices ────────────────────────────────────────────────────────────
    static async generateInvoice(req, data) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const { flatId, residentUserId, billingPeriod, totalAmount, dueDate, lineItems } = data;

        const count = await BillingInvoice.countDocuments({ societyId: req.user.societyId });
        const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

        const invoice = await BillingInvoice.create({
            societyId: req.user.societyId,
            invoiceNumber,
            flatId,
            userId: residentUserId,
            billingPeriod,
            totalAmount,
            dueDate: dueDate || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
            generatedBy: req.user.id,
            lineItems: lineItems || [{ chargeHeadTitle: "Maintenance Fee", amount: totalAmount }],
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.INVOICE_GENERATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            amount: totalAmount,
            details: { invoiceNumber, flatId, billingPeriod },
        });

        return invoice;
    }

    static async getInvoices(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        return BillingInvoice.find({ societyId: req.user.societyId }).lean();
    }

    static async getMyInvoices(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);

        // Strict ownership resolution
        const filter = {
            societyId: req.user.societyId,
            $or: [{ userId: req.user.id }],
        };
        if (req.user.flatId) {
            filter.$or.push({ flatId: req.user.flatId });
        }

        return BillingInvoice.find(filter).lean();
    }

    static async getMyInvoiceById(req, invoiceId) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const invoice = await BillingInvoice.findOne({
            _id: invoiceId,
            societyId: req.user.societyId,
        }).lean();

        if (!invoice) {
            throw new AppError("Invoice not found.", 404);
        }

        // Explicit IDOR check
        const hasAccess = canAccessBillingResource(req.user, invoice, BILLING_PERMISSIONS.OWN_INVOICE_VIEW);
        if (!hasAccess) {
            throw new AppError("Invoice not found.", 404); // Shield exists error for unauthorized resident
        }

        return invoice;
    }

    // ── 3. Payments & Offline Payments ────────────────────────────────────────
    static async recordOfflinePayment(req, data) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const { invoiceId, amountPaid } = data;

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId: req.user.societyId });
        if (!invoice) {
            throw new AppError("Invoice not found.", 404);
        }

        const newPaidAmount = (invoice.paidAmount || 0) + Number(amountPaid);
        const newStatus = newPaidAmount >= invoice.totalAmount ? "paid" : "partially_paid";

        invoice.paidAmount = newPaidAmount;
        invoice.status = newStatus;
        await invoice.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.PAYMENT_OFFLINE_CREATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            amount: amountPaid,
            details: { paymentType: "offline", newStatus },
        });

        return invoice;
    }

    static async payMyInvoice(req, invoiceId, amountPaid) {
        const invoice = await this.getMyInvoiceById(req, invoiceId);
        const { BillingInvoice } = getBillingModels(req.opsDb);

        const newPaidAmount = (invoice.paidAmount || 0) + Number(amountPaid);
        const newStatus = newPaidAmount >= invoice.totalAmount ? "paid" : "partially_paid";

        const updated = await BillingInvoice.findByIdAndUpdate(
            invoice._id,
            { $set: { paidAmount: newPaidAmount, status: newStatus } },
            { new: true }
        );

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.OWN_PAYMENT_CREATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            amount: amountPaid,
            details: { paymentType: "online_resident", newStatus },
        });

        return updated;
    }

    // ── 4. Credit Notes & Discounts ───────────────────────────────────────────
    static async createCreditNote(req, data) {
        const { CreditNote, BillingInvoice } = getBillingModels(req.opsDb);
        const { invoiceId, amount, reason } = data;

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId: req.user.societyId });
        if (!invoice) {
            throw new AppError("Invoice not found.", 404);
        }

        // Approval Threshold check
        const needsApproval = requiresCommitteeApproval({
            user: req.user,
            action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
            amount,
        });

        const status = needsApproval ? "pending_approval" : "approved";
        const count = await CreditNote.countDocuments({ societyId: req.user.societyId });
        const noteNumber = `CN-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

        const creditNote = await CreditNote.create({
            societyId: req.user.societyId,
            noteNumber,
            invoiceId: invoice._id,
            flatId: invoice.flatId,
            userId: invoice.userId,
            amount,
            reason,
            status,
            createdBy: req.user.id,
            approvedBy: status === "approved" ? req.user.id : null,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CREDIT_NOTE_CREATE,
            resource: "CreditNote",
            resourceId: creditNote._id,
            amount,
            details: { noteNumber, status, thresholdTriggered: needsApproval },
        });

        return creditNote;
    }

    static async approveCreditNote(req, creditNoteId, action = "approve") {
        const { CreditNote } = getBillingModels(req.opsDb);

        const targetStatus = action === "approve" ? "approved" : "rejected";

        // Atomic lock transition
        const creditNote = await CreditNote.findOneAndUpdate(
            {
                _id: creditNoteId,
                societyId: req.user.societyId,
                status: "pending_approval",
            },
            {
                $set: {
                    status: targetStatus,
                    approvedBy: req.user.id,
                },
            },
            { new: true }
        );

        if (!creditNote) {
            throw new AppError("Credit note not found or already processed.", 409);
        }

        // Self approval prevention
        if (checkSelfApproval(req.user, creditNote)) {
            await CreditNote.updateOne({ _id: creditNoteId }, { $set: { status: "pending_approval", approvedBy: null } });
            throw new AppError("Self-approval is forbidden. Another Committee Admin must approve.", 403);
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.CREDIT_NOTE_APPROVE,
            resource: "CreditNote",
            resourceId: creditNote._id,
            amount: creditNote.amount,
            details: { action, targetStatus },
        });

        return creditNote;
    }

    static async createDiscount(req, data) {
        const { Discount, BillingInvoice } = getBillingModels(req.opsDb);
        const { invoiceId, amount, reason, discountCode } = data;

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId: req.user.societyId });
        if (!invoice) {
            throw new AppError("Invoice not found.", 404);
        }

        const needsApproval = requiresCommitteeApproval({
            user: req.user,
            action: BILLING_PERMISSIONS.DISCOUNT_CREATE,
            amount,
        });

        const status = needsApproval ? "pending_approval" : "approved";

        const discount = await Discount.create({
            societyId: req.user.societyId,
            discountCode: discountCode || "DISC-PROMO",
            invoiceId: invoice._id,
            flatId: invoice.flatId,
            userId: invoice.userId,
            amount,
            reason,
            status,
            createdBy: req.user.id,
            approvedBy: status === "approved" ? req.user.id : null,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.DISCOUNT_CREATE,
            resource: "Discount",
            resourceId: discount._id,
            amount,
            details: { status, thresholdTriggered: needsApproval },
        });

        return discount;
    }

    static async approveDiscount(req, discountId, action = "approve") {
        const { Discount } = getBillingModels(req.opsDb);

        const targetStatus = action === "approve" ? "approved" : "rejected";

        const discount = await Discount.findOneAndUpdate(
            {
                _id: discountId,
                societyId: req.user.societyId,
                status: "pending_approval",
            },
            {
                $set: {
                    status: targetStatus,
                    approvedBy: req.user.id,
                },
            },
            { new: true }
        );

        if (!discount) {
            throw new AppError("Discount not found or already processed.", 409);
        }

        if (checkSelfApproval(req.user, discount)) {
            await Discount.updateOne({ _id: discountId }, { $set: { status: "pending_approval", approvedBy: null } });
            throw new AppError("Self-approval is forbidden. Another Committee Admin must approve.", 403);
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.DISCOUNT_APPROVE,
            resource: "Discount",
            resourceId: discount._id,
            amount: discount.amount,
            details: { action, targetStatus },
        });

        return discount;
    }

    // ── 5. Journal Vouchers & Vendor Payments ──────────────────────────────────
    static async createJournalVoucher(req, data) {
        const { JournalVoucher } = getBillingModels(req.opsDb);
        const { entries, totalAmount, narration } = data;

        const count = await JournalVoucher.countDocuments({ societyId: req.user.societyId });
        const voucherNumber = `JV-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

        const voucher = await JournalVoucher.create({
            societyId: req.user.societyId,
            voucherNumber,
            entries,
            totalAmount,
            narration,
            status: "pending_approval", // BRD specifies Committee Admin approval required
            createdBy: req.user.id,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.JOURNAL_VOUCHER_CREATE,
            resource: "JournalVoucher",
            resourceId: voucher._id,
            amount: totalAmount,
            details: { voucherNumber },
        });

        return voucher;
    }

    static async approveJournalVoucher(req, voucherId, action = "approve") {
        const { JournalVoucher } = getBillingModels(req.opsDb);
        const targetStatus = action === "approve" ? "approved" : "rejected";

        const voucher = await JournalVoucher.findOneAndUpdate(
            {
                _id: voucherId,
                societyId: req.user.societyId,
                status: "pending_approval",
            },
            {
                $set: {
                    status: targetStatus,
                    approvedBy: req.user.id,
                },
            },
            { new: true }
        );

        if (!voucher) {
            throw new AppError("Journal voucher not found or already processed.", 409);
        }

        if (checkSelfApproval(req.user, voucher)) {
            await JournalVoucher.updateOne({ _id: voucherId }, { $set: { status: "pending_approval", approvedBy: null } });
            throw new AppError("Self-approval is forbidden.", 403);
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.JOURNAL_VOUCHER_APPROVE,
            resource: "JournalVoucher",
            resourceId: voucher._id,
            amount: voucher.totalAmount,
            details: { action, targetStatus },
        });

        return voucher;
    }

    static async createVendorPayment(req, data) {
        const { VendorPayment } = getBillingModels(req.opsDb);
        const { vendorName, billReference, amount, paymentMode } = data;

        const needsApproval = requiresCommitteeApproval({
            user: req.user,
            action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
            amount,
        });

        const status = needsApproval ? "pending_approval" : "approved";
        const count = await VendorPayment.countDocuments({ societyId: req.user.societyId });
        const paymentNumber = `VP-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;

        const payment = await VendorPayment.create({
            societyId: req.user.societyId,
            paymentNumber,
            vendorName,
            billReference,
            amount,
            paymentMode,
            status,
            createdBy: req.user.id,
            approvedBy: status === "approved" ? req.user.id : null,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.VENDOR_PAYMENT_CREATE,
            resource: "VendorPayment",
            resourceId: payment._id,
            amount,
            details: { paymentNumber, status, thresholdTriggered: needsApproval },
        });

        return payment;
    }

    static async approveVendorPayment(req, paymentId, action = "approve") {
        const { VendorPayment } = getBillingModels(req.opsDb);
        const targetStatus = action === "approve" ? "approved" : "rejected";

        const payment = await VendorPayment.findOneAndUpdate(
            {
                _id: paymentId,
                societyId: req.user.societyId,
                status: "pending_approval",
            },
            {
                $set: {
                    status: targetStatus,
                    approvedBy: req.user.id,
                },
            },
            { new: true }
        );

        if (!payment) {
            throw new AppError("Vendor payment not found or already processed.", 409);
        }

        if (checkSelfApproval(req.user, payment)) {
            await VendorPayment.updateOne({ _id: paymentId }, { $set: { status: "pending_approval", approvedBy: null } });
            throw new AppError("Self-approval is forbidden.", 403);
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.VENDOR_PAYMENT_APPROVE,
            resource: "VendorPayment",
            resourceId: payment._id,
            amount: payment.amount,
            details: { action, targetStatus },
        });

        return payment;
    }

    // ── 6. Budgets & Reports ───────────────────────────────────────────────────
    static async createBudgetDraft(req, data) {
        const { AnnualBudget } = getBillingModels(req.opsDb);
        const { financialYear, totalBudgetAmount, categories } = data;

        const budget = await AnnualBudget.create({
            societyId: req.user.societyId,
            financialYear,
            totalBudgetAmount,
            categories: categories || [],
            status: "draft",
            createdBy: req.user.id,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.BUDGET_CREATE,
            resource: "AnnualBudget",
            resourceId: budget._id,
            amount: totalBudgetAmount,
            details: { financialYear },
        });

        return budget;
    }

    static async approveBudget(req, budgetId, action = "approve") {
        const { AnnualBudget } = getBillingModels(req.opsDb);
        const targetStatus = action === "approve" ? "approved" : "rejected";

        const budget = await AnnualBudget.findOneAndUpdate(
            {
                _id: budgetId,
                societyId: req.user.societyId,
                status: "draft",
            },
            {
                $set: {
                    status: targetStatus,
                    approvedBy: req.user.id,
                },
            },
            { new: true }
        );

        if (!budget) {
            throw new AppError("Budget not found or not in draft state.", 409);
        }

        if (checkSelfApproval(req.user, budget)) {
            await AnnualBudget.updateOne({ _id: budgetId }, { $set: { status: "draft", approvedBy: null } });
            throw new AppError("Self-approval is forbidden.", 403);
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.BUDGET_APPROVE,
            resource: "AnnualBudget",
            resourceId: budget._id,
            amount: budget.totalBudgetAmount,
            details: { action, targetStatus },
        });

        return budget;
    }

    static async reconcileAccounts(req, data) {
        const { FinancialReconciliation } = getBillingModels(req.opsDb);
        const { period, bankBalance, cashBookBalance, notes } = data;
        const difference = Number(bankBalance) - Number(cashBookBalance);

        const rec = await FinancialReconciliation.create({
            societyId: req.user.societyId,
            period,
            bankBalance,
            cashBookBalance,
            difference,
            status: Math.abs(difference) < 0.01 ? "reconciled" : "discrepancy",
            reconciledBy: req.user.id,
            notes,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.RECONCILIATION_RECONCILE,
            resource: "FinancialReconciliation",
            resourceId: rec._id,
            details: { period, status: rec.status, difference },
        });

        return rec;
    }

    static async getFinancialReports(req) {
        const { BillingInvoice, VendorPayment } = getBillingModels(req.opsDb);
        const invoices = await BillingInvoice.find({ societyId: req.user.societyId }).lean();
        const payments = await VendorPayment.find({ societyId: req.user.societyId, status: "approved" }).lean();

        const totalBilled = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
        const totalCollected = invoices.reduce((sum, inv) => sum + (inv.paidAmount || 0), 0);
        const totalExpenses = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        return {
            summary: {
                totalBilled,
                totalCollected,
                outstandingBalance: totalBilled - totalCollected,
                totalExpenses,
                netBalance: totalCollected - totalExpenses,
            },
            invoiceCount: invoices.length,
            vendorPaymentCount: payments.length,
        };
    }

    static async getMyLedger(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const invoices = await this.getMyInvoices(req);

        let runningBalance = 0;
        const entries = invoices.map((inv) => {
            const debit = inv.totalAmount || 0;
            const credit = inv.paidAmount || 0;
            runningBalance += (debit - credit);

            return {
                id: inv._id,
                date: inv.createdAt,
                description: `Invoice ${inv.invoiceNumber} (${inv.billingPeriod})`,
                debit,
                credit,
                balance: runningBalance,
                status: inv.status,
            };
        });

        return {
            flatId: req.user.flatId,
            userId: req.user.id,
            currentOutstandingBalance: runningBalance,
            entries,
        };
    }
}

module.exports = BillingService;
