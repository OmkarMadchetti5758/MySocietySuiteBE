"use strict";

const AppError = require("../../common/AppError");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { getBillingModels } = require("./billing.model");
const { logBillingAction } = require("../../services/billingAudit.service");
const { canAccessBillingResource } = require("../../services/billingAuthorization.service");

// ── Helpers ────────────────────────────────────────────────────────────────

function getFinancialYear(date = new Date()) {
    const d = new Date(date);
    const month = d.getMonth();
    const year = d.getFullYear();
    const fyStart = month >= 3 ? year : year - 1;
    const fyEnd = (fyStart + 1).toString().slice(-2);
    return `${fyStart}-${fyEnd}`;
}

function buildBillingPeriod(date, frequency = "MONTHLY") {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    if (frequency === "QUARTERLY") {
        const quarter = Math.ceil(month / 3);
        return `${year}-Q${quarter}`;
    }
    return `${year}-${String(month).padStart(2, "0")}`;
}

async function generateInvoiceNumber(societyId, db) {
    const { BillingInvoice } = getBillingModels(db);
    const fy = getFinancialYear();
    const count = await BillingInvoice.countDocuments({ societyId });
    return `INV/${fy}/${String(count + 1).padStart(6, "0")}`;
}

async function generateReceiptNumber(societyId, db) {
    const { InvoicePayment } = getBillingModels(db);
    const count = await InvoicePayment.countDocuments({ societyId });
    return `RCP/${getFinancialYear()}/${String(count + 1).padStart(6, "0")}`;
}

async function _calculateCharges(societyId, flatId, billingDate, db) {
    const { ChargeHead, OneTimeCharge } = getBillingModels(db);

    let flatArea = 0;
    try {
        const flatSchema = require("../../modules/flat/flat.model");
        const FlatModel = db.models.Flat || db.model("Flat", flatSchema);
        const flat = await FlatModel.findById(flatId).lean();
        flatArea = flat?.area || 0;
    } catch (_) {}

    const date = new Date(billingDate);
    const chargeHeads = await ChargeHead.find({
        societyId,
        status: { $in: ["APPROVED", "approved"] },
        isActive: { $ne: false },
        deletedAt: null,
        $or: [
            { effectiveFrom: { $lte: date } },
            { effectiveFrom: null },
            { effectiveFrom: { $exists: false } }
        ],
        $and: [
            {
                $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: date } }]
            }
        ]
    }).lean();

    const period = buildBillingPeriod(billingDate);
    const oneTimeCharges = await OneTimeCharge.find({
        societyId,
        flatId,
        billingPeriod: period,
        status: "PENDING",
    }).lean();

    const lineItems = [];
    let subTotal = 0;
    let totalGst = 0;

    for (const ch of chargeHeads) {
        let baseAmount = 0;
        let quantity = 0;

        if (ch.calculationType === "PER_SQ_FT") {
            quantity = flatArea;
            baseAmount = (ch.ratePerSqFt || ch.rate || 0) * flatArea;
        } else {
            quantity = 1;
            baseAmount = ch.defaultAmount || ch.rate || 0;
        }

        let gstAmount = 0;
        if (ch.gstApplicable && ch.gstRate > 0) {
            gstAmount = Math.round((baseAmount * ch.gstRate) / 100 * 100) / 100;
        }

        const totalAmount = baseAmount + gstAmount;
        subTotal += baseAmount;
        totalGst += gstAmount;

        lineItems.push({
            chargeHeadId: ch._id,
            chargeHeadName: ch.name || ch.title,
            chargeHeadCode: ch.code,
            calculationType: ch.calculationType,
            rate: ch.calculationType === "PER_SQ_FT" ? ch.ratePerSqFt : ch.defaultAmount,
            quantity,
            baseAmount: Math.round(baseAmount * 100) / 100,
            gstApplicable: ch.gstApplicable,
            gstRate: ch.gstRate,
            gstAmount: Math.round(gstAmount * 100) / 100,
            totalAmount: Math.round(totalAmount * 100) / 100,
        });
    }

    for (const otc of oneTimeCharges) {
        subTotal += otc.amount;
        totalGst += otc.taxAmount || 0;
        lineItems.push({
            chargeHeadId: otc.chargeHeadId || null,
            chargeHeadName: otc.description,
            chargeHeadCode: "OTC",
            calculationType: "FIXED",
            rate: otc.amount,
            quantity: 1,
            baseAmount: otc.amount,
            gstApplicable: (otc.taxRate || 0) > 0,
            gstRate: otc.taxRate || 0,
            gstAmount: otc.taxAmount || 0,
            totalAmount: otc.totalAmount,
        });
    }

    const cgst = Math.round((totalGst / 2) * 100) / 100;
    const sgst = Math.round((totalGst / 2) * 100) / 100;

    return {
        lineItems,
        subTotal: Math.round(subTotal * 100) / 100,
        totalGst: Math.round(totalGst * 100) / 100,
        cgst,
        sgst,
        oneTimeChargeIds: oneTimeCharges.map(o => o._id),
    };
}

async function _calculateArrears(societyId, flatId, currentPeriod, db) {
    const { BillingInvoice } = getBillingModels(db);

    const unpaidInvoices = await BillingInvoice.find({
        societyId,
        flatId,
        billingPeriod: { $lt: currentPeriod },
        status: { $in: ["GENERATED", "OVERDUE", "PARTIALLY_PAID", "unpaid", "partially_paid", "overdue"] },
    }).lean();

    let totalArrears = 0;
    const breakdown = [];

    for (const inv of unpaidInvoices) {
        const outstanding = (inv.totalAmount || 0) - (inv.paidAmount || 0);
        if (outstanding > 0) {
            totalArrears += outstanding;
            breakdown.push({
                billingPeriod: inv.billingPeriod,
                amount: Math.round(outstanding * 100) / 100,
                invoiceId: inv._id,
            });
        }
    }

    return {
        arrearsAmount: Math.round(totalArrears * 100) / 100,
        arrearsBreakdown: breakdown,
    };
}

async function _calculateFines(societyId, flatId, db) {
    const { BillingInvoice } = getBillingModels(db);
    const now = new Date();

    const overdueInvoices = await BillingInvoice.find({
        societyId,
        flatId,
        status: { $in: ["OVERDUE", "overdue"] },
        dueDate: { $lt: now },
    }).lean();

    const fineAmount = overdueInvoices.length * 100;
    return { fineAmount };
}

async function _fetchApprovedAdjustments(societyId, flatId, db) {
    const { CreditNote, Discount } = getBillingModels(db);

    const [creditNotes, discounts] = await Promise.all([
        CreditNote.find({ societyId, flatId, status: "approved" }).lean(),
        Discount.find({ societyId, flatId, status: "approved" }).lean(),
    ]);

    const creditNoteAmount = creditNotes.reduce((s, cn) => s + (cn.amount || 0), 0);
    const discountAmount = discounts.reduce((s, d) => s + (d.amount || 0), 0);

    return {
        creditNoteAmount: Math.round(creditNoteAmount * 100) / 100,
        discountAmount: Math.round(discountAmount * 100) / 100,
    };
}

// ── Main Service Class ─────────────────────────────────────────────────────

class InvoiceService {

    static async getInvoiceSummaryStats(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const societyId = req.user.societyId;
        const roleKeys = req.user.roleKeys || [];
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || roleKeys.includes("admin") || roleKeys.includes("super_admin");
        const isAccountant = roleKeys.includes("accountant");
        const isResidentOnly = !isAdmin && !isAccountant;

        const filter = { societyId };
        if (isResidentOnly) {
            filter.$or = [
                { residentUserId: req.user._id },
                { residentUserId: String(req.user._id) }
            ];
        }

        const [total, paid, partiallyPaid, overdue, unpaid] = await Promise.all([
            BillingInvoice.countDocuments({ ...filter }),
            BillingInvoice.countDocuments({ ...filter, status: { $in: ["PAID", "paid"] } }),
            BillingInvoice.countDocuments({ ...filter, status: { $in: ["PARTIALLY_PAID", "partially_paid"] } }),
            BillingInvoice.countDocuments({ ...filter, status: { $in: ["OVERDUE", "overdue"] } }),
            BillingInvoice.countDocuments({ ...filter, status: { $in: ["GENERATED", "unpaid"] } }),
        ]);

        return { total, generated: total, paid, partiallyPaid, unpaid, overdue };
    }

    static async listInvoices(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const societyId = req.user.societyId;
        const { search, status, billingPeriod, flatId, page = 1, limit = 20 } = req.query;
        const roleKeys = req.user.roleKeys || [];
        const isAdmin = req.user.role === "admin" || req.user.role === "super_admin" || roleKeys.includes("admin") || roleKeys.includes("super_admin");
        const isAccountant = roleKeys.includes("accountant");
        const isResidentOnly = !isAdmin && !isAccountant;

        const filter = { societyId };

        if (isResidentOnly) {
            filter.$or = [
                { residentUserId: req.user._id },
                { residentUserId: String(req.user._id) }
            ];
        }

        if (status && status !== "ALL") {
            const statusMap = {
                PAID: ["PAID", "paid"],
                UNPAID: ["GENERATED", "unpaid"],
                PARTIALLY_PAID: ["PARTIALLY_PAID", "partially_paid"],
                OVERDUE: ["OVERDUE", "overdue"],
                DRAFT: ["DRAFT"],
                GENERATED: ["GENERATED"],
                CANCELLED: ["CANCELLED"],
            };
            filter.status = { $in: statusMap[status.toUpperCase()] || [status] };
        }

        if (billingPeriod) filter.billingPeriod = billingPeriod;
        if (flatId) filter.flatId = flatId;

        if (search) {
            const regex = new RegExp(search.trim(), "i");
            const searchCond = [{ invoiceNumber: regex }, { flatNumber: regex }, { residentName: regex }];
            if (filter.$or) {
                filter.$and = [{ $or: filter.$or }, { $or: searchCond }];
                delete filter.$or;
            } else {
                filter.$or = searchCond;
            }
        }

        const skip = (Number(page) - 1) * Number(limit);
        const [invoices, total] = await Promise.all([
            BillingInvoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
            BillingInvoice.countDocuments(filter),
        ]);

        return {
            invoices,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit)),
            },
        };
    }

    static async getInvoiceById(req, invoiceId) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const invoice = await BillingInvoice.findOne({
            _id: invoiceId,
            societyId: req.user.societyId,
        }).lean();

        if (!invoice) throw new AppError("Invoice not found.", 404);

        const isStaff = canAccessBillingResource(req.user, invoice, BILLING_PERMISSIONS.INVOICE_VIEW);
        if (!isStaff) {
            const isOwn = canAccessBillingResource(req.user, invoice, BILLING_PERMISSIONS.OWN_INVOICE_VIEW);
            if (!isOwn) throw new AppError("Invoice not found.", 404);
        }

        return invoice;
    }

    static async previewInvoiceCalculation(req, data) {
        const { flatId, billingDate, advanceAdjustment = 0 } = data;
        if (!flatId) throw new AppError("flatId is required.", 400);

        const db = req.opsDb;
        const societyId = req.user.societyId;
        const date = billingDate ? new Date(billingDate) : new Date();

        const { BillingConfiguration, BillingInvoice } = getBillingModels(db);
        const config = await BillingConfiguration.findOne({ societyId }).lean();
        const frequency = config?.billingFrequency || "MONTHLY";
        const currentPeriod = buildBillingPeriod(date, frequency);

        const existing = await BillingInvoice.findOne({
            societyId,
            flatId,
            billingPeriod: currentPeriod,
            status: { $nin: ["CANCELLED"] },
        }).lean();

        if (existing) {
            return {
                alreadyGenerated: true,
                invoiceId: existing._id,
                invoiceNumber: existing.invoiceNumber,
                billingPeriod: currentPeriod,
                message: `Invoice ${existing.invoiceNumber} already generated for this billing period.`,
            };
        }

        const [chargesResult, arrearsResult, finesResult, adjustmentsResult] = await Promise.all([
            _calculateCharges(societyId, flatId, date, db),
            _calculateArrears(societyId, flatId, currentPeriod, db),
            _calculateFines(societyId, flatId, db),
            _fetchApprovedAdjustments(societyId, flatId, db),
        ]);

        const { lineItems, subTotal, totalGst, cgst, sgst } = chargesResult;
        const { arrearsAmount, arrearsBreakdown } = arrearsResult;
        const { fineAmount } = finesResult;
        const { creditNoteAmount, discountAmount } = adjustmentsResult;

        const advance = Math.min(Number(advanceAdjustment) || 0, subTotal + totalGst);
        const totalPayable = Math.max(
            0,
            Math.round((subTotal + totalGst + arrearsAmount + fineAmount - creditNoteAmount - discountAmount - advance) * 100) / 100
        );

        return {
            alreadyGenerated: false,
            billingPeriod: currentPeriod,
            lineItems,
            subTotal,
            totalGst,
            cgst,
            sgst,
            arrearsAmount,
            arrearsBreakdown: config?.arrearsDisplayMode === "LINE_BY_LINE" ? arrearsBreakdown : [],
            fineAmount,
            creditNoteAmount,
            discountAmount,
            advanceAdjustment: advance,
            totalPayable,
        };
    }

    static async generateInvoice(req, data) {
        const { BillingInvoice, BillingConfiguration, OneTimeCharge } = getBillingModels(req.opsDb);
        const societyId = req.user.societyId;
        const db = req.opsDb;

        const {
            flatId,
            residentUserId,
            residentName = "",
            flatNumber = "",
            blockName = "",
            billingDate,
            invoiceDate,
            dueDate,
            advanceAdjustment = 0,
            isBulk = false,
            bulkJobId = null,
        } = data;

        if (!flatId) throw new AppError("flatId is required.", 400);
        if (!residentUserId) throw new AppError("residentUserId is required.", 400);

        const date = billingDate ? new Date(billingDate) : new Date();
        const config = await BillingConfiguration.findOne({ societyId }).lean();
        const frequency = config?.billingFrequency || "MONTHLY";
        const billingPeriod = buildBillingPeriod(date, frequency);

        const invDate = invoiceDate ? new Date(invoiceDate) : date;
        const dueDaysOffset = config?.dueDays || 10;
        const computedDueDate = dueDate
            ? new Date(dueDate)
            : new Date(invDate.getTime() + dueDaysOffset * 24 * 60 * 60 * 1000);

        const existing = await BillingInvoice.findOne({
            societyId,
            flatId,
            billingPeriod,
            status: { $nin: ["CANCELLED"] },
        }).lean();

        if (existing) {
            throw new AppError(
                `Invoice already generated for flat ${flatNumber || flatId} in ${billingPeriod}.`,
                409
            );
        }

        const [chargesResult, arrearsResult, finesResult, adjustmentsResult] = await Promise.all([
            _calculateCharges(societyId, flatId, date, db),
            _calculateArrears(societyId, flatId, billingPeriod, db),
            _calculateFines(societyId, flatId, db),
            _fetchApprovedAdjustments(societyId, flatId, db),
        ]);

        const { lineItems, subTotal, totalGst, cgst, sgst, oneTimeChargeIds } = chargesResult;
        const { arrearsAmount, arrearsBreakdown } = arrearsResult;
        const { fineAmount } = finesResult;
        const { creditNoteAmount, discountAmount } = adjustmentsResult;

        const advance = Math.min(Number(advanceAdjustment) || 0, subTotal + totalGst);
        const totalAmount = Math.max(
            0,
            Math.round((subTotal + totalGst + arrearsAmount + fineAmount - creditNoteAmount - discountAmount - advance) * 100) / 100
        );

        const invoiceNumber = await generateInvoiceNumber(societyId, db);

        let invoice;
        try {
            invoice = await BillingInvoice.create({
                societyId,
                invoiceNumber,
                flatId,
                userId: residentUserId,
                residentName,
                flatNumber,
                blockName,
                billingPeriod,
                invoiceDate: invDate,
                dueDate: computedDueDate,
                subTotal,
                totalGst,
                cgst,
                sgst,
                arrearsAmount,
                fineAmount,
                creditNoteAmount,
                discountAmount,
                advanceAdjustment: advance,
                totalAmount,
                paidAmount: 0,
                status: "GENERATED",
                lineItems,
                arrearsBreakdown,
                generatedBy: req.user.id,
                generatedAt: new Date(),
                isBulk,
                bulkJobId,
            });
        } catch (err) {
            if (err.code === 11000) {
                throw new AppError(
                    `Duplicate invoice prevented for flat ${flatNumber || flatId} in ${billingPeriod}.`,
                    409
                );
            }
            throw err;
        }

        if (oneTimeChargeIds.length > 0) {
            await OneTimeCharge.updateMany(
                { _id: { $in: oneTimeChargeIds } },
                { $set: { status: "INCLUDED", invoiceId: invoice._id } }
            );
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.INVOICE_GENERATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            amount: totalAmount,
            details: { invoiceNumber, flatId, billingPeriod, isBulk },
        });

        return invoice;
    }

    static async bulkGenerateInvoices(req, data) {
        const { billingDate, invoiceDate, dueDate, flats } = data;

        if (!Array.isArray(flats) || flats.length === 0) {
            throw new AppError("flats array is required and must not be empty.", 400);
        }

        const bulkJobId = `BULK-${Date.now()}-${req.user.id}`;
        const results = { successful: 0, skipped: 0, failed: 0, errors: [] };
        const generated = [];

        for (const flatInfo of flats) {
            try {
                const invoice = await InvoiceService.generateInvoice(req, {
                    ...flatInfo,
                    billingDate,
                    invoiceDate,
                    dueDate,
                    isBulk: true,
                    bulkJobId,
                });
                generated.push(invoice._id);
                results.successful++;
            } catch (err) {
                if (err.statusCode === 409 || (err.message && err.message.toLowerCase().includes("already"))) {
                    results.skipped++;
                    results.errors.push({
                        flatId: flatInfo.flatId,
                        flatNumber: flatInfo.flatNumber || flatInfo.flatId,
                        reason: "Invoice already exists for this billing period",
                        type: "DUPLICATE",
                    });
                } else {
                    results.failed++;
                    results.errors.push({
                        flatId: flatInfo.flatId,
                        flatNumber: flatInfo.flatNumber || flatInfo.flatId,
                        reason: err.message || "Unknown error",
                        type: "FAILED",
                    });
                }
            }
        }

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.INVOICE_GENERATE,
            resource: "BillingInvoice",
            resourceId: bulkJobId,
            details: { bulkJobId, total: flats.length, ...results },
        });

        return { bulkJobId, ...results, generatedInvoiceIds: generated };
    }

    static async cancelInvoice(req, invoiceId, reason) {
        const { BillingInvoice } = getBillingModels(req.opsDb);

        const invoice = await BillingInvoice.findOne({
            _id: invoiceId,
            societyId: req.user.societyId,
        });

        if (!invoice) throw new AppError("Invoice not found.", 404);
        if (["PAID", "paid"].includes(invoice.status)) throw new AppError("Cannot cancel a fully paid invoice.", 400);
        if (invoice.status === "CANCELLED") throw new AppError("Invoice is already cancelled.", 400);
        if (!reason || !reason.trim()) throw new AppError("Cancellation reason is required.", 400);

        invoice.status = "CANCELLED";
        invoice.cancelledBy = req.user.id;
        invoice.cancelledAt = new Date();
        invoice.cancellationReason = reason.trim();
        await invoice.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.INVOICE_UPDATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            details: { action: "CANCEL", reason: reason.trim() },
        });

        return invoice;
    }

    static async recordPayment(req, invoiceId, data) {
        const { BillingInvoice, InvoicePayment } = getBillingModels(req.opsDb);
        const societyId = req.user.societyId;

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId });
        if (!invoice) throw new AppError("Invoice not found.", 404);
        if (invoice.status === "CANCELLED") throw new AppError("Cannot record payment on a cancelled invoice.", 400);
        if (["PAID", "paid"].includes(invoice.status)) throw new AppError("Invoice is already fully paid.", 400);

        const { amountPaid, paymentMode = "CASH", paymentAccount = null, paymentDate, referenceNumber = null, notes = "" } = data;

        const amount = Number(amountPaid);
        if (isNaN(amount) || amount <= 0) throw new AppError("amountPaid must be a positive number.", 400);

        const outstanding = (invoice.totalAmount || 0) - (invoice.paidAmount || 0);
        let excessAmount = 0;
        let effectivePaid = amount;

        if (amount > outstanding) {
            excessAmount = Math.round((amount - outstanding) * 100) / 100;
            effectivePaid = outstanding;
        }

        const receiptNumber = await generateReceiptNumber(societyId, req.opsDb);

        const payment = await InvoicePayment.create({
            societyId,
            invoiceId: invoice._id,
            flatId: invoice.flatId,
            userId: invoice.userId,
            amountPaid: amount,
            paymentMode: paymentMode.toUpperCase(),
            paymentAccount,
            paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
            receiptNumber,
            referenceNumber,
            notes,
            paymentType: "OFFLINE",
            recordedBy: req.user.id,
            excessAmount,
        });

        const newPaidAmount = Math.round(((invoice.paidAmount || 0) + effectivePaid) * 100) / 100;
        const newStatus = newPaidAmount >= invoice.totalAmount ? "PAID" : "PARTIALLY_PAID";

        invoice.paidAmount = newPaidAmount;
        invoice.status = newStatus;
        await invoice.save();

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.PAYMENT_OFFLINE_CREATE,
            resource: "BillingInvoice",
            resourceId: invoice._id,
            amount,
            details: { receiptNumber, paymentMode, paymentAccount, newStatus, excessAmount },
        });

        return { payment, invoice };
    }

    static async getInvoicePayments(req, invoiceId) {
        const { InvoicePayment, BillingInvoice } = getBillingModels(req.opsDb);

        const invoice = await BillingInvoice.findOne({
            _id: invoiceId,
            societyId: req.user.societyId,
        }).lean();

        if (!invoice) throw new AppError("Invoice not found.", 404);

        const payments = await InvoicePayment.find({
            invoiceId,
            societyId: req.user.societyId,
        }).sort({ createdAt: -1 }).lean();

        return { invoice, payments };
    }

    static async addOneTimeCharge(req, data) {
        const { OneTimeCharge } = getBillingModels(req.opsDb);
        const societyId = req.user.societyId;

        const { flatId, userId = null, chargeHeadId = null, description, amount, taxRate = 0, billingPeriod, effectiveDate } = data;

        if (!flatId) throw new AppError("flatId is required.", 400);
        if (!description || !description.trim()) throw new AppError("description is required.", 400);
        if (!amount || Number(amount) <= 0) throw new AppError("amount must be positive.", 400);
        if (!billingPeriod) throw new AppError("billingPeriod is required.", 400);

        const parsedAmount = Number(amount);
        const parsedTaxRate = Number(taxRate) || 0;
        const taxAmount = Math.round((parsedAmount * parsedTaxRate / 100) * 100) / 100;
        const totalAmount = parsedAmount + taxAmount;

        const charge = await OneTimeCharge.create({
            societyId,
            flatId,
            userId: userId || null,
            chargeHeadId: chargeHeadId || null,
            description: description.trim(),
            amount: parsedAmount,
            taxRate: parsedTaxRate,
            taxAmount,
            totalAmount,
            billingPeriod,
            effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
            status: "PENDING",
            createdBy: req.user.id,
        });

        await logBillingAction({
            req,
            action: BILLING_PERMISSIONS.INVOICE_GENERATE,
            resource: "OneTimeCharge",
            resourceId: charge._id,
            amount: totalAmount,
            details: { description: description.trim(), flatId, billingPeriod },
        });

        return charge;
    }

    static async listOneTimeCharges(req) {
        const { OneTimeCharge } = getBillingModels(req.opsDb);
        const { flatId, billingPeriod, status, page = 1, limit = 20 } = req.query;

        const filter = { societyId: req.user.societyId };
        if (flatId) filter.flatId = flatId;
        if (billingPeriod) filter.billingPeriod = billingPeriod;
        if (status) filter.status = status.toUpperCase();

        const skip = (Number(page) - 1) * Number(limit);
        const [charges, total] = await Promise.all([
            OneTimeCharge.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
            OneTimeCharge.countDocuments(filter),
        ]);

        return {
            charges,
            pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
        };
    }

    static async getMyInvoices(req) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const filter = { societyId: req.user.societyId };
        const userId = req.user.id || req.user._id;
        const userIdStr = String(userId);
        const orClauses = [
            { userId: userIdStr },
            { residentUserId: userIdStr },
        ];
        if (req.user._id) {
            orClauses.push({ userId: req.user._id }, { residentUserId: req.user._id });
        }
        if (req.user.flatId) orClauses.push({ flatId: req.user.flatId });
        filter.$or = orClauses;
        return BillingInvoice.find(filter).sort({ createdAt: -1 }).lean();
    }

    static async getMyInvoiceById(req, invoiceId) {
        const { BillingInvoice } = getBillingModels(req.opsDb);
        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId: req.user.societyId }).lean();
        if (!invoice) throw new AppError("Invoice not found.", 404);
        const userId = String(req.user.id || req.user._id);
        const isOwn = String(invoice.userId) === userId ||
            String(invoice.residentUserId) === userId ||
            (req.user.flatId && String(invoice.flatId) === String(req.user.flatId));
        if (!isOwn) throw new AppError("Invoice not found.", 404);
        return invoice;
    }
}

module.exports = InvoiceService;
