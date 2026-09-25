"use strict";

const crypto = require("crypto");
const https = require("https");
const mongoose = require("mongoose");
const AppError = require("../../common/AppError");
const { getAdvanceDepositModels } = require("./advanceAccountsDeposits.model");
const { logBillingAction } = require("../../services/billingAudit.service");
const { BILLING_PERMISSIONS } = require("../../common/billingPermissions");
const { hasBillingPermission } = require("../../services/billingAuthorization.service");

// ─── Razorpay Helper ─────────────────────────────────────────────────────────
async function createRazorpayOrder({ amount, receipt, notes }) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const postData = JSON.stringify({
        amount: Math.round(amount * 100),
        currency: "INR",
        receipt,
        notes: notes || {},
    });
    return new Promise((resolve, reject) => {
        const options = {
            hostname: "api.razorpay.com",
            port: 443,
            path: "/v1/orders",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${auth}`,
                "Content-Length": Buffer.byteLength(postData),
            },
        };
        const req = https.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
                    else reject(new Error(parsed.error?.description || "Razorpay API error."));
                } catch (err) { reject(err); }
            });
        });
        req.on("error", (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function assertSociety(req, resource) {
    if (!resource) throw new AppError("Resource not found.", 404);
    if (String(resource.societyId) !== String(req.user.societyId)) {
        throw new AppError("Access denied. Cross-society access is not permitted.", 403);
    }
}

function assertResidentOwnership(req, resource) {
    if (!resource) throw new AppError("Resource not found.", 404);
    const resId = resource.residentId?._id ? String(resource.residentId._id) : String(resource.residentId || '');
    const userId = String(req.user?.id || req.user?._id || '');
    if (resId !== userId) {
        throw new AppError("Access denied. You can only access your own records.", 403);
    }
}

function isResidentScope(req, viewAllPermissionKey) {
    const activeContext = req.headers?.["x-active-context"] || req.headers?.["x-active-role"] || req.query?.activeContext;
    if (activeContext && String(activeContext).toLowerCase().trim() === "resident") {
        return true;
    }
    const hasViewAll = hasBillingPermission(req.user, viewAllPermissionKey, activeContext);
    return !hasViewAll;
}

function getPagination(query) {
    const page  = Math.max(1, parseInt(query.page)  || 1);
    const limit = Math.min(100, parseInt(query.limit) || 20);
    const skip  = (page - 1) * limit;
    return { page, limit, skip };
}

async function generateAccountNumber(db, prefix = "ADV") {
    const count = await db.model("ResidentAdvanceAccount").countDocuments();
    const pad = String(count + 1).padStart(6, "0");
    return `${prefix}-${new Date().getFullYear()}-${pad}`;
}

// ─── ADVANCE ACCOUNTS ────────────────────────────────────────────────────────
class AdvanceAccountsService {

    static async getOrCreateAccount(req, residentId, flatId) {
        const { ResidentAdvanceAccount } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        // If in resident scope, force residentId to logged in user
        let targetResidentId = residentId;
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE)) {
            targetResidentId = req.user.id;
        }

        // If residentId is missing, attempt to resolve from Flat or Resident collection
        if (!targetResidentId && flatId) {
            const Flat = req.opsDb.model("Flat");
            const flat = await Flat.findById(flatId).lean();
            if (flat) {
                targetResidentId = flat.activeTenant || flat.primaryOwner || null;
            }

            if (!targetResidentId) {
                const Resident = req.opsDb.model("Resident");
                const residentDoc = await Resident.findOne({
                    societyId,
                    flatId: new mongoose.Types.ObjectId(flatId),
                    isActive: true,
                }).lean();
                if (residentDoc) {
                    targetResidentId = residentDoc.userId || residentDoc.residentId || residentDoc._id;
                }
            }
        }

        // Final fallback: use current logged in user if still missing
        if (!targetResidentId) {
            targetResidentId = req.user.id;
        }

        let account = await ResidentAdvanceAccount.findOne({
            societyId,
            residentId: targetResidentId,
            status: { $in: ["ACTIVE", "ZERO_BALANCE"] },
        }).lean();

        if (!account) {
            const accountNumber = await generateAccountNumber(req.opsDb);
            account = await ResidentAdvanceAccount.create({
                societyId,
                residentId: targetResidentId,
                flatId,
                accountNumber,
                openingBalance: 0,
                currentBalance: 0,
                status: "ACTIVE",
                createdBy: req.user.id,
            });
        }
        return account;
    }

    static async listAccounts(req) {
        const { ResidentAdvanceAccount } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;
        const { page, limit, skip } = getPagination(req.query);
        const { status, flatId, residentId, search } = req.query;

        const filter = { societyId };
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL)) {
            filter.residentId = new mongoose.Types.ObjectId(req.user.id);
        } else {
            if (status) filter.status = status;
            if (flatId) filter.flatId = new mongoose.Types.ObjectId(flatId);
            if (residentId) filter.residentId = new mongoose.Types.ObjectId(residentId);
        }

        const [accounts, total] = await Promise.all([
            ResidentAdvanceAccount.find(filter)
                .populate("residentId", "name email phone")
                .populate("flatId", "flatNumber blockId")
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ResidentAdvanceAccount.countDocuments(filter),
        ]);

        return {
            accounts,
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    static async getAccountById(req, accountId) {
        const { ResidentAdvanceAccount } = getAdvanceDepositModels(req.opsDb);
        const account = await ResidentAdvanceAccount.findById(accountId)
            .populate("residentId", "name email phone")
            .populate("flatId", "flatNumber blockId")
            .lean();
        if (!account) throw new AppError("Advance account not found.", 404);
        assertSociety(req, account);
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL)) {
            assertResidentOwnership(req, account);
        }
        return account;
    }

    static async getMyAccount(req) {
        const { ResidentAdvanceAccount } = getAdvanceDepositModels(req.opsDb);
        const account = await ResidentAdvanceAccount.findOne({
            societyId: req.user.societyId,
            residentId: req.user.id,
            status: { $in: ["ACTIVE", "ZERO_BALANCE"] },
        })
            .populate("flatId", "flatNumber blockId")
            .lean();
        return account || null;
    }

    /**
     * Credit advance account — used for explicit advance payments or overpayments (admin/accountant)
     * Accepts paymentMode, referenceNumber, transactionDate for offline payment metadata.
     */
    static async creditAdvanceAccount(req, accountId, { amount, transactionType = "ADVANCE_RECEIVED", referenceType, referenceId, description, idempotencyKey, paymentMode, referenceNumber, transactionDate, notes }) {
        const { ResidentAdvanceAccount, AdvanceTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        // Idempotency check
        if (idempotencyKey) {
            const existing = await AdvanceTransaction.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const account = await ResidentAdvanceAccount.findById(accountId).session(session);
            if (!account) throw new AppError("Advance account not found.", 404);
            assertSociety(req, account);
            if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_CREATE)) {
                assertResidentOwnership(req, account);
            }
            if (account.status === "BLOCKED") throw new AppError("Advance account is blocked. Cannot credit.", 400);
            if (account.status === "CLOSED") throw new AppError("Advance account is closed.", 400);

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Amount must be greater than 0.", 400);

            const newBalance = account.currentBalance + numAmount;
            account.currentBalance = newBalance;
            account.status = newBalance > 0 ? "ACTIVE" : "ZERO_BALANCE";
            account.updatedBy = req.user.id;
            await account.save({ session });

            const txnData = {
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                transactionType,
                direction: "CREDIT",
                amount: numAmount,
                balanceAfterTransaction: newBalance,
                referenceType: referenceType || (referenceNumber ? "OfflinePayment" : null),
                referenceId: referenceId || referenceNumber || null,
                description: description || notes || `Advance credited via ${paymentMode || "BANK_TRANSFER"}`,
                createdBy: req.user.id,
            };
            if (idempotencyKey) txnData.idempotencyKey = idempotencyKey;

            const txn = await AdvanceTransaction.create([txnData], { session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.ADVANCE.CREDIT",
                resource: "ResidentAdvanceAccount",
                resourceId: account._id,
                amount: numAmount,
                details: { transactionType, newBalance, paymentMode, referenceNumber, transactionDate },
            });

            return { account: account.toObject(), transaction: txn[0] };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Initiate Razorpay order for resident advance top-up
     */
    static async initiateAdvanceOnlinePayment(req, { accountId, amount }) {
        const { ResidentAdvanceAccount } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        const account = await ResidentAdvanceAccount.findById(accountId).lean();
        if (!account) throw new AppError("Advance account not found.", 404);
        assertSociety(req, account);
        assertResidentOwnership(req, account);

        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) throw new AppError("Amount must be greater than 0.", 400);

        const receipt = `ADV-${Date.now()}-${String(accountId).slice(-6)}`;
        let razorpayOrder;
        try {
            razorpayOrder = await createRazorpayOrder({
                amount: numAmount,
                receipt,
                notes: {
                    societyId: String(societyId),
                    accountId: String(accountId),
                    flatId: String(account.flatId),
                    userId: String(req.user.id),
                    type: "ADVANCE_TOP_UP",
                },
            });
        } catch (err) {
            console.error("[RAZORPAY ADVANCE ORDER ERROR]", err.message);
            // Fallback for dev/test environments
            razorpayOrder = { id: `order_adv_mock_${Date.now()}` };
        }

        await logBillingAction({
            req,
            action: "BILLING.ADVANCE.INITIATE_ONLINE",
            resource: "ResidentAdvanceAccount",
            resourceId: account._id,
            amount: numAmount,
            details: { gatewayOrderId: razorpayOrder.id, receipt },
        });

        return {
            keyId: process.env.RAZORPAY_KEY_ID || "",
            orderId: razorpayOrder.id,
            accountId: String(accountId),
            amount: numAmount,
            currency: "INR",
            receipt,
        };
    }

    /**
     * Verify Razorpay payment and credit the advance account
     */
    static async verifyAdvanceOnlinePayment(req, { accountId, orderId, razorpay_payment_id, razorpay_signature, amount, notes }) {
        const { ResidentAdvanceAccount, AdvanceTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        // Verify HMAC signature
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (secret && razorpay_signature && orderId && razorpay_payment_id) {
            const expectedSig = crypto
                .createHmac("sha256", secret)
                .update(`${orderId}|${razorpay_payment_id}`)
                .digest("hex");
            if (expectedSig !== razorpay_signature) {
                throw new AppError("Invalid payment gateway signature. Verification failed.", 400);
            }
        }

        // Idempotency: don't double-credit same Razorpay payment
        const idempotencyKey = `razorpay_adv_${razorpay_payment_id || orderId}`;
        const existing = await AdvanceTransaction.findOne({ societyId, idempotencyKey });
        if (existing) {
            const account = await ResidentAdvanceAccount.findById(accountId).lean();
            return { alreadyProcessed: true, account, transaction: existing };
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const account = await ResidentAdvanceAccount.findById(accountId).session(session);
            if (!account) throw new AppError("Advance account not found.", 404);
            assertSociety(req, account);
            assertResidentOwnership(req, account);

            if (account.status === "BLOCKED") throw new AppError("Advance account is blocked.", 400);
            if (account.status === "CLOSED") throw new AppError("Advance account is closed.", 400);

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Amount must be greater than 0.", 400);

            const newBalance = account.currentBalance + numAmount;
            account.currentBalance = newBalance;
            account.status = "ACTIVE";
            account.updatedBy = req.user.id;
            await account.save({ session });

            const [txn] = await AdvanceTransaction.create([{
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                transactionType: "ADVANCE_RECEIVED",
                direction: "CREDIT",
                amount: numAmount,
                balanceAfterTransaction: newBalance,
                referenceType: "RazorpayPayment",
                referenceId: razorpay_payment_id || orderId,
                description: notes || `Online advance top-up via Razorpay. Payment ID: ${razorpay_payment_id}`,
                idempotencyKey,
                createdBy: req.user.id,
            }], { session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.ADVANCE.CREDIT",
                resource: "ResidentAdvanceAccount",
                resourceId: account._id,
                amount: numAmount,
                details: { source: "RAZORPAY", orderId, razorpay_payment_id, newBalance },
            });

            return { account: account.toObject(), transaction: txn };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Allocate advance balance against an invoice
     */
    static async allocateAdvance(req, accountId, { invoiceId, amount, idempotencyKey, description }) {
        const { ResidentAdvanceAccount, AdvanceTransaction, AdvanceAllocation } = getAdvanceDepositModels(req.opsDb);
        const { BillingInvoice } = _getBillingModels(req.opsDb);
        const societyId = req.user.societyId;

        // Idempotency check
        if (idempotencyKey) {
            const existing = await AdvanceAllocation.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const account = await ResidentAdvanceAccount.findById(accountId).session(session);
            if (!account) throw new AppError("Advance account not found.", 404);
            assertSociety(req, account);
            if (account.status === "BLOCKED") throw new AppError("Advance account is blocked.", 400);

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Allocation amount must be greater than 0.", 400);
            if (numAmount > account.currentBalance) {
                throw new AppError(`Allocation amount (₹${numAmount}) exceeds available advance balance (₹${account.currentBalance}).`, 400);
            }

            const invoice = await BillingInvoice.findById(invoiceId).session(session);
            if (!invoice) throw new AppError("Invoice not found.", 404);
            if (String(invoice.societyId) !== String(societyId)) throw new AppError("Invoice belongs to a different society.", 403);
            if (["CANCELLED", "PAID"].includes(invoice.status)) throw new AppError(`Cannot allocate to a ${invoice.status} invoice.`, 400);
            if (String(invoice.flatId) !== String(account.flatId) && String(invoice.userId) !== String(account.residentId)) {
                throw new AppError("Invoice does not belong to the same resident.", 400);
            }

            const invoiceOutstanding = invoice.totalAmount - (invoice.paidAmount || 0) - (invoice.advanceAdjustment || 0);
            if (numAmount > invoiceOutstanding) {
                throw new AppError(`Allocation amount (₹${numAmount}) exceeds invoice outstanding (₹${invoiceOutstanding}).`, 400);
            }

            // Update invoice
            invoice.advanceAdjustment = (invoice.advanceAdjustment || 0) + numAmount;
            invoice.paidAmount = (invoice.paidAmount || 0) + numAmount;
            const newOutstanding = invoice.totalAmount - invoice.paidAmount;
            if (newOutstanding <= 0) {
                invoice.status = "PAID";
            } else {
                invoice.status = "PARTIALLY_PAID";
            }
            await invoice.save({ session });

            // Update advance balance
            const newBalance = account.currentBalance - numAmount;
            account.currentBalance = newBalance;
            account.status = newBalance > 0 ? "ACTIVE" : "ZERO_BALANCE";
            account.updatedBy = req.user.id;
            await account.save({ session });

            // Create allocation record
            const [allocation] = await AdvanceAllocation.create([{
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                invoiceId,
                amount: numAmount,
                allocationDate: new Date(),
                status: "ACTIVE",
                idempotencyKey: idempotencyKey || null,
                createdBy: req.user.id,
            }], { session });

            // Create advance transaction
            await AdvanceTransaction.create([{
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                transactionType: "INVOICE_ALLOCATION",
                direction: "DEBIT",
                amount: numAmount,
                balanceAfterTransaction: newBalance,
                referenceType: "Invoice",
                referenceId: String(invoiceId),
                description: description || `Advance allocated to invoice ${invoice.invoiceNumber}`,
                idempotencyKey: idempotencyKey ? `${idempotencyKey}_txn` : null,
                createdBy: req.user.id,
            }], { session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.ADVANCE.ALLOCATE",
                resource: "AdvanceAllocation",
                resourceId: allocation._id,
                amount: numAmount,
                details: { invoiceId, newBalance, invoiceStatus: invoice.status },
            });

            return { allocation, account: account.toObject(), invoice: invoice.toObject() };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Reverse an allocation
     */
    static async reverseAllocation(req, allocationId, { reason }) {
        const { ResidentAdvanceAccount, AdvanceTransaction, AdvanceAllocation } = getAdvanceDepositModels(req.opsDb);
        const { BillingInvoice } = _getBillingModels(req.opsDb);
        const societyId = req.user.societyId;

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const allocation = await AdvanceAllocation.findById(allocationId).session(session);
            if (!allocation) throw new AppError("Allocation not found.", 404);
            if (String(allocation.societyId) !== String(societyId)) throw new AppError("Access denied.", 403);
            if (allocation.status === "REVERSED") throw new AppError("Allocation is already reversed.", 400);

            const account = await ResidentAdvanceAccount.findById(allocation.advanceAccountId).session(session);
            if (!account) throw new AppError("Advance account not found.", 404);

            // Restore advance balance
            const newBalance = account.currentBalance + allocation.amount;
            account.currentBalance = newBalance;
            account.status = newBalance > 0 ? "ACTIVE" : "ZERO_BALANCE";
            account.updatedBy = req.user.id;
            await account.save({ session });

            // Reverse invoice adjustment
            const invoice = await BillingInvoice.findById(allocation.invoiceId).session(session);
            if (invoice && String(invoice.societyId) === String(societyId)) {
                invoice.advanceAdjustment = Math.max(0, (invoice.advanceAdjustment || 0) - allocation.amount);
                invoice.paidAmount = Math.max(0, (invoice.paidAmount || 0) - allocation.amount);
                const outstanding = invoice.totalAmount - invoice.paidAmount;
                if (outstanding <= 0) invoice.status = "PAID";
                else if (invoice.paidAmount > 0) invoice.status = "PARTIALLY_PAID";
                else invoice.status = "GENERATED";
                await invoice.save({ session });
            }

            // Create reversal transaction
            const [reversalTxn] = await AdvanceTransaction.create([{
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                transactionType: "REVERSAL",
                direction: "CREDIT",
                amount: allocation.amount,
                balanceAfterTransaction: newBalance,
                referenceType: "AdvanceAllocation",
                referenceId: String(allocationId),
                description: `Reversal of allocation. Reason: ${reason}`,
                createdBy: req.user.id,
            }], { session });

            // Mark allocation reversed
            allocation.status = "REVERSED";
            allocation.reversedBy = req.user.id;
            allocation.reversedAt = new Date();
            allocation.reversalReason = reason;
            allocation.reversalTransactionId = reversalTxn._id;
            await allocation.save({ session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.ADVANCE.REVERSE_ALLOCATION",
                resource: "AdvanceAllocation",
                resourceId: allocationId,
                amount: allocation.amount,
                details: { reason, newBalance },
            });

            return { allocation: allocation.toObject(), account: account.toObject() };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    /**
     * Refund unused advance balance back to resident
     */
    static async refundAdvance(req, accountId, { amount, reason, paymentMethod, referenceNumber, idempotencyKey }) {
        const { ResidentAdvanceAccount, AdvanceTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        if (idempotencyKey) {
            const existing = await AdvanceTransaction.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const account = await ResidentAdvanceAccount.findById(accountId).session(session);
            if (!account) throw new AppError("Advance account not found.", 404);
            assertSociety(req, account);

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Refund amount must be greater than 0.", 400);
            if (numAmount > account.currentBalance) {
                throw new AppError(`Refund amount (₹${numAmount}) exceeds available advance balance (₹${account.currentBalance}).`, 400);
            }

            const newBalance = account.currentBalance - numAmount;
            account.currentBalance = newBalance;
            account.status = newBalance > 0 ? "ACTIVE" : "ZERO_BALANCE";
            account.updatedBy = req.user.id;
            await account.save({ session });

            const [txn] = await AdvanceTransaction.create([{
                societyId,
                advanceAccountId: account._id,
                residentId: account.residentId,
                flatId: account.flatId,
                transactionType: "ADVANCE_REFUND",
                direction: "DEBIT",
                amount: numAmount,
                balanceAfterTransaction: newBalance,
                referenceType: "AdvanceRefund",
                referenceId: referenceNumber || null,
                description: `Advance refund. Reason: ${reason || "N/A"}. Method: ${paymentMethod || "N/A"}`,
                idempotencyKey: idempotencyKey || null,
                createdBy: req.user.id,
            }], { session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.ADVANCE.REFUND",
                resource: "ResidentAdvanceAccount",
                resourceId: account._id,
                amount: numAmount,
                details: { reason, paymentMethod, newBalance },
            });

            return { transaction: txn, account: account.toObject() };
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    static async getAccountStatement(req, accountId) {
        const { ResidentAdvanceAccount, AdvanceTransaction } = getAdvanceDepositModels(req.opsDb);
        const { page, limit, skip } = getPagination(req.query);

        const account = await ResidentAdvanceAccount.findById(accountId)
            .populate("residentId", "name email")
            .populate("flatId", "flatNumber blockId")
            .lean();
        if (!account) throw new AppError("Account not found.", 404);
        assertSociety(req, account);
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL)) {
            assertResidentOwnership(req, account);
        }

        const filter = { advanceAccountId: new mongoose.Types.ObjectId(accountId), societyId: account.societyId };
        if (req.query.startDate) filter.createdAt = { $gte: new Date(req.query.startDate) };
        if (req.query.endDate)   filter.createdAt = { ...filter.createdAt, $lte: new Date(req.query.endDate) };

        const [transactions, total] = await Promise.all([
            AdvanceTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            AdvanceTransaction.countDocuments(filter),
        ]);

        // Aggregate totals
        const agg = await AdvanceTransaction.aggregate([
            { $match: filter },
            { $group: {
                _id: "$direction",
                total: { $sum: "$amount" },
            }},
        ]);
        const credits = agg.find(a => a._id === "CREDIT")?.total || 0;
        const debits  = agg.find(a => a._id === "DEBIT")?.total  || 0;

        return {
            account,
            summary: {
                openingBalance: account.openingBalance,
                totalCredits: credits,
                totalDebits: debits,
                currentBalance: account.currentBalance,
            },
            transactions,
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    static async listAllocations(req) {
        const { AdvanceAllocation } = getAdvanceDepositModels(req.opsDb);
        _getBillingModels(req.opsDb); // Ensure BillingInvoice is registered for population
        const societyId = req.user.societyId;
        const { page, limit, skip } = getPagination(req.query);

        const filter = { societyId };
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL)) {
            filter.residentId = new mongoose.Types.ObjectId(req.user.id);
        } else {
            if (req.query.status) filter.status = req.query.status;
            if (req.query.advanceAccountId) filter.advanceAccountId = new mongoose.Types.ObjectId(req.query.advanceAccountId);
            if (req.query.invoiceId) filter.invoiceId = new mongoose.Types.ObjectId(req.query.invoiceId);
            if (req.query.residentId) filter.residentId = new mongoose.Types.ObjectId(req.query.residentId);
        }

        const [allocations, total] = await Promise.all([
            AdvanceAllocation.find(filter)
                .populate("residentId", "name email")
                .populate("flatId", "flatNumber")
                .populate("invoiceId", "invoiceNumber totalAmount paidAmount status billingPeriod")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AdvanceAllocation.countDocuments(filter),
        ]);

        return { allocations, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getOverviewStats(req) {
        const { ResidentAdvanceAccount, AdvanceTransaction, SecurityDeposit, DepositRefundRequest } = getAdvanceDepositModels(req.opsDb);
        const societyId = new mongoose.Types.ObjectId(req.user.societyId);

        const isResident = isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL);
        if (isResident) {
            const residentObjectId = new mongoose.Types.ObjectId(req.user.id);
            const [myAccount, myDeposits, myRefundRequests] = await Promise.all([
                ResidentAdvanceAccount.findOne({ societyId, residentId: residentObjectId, status: { $in: ["ACTIVE", "ZERO_BALANCE"] } }).lean(),
                SecurityDeposit.aggregate([
                    { $match: { societyId, residentId: residentObjectId, status: { $in: ["ACTIVE", "PARTIALLY_ADJUSTED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] } } },
                    { $group: {
                        _id: null,
                        totalHeld: { $sum: "$originalAmount" },
                        refundableBalance: { $sum: "$refundableBalance" },
                        count: { $sum: 1 },
                    }},
                ]),
                DepositRefundRequest.countDocuments({ societyId, residentId: residentObjectId, status: { $in: ["REQUESTED", "UNDER_REVIEW", "APPROVED"] } }),
            ]);

            return {
                advance: {
                    totalBalance: myAccount?.currentBalance || 0,
                    totalAccounts: myAccount ? 1 : 0,
                    residentsWithAdvance: myAccount && myAccount.currentBalance > 0 ? 1 : 0,
                    advanceUsedThisPeriod: 0,
                    advanceReceivedThisPeriod: 0,
                },
                securityDeposit: {
                    totalHeld: myDeposits[0]?.totalHeld || 0,
                    activeDeposits: myDeposits[0]?.count || 0,
                    refundableBalance: myDeposits[0]?.refundableBalance || 0,
                    refundsPending: myRefundRequests,
                },
                isResidentView: true,
            };
        }

        const now = new Date();
        const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

        const [advanceStats, sdStats, advancePeriodStats, refundPendingCount] = await Promise.all([
            ResidentAdvanceAccount.aggregate([
                { $match: { societyId, status: { $in: ["ACTIVE", "ZERO_BALANCE"] } } },
                { $group: {
                    _id: null,
                    totalBalance: { $sum: "$currentBalance" },
                    count: { $sum: 1 },
                    withBalance: { $sum: { $cond: [{ $gt: ["$currentBalance", 0] }, 1, 0] } },
                }},
            ]),
            SecurityDeposit.aggregate([
                { $match: { societyId, status: { $in: ["ACTIVE", "PARTIALLY_ADJUSTED", "REFUND_PENDING", "PARTIALLY_REFUNDED"] } } },
                { $group: {
                    _id: null,
                    totalHeld: { $sum: "$originalAmount" },
                    refundableBalance: { $sum: "$refundableBalance" },
                    count: { $sum: 1 },
                }},
            ]),
            AdvanceTransaction.aggregate([
                { $match: { societyId, createdAt: { $gte: periodStart } } },
                { $group: {
                    _id: "$transactionType",
                    total: { $sum: "$amount" },
                }},
            ]),
            DepositRefundRequest.countDocuments({ societyId, status: { $in: ["REQUESTED", "UNDER_REVIEW", "APPROVED"] } }),
        ]);

        const advReceived = advancePeriodStats.find(s => s._id === "ADVANCE_RECEIVED")?.total || 0;
        const advUsed     = advancePeriodStats.find(s => s._id === "INVOICE_ALLOCATION")?.total || 0;

        return {
            advance: {
                totalBalance: advanceStats[0]?.totalBalance || 0,
                totalAccounts: advanceStats[0]?.count || 0,
                residentsWithAdvance: advanceStats[0]?.withBalance || 0,
                advanceUsedThisPeriod: advUsed,
                advanceReceivedThisPeriod: advReceived,
            },
            securityDeposit: {
                totalHeld: sdStats[0]?.totalHeld || 0,
                activeDeposits: sdStats[0]?.count || 0,
                refundableBalance: sdStats[0]?.refundableBalance || 0,
                refundsPending: refundPendingCount,
            },
        };
    }
}

// ─── SECURITY DEPOSITS ───────────────────────────────────────────────────────
class SecurityDepositService {

    static async listDepositTypes(req) {
        const { SecurityDepositType } = getAdvanceDepositModels(req.opsDb);
        const filter = { societyId: req.user.societyId };
        if (req.query.status) filter.status = req.query.status;
        return SecurityDepositType.find(filter).sort({ name: 1 }).lean();
    }

    static async createDepositType(req, data) {
        const { SecurityDepositType } = getAdvanceDepositModels(req.opsDb);
        const { name, description, defaultAmount, refundable, approvalRequired } = data;
        if (!name?.trim()) throw new AppError("Deposit type name is required.", 400);

        const existing = await SecurityDepositType.findOne({ societyId: req.user.societyId, name: name.trim() });
        if (existing) throw new AppError(`Deposit type '${name}' already exists.`, 409);

        const dt = await SecurityDepositType.create({
            societyId: req.user.societyId,
            name: name.trim(),
            description: description || "",
            defaultAmount: Number(defaultAmount) || 0,
            refundable: refundable !== false,
            approvalRequired: !!approvalRequired,
            createdBy: req.user.id,
        });

        await logBillingAction({ req, action: "BILLING.DEPOSIT.CONFIGURE", resource: "SecurityDepositType", resourceId: dt._id });
        return dt;
    }

    static async updateDepositType(req, typeId, data) {
        const { SecurityDepositType } = getAdvanceDepositModels(req.opsDb);
        const dt = await SecurityDepositType.findById(typeId);
        if (!dt) throw new AppError("Deposit type not found.", 404);
        if (String(dt.societyId) !== String(req.user.societyId)) throw new AppError("Access denied.", 403);

        const allowed = ["name", "description", "defaultAmount", "refundable", "approvalRequired", "status"];
        allowed.forEach(f => { if (data[f] !== undefined) dt[f] = data[f]; });
        dt.updatedBy = req.user.id;
        await dt.save();
        return dt;
    }

    static async listDeposits(req) {
        const { SecurityDeposit } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;
        const { page, limit, skip } = getPagination(req.query);
        const { status, flatId, residentId, depositTypeId } = req.query;

        const filter = { societyId };
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL)) {
            filter.residentId = new mongoose.Types.ObjectId(req.user.id);
        } else {
            if (status) filter.status = status;
            if (flatId) filter.flatId = new mongoose.Types.ObjectId(flatId);
            if (residentId) filter.residentId = new mongoose.Types.ObjectId(residentId);
            if (depositTypeId) filter.depositTypeId = new mongoose.Types.ObjectId(depositTypeId);
        }

        const [deposits, total] = await Promise.all([
            SecurityDeposit.find(filter)
                .populate("residentId", "name email phone")
                .populate("flatId", "flatNumber blockId")
                .populate("depositTypeId", "name refundable")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SecurityDeposit.countDocuments(filter),
        ]);

        return { deposits, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getMyDeposits(req) {
        const { SecurityDeposit } = getAdvanceDepositModels(req.opsDb);
        return SecurityDeposit.find({
            societyId: req.user.societyId,
            residentId: req.user.id,
            status: { $nin: ["CANCELLED"] },
        })
            .populate("depositTypeId", "name refundable")
            .populate("flatId", "flatNumber blockId")
            .sort({ createdAt: -1 })
            .lean();
    }

    static async getDepositById(req, depositId) {
        const { SecurityDeposit } = getAdvanceDepositModels(req.opsDb);
        const deposit = await SecurityDeposit.findById(depositId)
            .populate("residentId", "name email phone")
            .populate("flatId", "flatNumber blockId")
            .populate("depositTypeId", "name refundable defaultAmount")
            .lean();
        if (!deposit) throw new AppError("Security deposit not found.", 404);
        assertSociety(req, deposit);
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL)) {
            assertResidentOwnership(req, deposit);
        }
        return deposit;
    }

    static async collectDeposit(req, data) {
        const { SecurityDeposit, SecurityDepositTransaction, SecurityDepositType } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;
        const { residentId, flatId, depositTypeId, depositTypeName, amount, paymentMode, paymentMethod, paymentAccountId, paymentAccountName, reference, referenceNumber, receivedDate, notes, idempotencyKey } = data;

        if (idempotencyKey) {
            const existing = await SecurityDeposit.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        // Resolve residentId if missing
        let targetResidentId = residentId;
        if (!targetResidentId && flatId) {
            const Flat = req.opsDb.model("Flat");
            const flat = await Flat.findById(flatId).lean();
            if (flat) {
                targetResidentId = flat.activeTenant || flat.primaryOwner || null;
            }

            if (!targetResidentId) {
                const Resident = req.opsDb.model("Resident");
                const residentDoc = await Resident.findOne({
                    societyId,
                    flatId: new mongoose.Types.ObjectId(flatId),
                    isActive: true,
                }).lean();
                if (residentDoc) {
                    targetResidentId = residentDoc.userId || residentDoc.residentId || residentDoc._id;
                }
            }
        }
        if (!targetResidentId) {
            targetResidentId = req.user.id;
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            let depositType = null;
            let typeName = depositTypeName || "Security Deposit";
            let isRefundable = true;

            if (depositTypeId) {
                depositType = await SecurityDepositType.findById(depositTypeId).session(session);
                if (depositType) {
                    if (String(depositType.societyId) !== String(societyId)) throw new AppError("Deposit type access denied.", 403);
                    typeName = depositType.name;
                    isRefundable = depositType.refundable;
                }
            }

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Amount must be greater than 0.", 400);

            const depositPayload = {
                societyId,
                residentId: targetResidentId,
                flatId,
                depositTypeId: depositType ? depositType._id : null,
                depositTypeName: typeName,
                originalAmount: numAmount,
                collectedAmount: numAmount,
                adjustedAmount: 0,
                refundedAmount: 0,
                refundableBalance: isRefundable ? numAmount : 0,
                receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
                refundable: isRefundable,
                reference: reference || referenceNumber || null,
                paymentMethod: paymentMethod || paymentMode || "BANK_TRANSFER",
                paymentAccountId: paymentAccountId || null,
                paymentAccountName: paymentAccountName || null,
                notes: notes || "",
                status: "ACTIVE",
                createdBy: req.user.id,
            };
            if (idempotencyKey) {
                depositPayload.idempotencyKey = idempotencyKey;
            }

            const [deposit] = await SecurityDeposit.create([depositPayload], { session });

            const txnPayload = {
                societyId,
                securityDepositId: deposit._id,
                residentId: targetResidentId,
                flatId,
                transactionType: "DEPOSIT_COLLECTED",
                direction: "CREDIT",
                amount: numAmount,
                balanceAfterTransaction: deposit.refundableBalance,
                reference: reference || referenceNumber || null,
                notes: notes || `Security deposit collected. Type: ${typeName}`,
                createdBy: req.user.id,
            };

            await SecurityDepositTransaction.create([txnPayload], { session });

            await logBillingAction({
                req,
                action: "BILLING.DEPOSIT.CREATE",
                resource: "SecurityDeposit",
                resourceId: deposit._id,
                amount: numAmount,
                details: { depositType: typeName, paymentMethod: paymentMethod || paymentMode || "BANK_TRANSFER" },
            });

            await session.commitTransaction();
            return deposit;
        } catch (err) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            throw err;
        } finally {
            session.endSession();
        }
    }

    static async adjustDeposit(req, depositId, { amount, reason, referenceId, idempotencyKey }) {
        const { SecurityDeposit, SecurityDepositTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        if (!reason?.trim()) throw new AppError("Adjustment reason is required.", 400);

        if (idempotencyKey) {
            const existing = await SecurityDepositTransaction.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const deposit = await SecurityDeposit.findById(depositId).session(session);
            if (!deposit) throw new AppError("Security deposit not found.", 404);
            assertSociety(req, deposit);
            if (!["ACTIVE", "PARTIALLY_ADJUSTED", "REFUND_PENDING", "PARTIALLY_REFUNDED"].includes(deposit.status)) {
                throw new AppError(`Cannot adjust a deposit with status ${deposit.status}.`, 400);
            }

            const numAmount = Number(amount);
            if (!numAmount || numAmount <= 0) throw new AppError("Adjustment amount must be greater than 0.", 400);
            if (numAmount > deposit.refundableBalance) {
                throw new AppError(`Adjustment amount (₹${numAmount}) exceeds refundable balance (₹${deposit.refundableBalance}).`, 400);
            }

            deposit.adjustedAmount = (deposit.adjustedAmount || 0) + numAmount;
            deposit.refundableBalance = deposit.originalAmount - deposit.adjustedAmount - deposit.refundedAmount;
            
            if (deposit.refundableBalance <= 0) {
                deposit.status = "REFUNDED";
            } else if (deposit.status !== "REFUND_PENDING" && deposit.status !== "PARTIALLY_REFUNDED") {
                deposit.status = "PARTIALLY_ADJUSTED";
            }
            deposit.updatedBy = req.user.id;
            await deposit.save({ session });

            await SecurityDepositTransaction.create([{
                societyId,
                securityDepositId: deposit._id,
                residentId: deposit.residentId,
                flatId: deposit.flatId,
                transactionType: "DEPOSIT_ADJUSTED",
                direction: "DEBIT",
                amount: numAmount,
                reason,
                description: `Deposit adjusted. Reason: ${reason}`,
                referenceType: referenceId ? "Invoice" : null,
                referenceId: referenceId || null,
                idempotencyKey: idempotencyKey || null,
                createdBy: req.user.id,
            }], { session });

            await session.commitTransaction();

            await logBillingAction({
                req,
                action: "BILLING.DEPOSIT.ADJUST",
                resource: "SecurityDeposit",
                resourceId: deposit._id,
                amount: numAmount,
                details: { reason, newRefundableBalance: deposit.refundableBalance },
            });

            return deposit.toObject();
        } catch (err) {
            await session.abortTransaction();
            throw err;
        } finally {
            session.endSession();
        }
    }

    static async requestRefund(req, depositId, data) {
        const { SecurityDeposit, DepositRefundRequest } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;
        const { requestedAmount, reason, paymentMethod, refundAccountId, refundAccountName, bankDetails, upiId, idempotencyKey } = data;

        if (!reason?.trim()) throw new AppError("Refund reason is required.", 400);

        if (idempotencyKey) {
            const existing = await DepositRefundRequest.findOne({ societyId, idempotencyKey });
            if (existing) return existing;
        }

        const deposit = await SecurityDeposit.findById(depositId).lean();
        if (!deposit) throw new AppError("Security deposit not found.", 404);
        assertSociety(req, deposit);

        if (!deposit.refundable) throw new AppError("This deposit is non-refundable.", 400);
        if (!["ACTIVE", "PARTIALLY_ADJUSTED", "PARTIALLY_REFUNDED"].includes(deposit.status)) {
            throw new AppError(`Cannot request refund for deposit with status ${deposit.status}.`, 400);
        }

        const numAmount = Number(requestedAmount);
        if (!numAmount || numAmount <= 0) throw new AppError("Requested amount must be greater than 0.", 400);
        if (numAmount > deposit.refundableBalance) {
            throw new AppError(`Requested amount (₹${numAmount}) exceeds refundable balance (₹${deposit.refundableBalance}).`, 400);
        }

        // Check no duplicate pending refund
        const pendingRefund = await DepositRefundRequest.findOne({
            societyId,
            securityDepositId: deposit._id,
            status: { $in: ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"] },
        });
        if (pendingRefund) throw new AppError("A refund request is already pending for this deposit.", 409);

        const refundRequest = await DepositRefundRequest.create({
            societyId,
            securityDepositId: deposit._id,
            residentId: deposit.residentId,
            flatId: deposit.flatId,
            requestedAmount: numAmount,
            approvedAmount: null,
            deductionAmount: 0,
            reason,
            paymentMethod: paymentMethod || "BANK_TRANSFER",
            refundAccountId: refundAccountId || null,
            refundAccountName: refundAccountName || null,
            bankDetails: bankDetails || {},
            upiId: upiId || null,
            status: "REQUESTED",
            idempotencyKey: idempotencyKey || null,
            requestedBy: req.user.id,
        });

        // Update deposit status
        await SecurityDeposit.findByIdAndUpdate(depositId, { status: "REFUND_PENDING", updatedBy: req.user.id });

        await logBillingAction({
            req,
            action: "BILLING.DEPOSIT.REFUND_REQUEST",
            resource: "DepositRefundRequest",
            resourceId: refundRequest._id,
            amount: numAmount,
        });

        return refundRequest;
    }

    static async approveRefund(req, refundRequestId, { approvedAmount, notes }) {
        const { DepositRefundRequest } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        const refundReq = await DepositRefundRequest.findById(refundRequestId);
        if (!refundReq) throw new AppError("Refund request not found.", 404);
        if (String(refundReq.societyId) !== String(societyId)) throw new AppError("Access denied.", 403);
        if (String(refundReq.requestedBy) === String(req.user.id)) {
            throw new AppError("Access denied. Resident cannot approve their own refund request.", 403);
        }
        if (!["REQUESTED", "UNDER_REVIEW"].includes(refundReq.status)) {
            throw new AppError(`Cannot approve refund in status ${refundReq.status}.`, 400);
        }

        const numApproved = Number(approvedAmount) || refundReq.requestedAmount;
        if (numApproved > refundReq.requestedAmount) throw new AppError("Approved amount cannot exceed requested amount.", 400);

        refundReq.status = "APPROVED";
        refundReq.approvedAmount = numApproved;
        refundReq.approvedBy = req.user.id;
        refundReq.approvedAt = new Date();
        if (notes) refundReq.notes = notes;
        await refundReq.save();

        await logBillingAction({ req, action: "BILLING.DEPOSIT.APPROVE_REFUND", resource: "DepositRefundRequest", resourceId: refundRequestId, amount: numApproved });
        return refundReq;
    }

    static async rejectRefund(req, refundRequestId, { reason }) {
        const { DepositRefundRequest, SecurityDeposit } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        const refundReq = await DepositRefundRequest.findById(refundRequestId);
        if (!refundReq) throw new AppError("Refund request not found.", 404);
        if (String(refundReq.societyId) !== String(societyId)) throw new AppError("Access denied.", 403);
        if (!["REQUESTED", "UNDER_REVIEW", "APPROVED"].includes(refundReq.status)) {
            throw new AppError(`Cannot reject refund in status ${refundReq.status}.`, 400);
        }

        refundReq.status = "REJECTED";
        refundReq.rejectedBy = req.user.id;
        refundReq.rejectedAt = new Date();
        refundReq.rejectionReason = reason;
        await refundReq.save();

        // Revert deposit status
        const deposit = await SecurityDeposit.findById(refundReq.securityDepositId);
        if (deposit && deposit.status === "REFUND_PENDING") {
            deposit.status = deposit.adjustedAmount > 0 ? "PARTIALLY_ADJUSTED" : "ACTIVE";
            deposit.updatedBy = req.user.id;
            await deposit.save();
        }

        await logBillingAction({ req, action: "BILLING.DEPOSIT.REJECT_REFUND", resource: "DepositRefundRequest", resourceId: refundRequestId, details: { reason } });
        return refundReq;
    }

    static async processRefund(req, refundRequestId, { referenceNumber, notes, idempotencyKey }) {
        const { DepositRefundRequest, SecurityDeposit, SecurityDepositTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;

        const session = await req.opsDb.startSession();
        session.startTransaction();
        try {
            const refundReq = await DepositRefundRequest.findById(refundRequestId).session(session);
            if (!refundReq) throw new AppError("Refund request not found.", 404);
            if (String(refundReq.societyId) !== String(societyId)) throw new AppError("Access denied.", 403);
            if (String(refundReq.requestedBy) === String(req.user.id)) {
                throw new AppError("Access denied. Resident cannot process their own refund request.", 403);
            }
            if (refundReq.status !== "APPROVED") throw new AppError("Refund must be approved before processing.", 400);

            // Idempotency
            if (idempotencyKey && refundReq.idempotencyKey === idempotencyKey && refundReq.status === "COMPLETED") {
                await session.abortTransaction();
                return refundReq;
            }

            const processAmount = refundReq.approvedAmount;

            const deposit = await SecurityDeposit.findById(refundReq.securityDepositId).session(session);
            if (!deposit) throw new AppError("Security deposit not found.", 404);
            if (processAmount > deposit.refundableBalance) {
                throw new AppError(`Process amount exceeds refundable balance.`, 400);
            }

            // Update deposit
            deposit.refundedAmount = (deposit.refundedAmount || 0) + processAmount;
            deposit.refundableBalance = deposit.originalAmount - deposit.adjustedAmount - deposit.refundedAmount;
            if (deposit.refundableBalance <= 0) {
                deposit.status = "REFUNDED";
            } else {
                deposit.status = "PARTIALLY_REFUNDED";
            }
            deposit.updatedBy = req.user.id;
            await deposit.save({ session });

            // Create transaction
            await SecurityDepositTransaction.create([{
                societyId,
                securityDepositId: deposit._id,
                residentId: deposit.residentId,
                flatId: deposit.flatId,
                transactionType: "DEPOSIT_REFUNDED",
                direction: "DEBIT",
                amount: processAmount,
                referenceType: "DepositRefundRequest",
                referenceId: String(refundRequestId),
                description: `Deposit refunded. Reference: ${referenceNumber || "N/A"}`,
                idempotencyKey: idempotencyKey || null,
                createdBy: req.user.id,
            }], { session });

            // Mark refund completed
            refundReq.status = "COMPLETED";
            refundReq.processedBy = req.user.id;
            refundReq.processedAt = new Date();
            refundReq.referenceNumber = referenceNumber || null;
            if (notes) refundReq.notes = notes;
            await refundReq.save({ session });

            await logBillingAction({
                req,
                action: "BILLING.DEPOSIT.PROCESS_REFUND",
                resource: "DepositRefundRequest",
                resourceId: refundRequestId,
                amount: processAmount,
                details: { referenceNumber, newRefundableBalance: deposit.refundableBalance },
            });

            await session.commitTransaction();

            return { refundRequest: refundReq.toObject(), deposit: deposit.toObject() };
        } catch (err) {
            if (session.inTransaction()) {
                await session.abortTransaction();
            }
            throw err;
        } finally {
            session.endSession();
        }
    }

    static async listRefundRequests(req) {
        const { DepositRefundRequest } = getAdvanceDepositModels(req.opsDb);
        const societyId = req.user.societyId;
        const { page, limit, skip } = getPagination(req.query);
        const { status } = req.query;

        const filter = { societyId };
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL)) {
            filter.residentId = new mongoose.Types.ObjectId(req.user.id);
        } else {
            if (status) filter.status = status;
        }

        const [refunds, total] = await Promise.all([
            DepositRefundRequest.find(filter)
                .populate("residentId", "name email")
                .populate("flatId", "flatNumber")
                .populate("securityDepositId", "originalAmount depositTypeName status")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            DepositRefundRequest.countDocuments(filter),
        ]);

        return { refunds, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getDepositStatement(req, depositId) {
        const { SecurityDeposit, SecurityDepositTransaction } = getAdvanceDepositModels(req.opsDb);
        const { page, limit, skip } = getPagination(req.query);

        const deposit = await SecurityDeposit.findById(depositId)
            .populate("residentId", "name email")
            .populate("flatId", "flatNumber blockId")
            .populate("depositTypeId", "name refundable")
            .lean();
        if (!deposit) throw new AppError("Security deposit not found.", 404);
        assertSociety(req, deposit);
        if (isResidentScope(req, BILLING_PERMISSIONS.BILLING_DEPOSIT_VIEW_ALL)) {
            assertResidentOwnership(req, deposit);
        }

        const [transactions, total] = await Promise.all([
            SecurityDepositTransaction.find({ securityDepositId: new mongoose.Types.ObjectId(depositId) })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SecurityDepositTransaction.countDocuments({ securityDepositId: new mongoose.Types.ObjectId(depositId) }),
        ]);

        return {
            deposit,
            calculation: {
                originalDeposit: deposit.originalAmount,
                totalAdjustments: deposit.adjustedAmount,
                totalRefunded: deposit.refundedAmount,
                refundableBalance: deposit.refundableBalance,
            },
            transactions,
            meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        };
    }

    static async listAllTransactions(req) {
        const { AdvanceTransaction, SecurityDepositTransaction } = getAdvanceDepositModels(req.opsDb);
        const societyId = new mongoose.Types.ObjectId(req.user.societyId);
        const { page, limit, skip } = getPagination(req.query);
        const { type } = req.query; // 'advance' | 'deposit' | 'all' | empty

        const isResident = isResidentScope(req, BILLING_PERMISSIONS.BILLING_ADVANCE_VIEW_ALL);
        const residentObjId = isResident ? new mongoose.Types.ObjectId(req.user.id) : null;

        // Normalize: empty string, missing, or 'all' means both sources
        const normalizedType = (!type || type === "all") ? null : type;

        let results = [];
        let total = 0;

        if (!normalizedType || normalizedType === "advance") {
            const advFilter = { societyId };
            if (residentObjId) advFilter.residentId = residentObjId;

            const [txns, count] = await Promise.all([
                AdvanceTransaction.find(advFilter)
                    .populate("residentId", "name")
                    .populate("flatId", "flatNumber")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                AdvanceTransaction.countDocuments(advFilter),
            ]);
            results = txns.map(t => ({ ...t, _source: "advance" }));
            total = count;
        }

        if (!normalizedType || normalizedType === "deposit") {
            const depFilter = { societyId };
            if (residentObjId) depFilter.residentId = residentObjId;

            const [txns, count] = await Promise.all([
                SecurityDepositTransaction.find(depFilter)
                    .populate("residentId", "name")
                    .populate("flatId", "flatNumber")
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .lean(),
                SecurityDepositTransaction.countDocuments(depFilter),
            ]);
            results = [...results, ...txns.map(t => ({ ...t, _source: "deposit" }))];
            total += count;
        }

        results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return { transactions: results.slice(0, limit), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }

    static async getAuditLogs(req) {
        const { getBillingAuditModel } = require("../../services/billingAudit.service");
        const AuditModel = getBillingAuditModel(req.opsDb);
        const societyId = req.user.societyId;
        const { page, limit, skip } = getPagination(req.query);

        const filter = {
            societyId: new mongoose.Types.ObjectId(societyId),
            action: { $regex: "^BILLING\\.(ADVANCE|DEPOSIT)", $options: "i" },
        };

        const [logs, total] = await Promise.all([
            AuditModel.find(filter)
                .populate("userId", "name email")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuditModel.countDocuments(filter),
        ]);

        return { logs, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    }
}

// Helper to get billing invoice model
function _getBillingModels(db) {
    const { getBillingModels } = require("../billing/billing.model");
    return getBillingModels(db);
}

module.exports = { AdvanceAccountsService, SecurityDepositService };
