"use strict";

const crypto = require("crypto");
const https = require("https");
const { getPaymentModels } = require("./payment.model");
const { getBillingModels } = require("../billing/billing.model");
const { getBillingAuditModel, logBillingAction } = require("../../services/billingAudit.service");
const { generateAutomaticPosting } = require("../ledger/ledger.service");

// Helper: Convert number to English currency words
function numberToWords(amount) {
    if (!amount || amount <= 0) return "Zero Rupees Only";
    const num = Math.floor(amount);
    const a = [
        "", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ",
        "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "
    ];
    const b = ["", "", "Twenty ", "Thirty ", "Forty ", "Fifty ", "Sixty ", "Seventy ", "Eighty ", "Ninety "];

    function inWords(n) {
        if ((n = n.toString()).length > 9) return "overflow";
        let n_arr = ("000000000" + n).substr(-9).match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
        if (!n_arr) return "";
        let str = "";
        str += n_arr[1] != 0 ? (a[Number(n_arr[1])] || b[n_arr[1][0]] + a[n_arr[1][1]]) + "Crore " : "";
        str += n_arr[2] != 0 ? (a[Number(n_arr[2])] || b[n_arr[2][0]] + a[n_arr[2][1]]) + "Lakh " : "";
        str += n_arr[3] != 0 ? (a[Number(n_arr[3])] || b[n_arr[3][0]] + a[n_arr[3][1]]) + "Thousand " : "";
        str += n_arr[4] != 0 ? (a[Number(n_arr[4])] || b[n_arr[4][0]] + a[n_arr[4][1]]) + "Hundred " : "";
        str += n_arr[5] != 0 ? ((str != "") ? "and " : "") + (a[Number(n_arr[5])] || b[n_arr[5][0]] + a[n_arr[5][1]]) : "";
        return str;
    }
    return inWords(num).trim() + " Rupees Only";
}

// Helper: Razorpay HTTPS API caller
async function createRazorpayOrder({ amount, receipt, notes }) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
        throw new Error("Razorpay credentials missing.");
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const postData = JSON.stringify({
        amount: Math.round(amount * 100), // convert to paise
        currency: "INR",
        receipt: receipt,
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
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new Error(parsed.error?.description || "Razorpay API order creation failed."));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on("error", (e) => reject(e));
        req.write(postData);
        req.end();
    });
}

// Helper: Receipt & Payment Number Generators
async function generateUniquePaymentNumber(db, societyId) {
    const { Payment } = getPaymentModels(db);
    const count = await Payment.countDocuments({ societyId });
    const year = new Date().getFullYear();
    const seq = String(count + 1).padStart(5, "0");
    return `PAY-${year}-${seq}`;
}

async function generateUniqueReceiptNumber(db, societyId) {
    const { Receipt } = getPaymentModels(db);
    const count = await Receipt.countDocuments({ societyId });
    const year = new Date().getFullYear();
    const nextYear = String(year + 1).slice(-2);
    const seq = String(count + 1).padStart(6, "0");
    return `REC/${year}-${nextYear}/${seq}`;
}

class PaymentService {
    // ── 1. Initiate Online Payment ──
    static async initiateOnlinePayment({ req, db, societyId, userId, invoiceId, amount, paymentMode = "UPI" }) {
        const { Payment } = getPaymentModels(db);
        const { BillingInvoice } = getBillingModels(db);

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId });
        if (!invoice) {
            throw new Error("Invoice not found.");
        }

        if (invoice.status === "CANCELLED") {
            throw new Error("Cannot pay a cancelled invoice.");
        }

        const totalPayable = (invoice.totalAmount || 0) + (invoice.fineAmount || 0);
        const remainingBalance = Math.max(0, totalPayable - (invoice.paidAmount || 0));
        if (remainingBalance <= 0) {
            throw new Error("Invoice is already fully paid.");
        }

        const payAmount = Number(amount) || remainingBalance;
        if (payAmount <= 0) {
            throw new Error("Payment amount must be greater than zero.");
        }

        const paymentNumber = await generateUniquePaymentNumber(db, societyId);

        // Create Razorpay Order
        let razorpayOrder;
        try {
            razorpayOrder = await createRazorpayOrder({
                amount: payAmount,
                receipt: paymentNumber,
                notes: {
                    societyId: String(societyId),
                    invoiceId: String(invoiceId),
                    flatId: String(invoice.flatId),
                    userId: String(userId),
                },
            });
        } catch (err) {
            console.error("[RAZORPAY ORDER ERROR]", err);
            // Fallback for offline testing if Razorpay key is test/mock
            razorpayOrder = { id: `order_mock_${Date.now()}` };
        }

        const payment = await Payment.create({
            societyId,
            flatId: invoice.flatId,
            userId,
            invoiceId,
            paymentAccountId: "HDFC_COLLECTION_ACC",
            paymentAccountName: "HDFC Online Collection Account",
            paymentNumber,
            amount: payAmount,
            paymentMode: paymentMode || "UPI",
            paymentSource: "ONLINE",
            paymentStatus: "INITIATED",
            reconciliationStatus: "UNRECONCILED",
            gatewayOrderId: razorpayOrder.id,
            recordedBy: userId,
            paymentDate: new Date(),
        });

        await logBillingAction({
            req,
            db,
            action: "PAYMENT.INITIATE_ONLINE",
            resource: "Payment",
            resourceId: payment._id,
            amount: payAmount,
            details: { paymentNumber, gatewayOrderId: razorpayOrder.id, invoiceId },
        });

        return {
            keyId: process.env.RAZORPAY_KEY_ID,
            orderId: razorpayOrder.id,
            paymentId: payment._id,
            paymentNumber,
            amount: payAmount,
            currency: "INR",
            invoiceNumber: invoice.invoiceNumber,
        };
    }

    // ── 2. Verify Online Payment ──
    static async verifyOnlinePayment({ req, db, societyId, userId, razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId }) {
        const { Payment, Receipt, AdvanceAccount } = getPaymentModels(db);
        const { BillingInvoice, InvoicePayment } = getBillingModels(db);

        let payment = null;
        if (paymentId) {
            payment = await Payment.findOne({ _id: paymentId, societyId });
        } else if (razorpay_order_id) {
            payment = await Payment.findOne({ gatewayOrderId: razorpay_order_id, societyId });
        }

        if (!payment) {
            throw new Error("Payment transaction record not found.");
        }

        // Idempotency: If already SUCCESS, return result safely
        if (payment.paymentStatus === "SUCCESS") {
            const receipt = await Receipt.findOne({ paymentId: payment._id });
            return { payment, receipt };
        }

        // Verify HMAC signature if credentials provided
        const secret = process.env.RAZORPAY_KEY_SECRET;
        if (secret && razorpay_signature && razorpay_order_id && razorpay_payment_id) {
            const expectedSig = crypto
                .createHmac("sha256", secret)
                .update(`${razorpay_order_id}|${razorpay_payment_id}`)
                .digest("hex");

            if (expectedSig !== razorpay_signature) {
                payment.paymentStatus = "FAILED";
                payment.failureReason = "Signature verification failed";
                await payment.save();
                throw new Error("Invalid payment gateway signature.");
            }
        }

        // Update Payment Record
        payment.paymentStatus = "SUCCESS";
        payment.reconciliationStatus = "RECONCILED";
        payment.gatewayTransactionId = razorpay_payment_id || `txn_${Date.now()}`;
        payment.gatewaySignature = razorpay_signature || null;
        payment.paymentDate = new Date();
        await payment.save();

        // Process Invoice & Allocation
        let receipt = null;
        if (payment.invoiceId) {
            const invoice = await BillingInvoice.findOne({ _id: payment.invoiceId, societyId });
            if (invoice) {
                const prevPaid = invoice.paidAmount || 0;
                const totalPayable = (invoice.totalAmount || 0) + (invoice.fineAmount || 0);
                const remaining = Math.max(0, totalPayable - prevPaid);
                const currentPayment = payment.amount;

                let appliedToInvoice = Math.min(remaining, currentPayment);
                let excessAmount = Math.max(0, currentPayment - remaining);

                invoice.paidAmount = prevPaid + appliedToInvoice;
                const newBalance = Math.max(0, totalPayable - invoice.paidAmount);

                if (newBalance <= 0) {
                    invoice.status = "PAID";
                } else if (invoice.paidAmount > 0) {
                    invoice.status = "PARTIALLY_PAID";
                }
                await invoice.save();

                // If overpaid, credit Advance Account
                if (excessAmount > 0) {
                    payment.excessAmount = excessAmount;
                    await payment.save();

                    let advanceAcc = await AdvanceAccount.findOne({ societyId, flatId: invoice.flatId });
                    if (!advanceAcc) {
                        advanceAcc = new AdvanceAccount({
                            societyId,
                            flatId: invoice.flatId,
                            userId: invoice.userId,
                            advanceBalance: 0,
                            securityDepositBalance: 0,
                            transactions: [],
                        });
                    }
                    advanceAcc.advanceBalance += excessAmount;
                    advanceAcc.transactions.push({
                        type: "CREDIT",
                        accountType: "ADVANCE",
                        amount: excessAmount,
                        referencePaymentId: payment._id,
                        referenceInvoiceId: invoice._id,
                        description: `Overpayment credit from Payment ${payment.paymentNumber}`,
                        date: new Date(),
                        recordedBy: userId,
                    });
                    await advanceAcc.save();
                }

                // Generate Receipt
                const receiptNum = await generateUniqueReceiptNumber(db, societyId);
                receipt = await Receipt.create({
                    societyId,
                    receiptNumber: receiptNum,
                    paymentId: payment._id,
                    invoiceId: invoice._id,
                    invoiceNumber: invoice.invoiceNumber,
                    flatId: invoice.flatId,
                    userId: invoice.userId,
                    residentName: invoice.residentName || "Resident",
                    flatNumber: invoice.flatNumber || "",
                    blockName: invoice.blockName || "",
                    amount: currentPayment,
                    amountInWords: numberToWords(currentPayment),
                    paymentMode: payment.paymentMode,
                    paymentAccountName: payment.paymentAccountName,
                    transactionRef: payment.gatewayTransactionId,
                    invoiceTotalAmount: invoice.totalAmount,
                    previousPaidAmount: prevPaid,
                    currentPaidAmount: currentPayment,
                    remainingBalance: newBalance,
                    generatedAt: new Date(),
                    generatedBy: userId,
                });

                payment.receiptId = receipt._id;
                payment.receiptNumber = receiptNum;
                await payment.save();

                // Register InvoicePayment record
                await InvoicePayment.create({
                    societyId,
                    invoiceId: invoice._id,
                    flatId: invoice.flatId,
                    userId: invoice.userId,
                    amountPaid: currentPayment,
                    paymentMode: payment.paymentMode,
                    paymentAccount: payment.paymentAccountName,
                    paymentDate: payment.paymentDate,
                    receiptNumber: receiptNum,
                    referenceNumber: payment.gatewayTransactionId,
                    paymentType: "ONLINE",
                    recordedBy: userId,
                    excessAmount,
                });
            }
        }

        await logBillingAction({
            req,
            db,
            action: "PAYMENT.VERIFY_ONLINE_SUCCESS",
            resource: "Payment",
            resourceId: payment._id,
            amount: payment.amount,
            details: { paymentNumber: payment.paymentNumber, receiptNumber: receipt?.receiptNumber },
        });

        // ── AUTO-POST TO LEDGER ──
        // Debit: HDFC Bank (Default Code: 1012)
        // Credit: Accounts Receivable (Default Code: 1021)
        if (payment.amount > 0) {
            try {
                await generateAutomaticPosting({
                    societyId,
                    userId,
                    userRole: "system",
                    eventType: "ONLINE_PAYMENT",
                    amount: payment.amount,
                    transactionDate: payment.paymentDate || new Date(),
                    debitAccountCode: "1012", // Default Main Bank Account
                    creditAccountCode: "1021", // Default Accounts Receivable
                    description: `Online payment received for ${payment.paymentNumber} ${invoice ? 'against ' + invoice.invoiceNumber : ''}`,
                    referenceId: payment._id,
                    referenceNumber: payment.paymentNumber,
                    residentId: invoice ? invoice.userId : null,
                    flatId: invoice ? invoice.flatId : payment.flatId,
                }, db);
            } catch (err) {
                console.error("Failed to auto-post online payment to ledger:", err.message);
                // We swallow the error here to not fail the gateway verification, but it should be alerted
            }
        }

        return { payment, receipt };
    }

    // ── 3. Webhook Handling (Idempotent) ──
    static async handleWebhook({ db, webhookPayload, signature }) {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
        if (secret && signature) {
            const expectedSig = crypto
                .createHmac("sha256", secret)
                .update(JSON.stringify(webhookPayload))
                .digest("hex");
            if (expectedSig !== signature) {
                throw new Error("Invalid webhook signature.");
            }
        }

        const event = webhookPayload.event;
        if (event === "payment.captured" || event === "order.paid") {
            const paymentEntity = webhookPayload.payload.payment.entity;
            const orderId = paymentEntity.order_id;
            const txnId = paymentEntity.id;

            const { Payment } = getPaymentModels(db);
            const payment = await Payment.findOne({ gatewayOrderId: orderId });
            if (payment && payment.paymentStatus !== "SUCCESS") {
                await this.verifyOnlinePayment({
                    db,
                    societyId: payment.societyId,
                    userId: payment.userId,
                    razorpay_order_id: orderId,
                    razorpay_payment_id: txnId,
                    paymentId: payment._id,
                });
            }
        }
        return { success: true };
    }

    // ── 4. Record Offline Payment ──
    static async recordOfflinePayment({ req, db, societyId, recordedBy, flatId, userId, invoiceId, amount, paymentMode, referenceNumber, paymentAccountId, paymentAccountName, notes, paymentDate, chequeDetails, bankTransferDetails }) {
        const { Payment, Receipt, AdvanceAccount } = getPaymentModels(db);
        const { BillingInvoice, InvoicePayment } = getBillingModels(db);

        if (!flatId) throw new Error("Flat ID is required for offline payment.");
        if (!amount || Number(amount) <= 0) throw new Error("Valid payment amount is required.");
        if (!paymentMode || !["CASH", "CHEQUE", "BANK_TRANSFER"].includes(paymentMode)) {
            throw new Error("Invalid offline payment mode.");
        }

        // Mode specific validation
        if (paymentMode === "CHEQUE" && (!chequeDetails?.chequeNumber || !chequeDetails?.bankName)) {
            throw new Error("Cheque number and bank name are required for cheque payments.");
        }
        if (paymentMode === "BANK_TRANSFER" && !referenceNumber) {
            throw new Error("Transaction reference number is required for bank transfers.");
        }

        const paymentNumber = await generateUniquePaymentNumber(db, societyId);
        const payDate = paymentDate ? new Date(paymentDate) : new Date();

        let invoice = null;
        if (invoiceId) {
            invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId });
        }

        const payment = await Payment.create({
            societyId,
            flatId,
            userId,
            invoiceId: invoice ? invoice._id : null,
            paymentAccountId: paymentAccountId || "PRIMARY_CASH_ACC",
            paymentAccountName: paymentAccountName || (paymentMode === "CASH" ? "Cash Account" : "Bank Collection Account"),
            paymentNumber,
            amount: Number(amount),
            paymentMode,
            paymentSource: "OFFLINE",
            paymentStatus: "SUCCESS",
            reconciliationStatus: "RECONCILED",
            transactionReference: referenceNumber || (chequeDetails ? chequeDetails.chequeNumber : null),
            chequeDetails: paymentMode === "CHEQUE" ? chequeDetails : undefined,
            bankTransferDetails: paymentMode === "BANK_TRANSFER" ? bankTransferDetails : undefined,
            paymentDate: payDate,
            recordedBy,
            notes: notes || "",
        });

        let receipt = null;
        if (invoice) {
            const prevPaid = invoice.paidAmount || 0;
            const totalPayable = (invoice.totalAmount || 0) + (invoice.fineAmount || 0);
            const remaining = Math.max(0, totalPayable - prevPaid);
            const currentPayment = Number(amount);

            let appliedToInvoice = Math.min(remaining, currentPayment);
            let excessAmount = Math.max(0, currentPayment - remaining);

            invoice.paidAmount = prevPaid + appliedToInvoice;
            const newBalance = Math.max(0, totalPayable - invoice.paidAmount);

            if (newBalance <= 0) {
                invoice.status = "PAID";
            } else if (invoice.paidAmount > 0) {
                invoice.status = "PARTIALLY_PAID";
            }
            await invoice.save();

            // Advance account handling
            if (excessAmount > 0) {
                payment.excessAmount = excessAmount;
                await payment.save();

                let advanceAcc = await AdvanceAccount.findOne({ societyId, flatId });
                if (!advanceAcc) {
                    advanceAcc = new AdvanceAccount({
                        societyId,
                        flatId,
                        userId,
                        advanceBalance: 0,
                        securityDepositBalance: 0,
                        transactions: [],
                    });
                }
                advanceAcc.advanceBalance += excessAmount;
                advanceAcc.transactions.push({
                    type: "CREDIT",
                    accountType: "ADVANCE",
                    amount: excessAmount,
                    referencePaymentId: payment._id,
                    referenceInvoiceId: invoice._id,
                    description: `Offline Overpayment credit from ${paymentNumber}`,
                    date: payDate,
                    recordedBy,
                });
                await advanceAcc.save();
            }

            // Generate receipt
            const receiptNum = await generateUniqueReceiptNumber(db, societyId);
            receipt = await Receipt.create({
                societyId,
                receiptNumber: receiptNum,
                paymentId: payment._id,
                invoiceId: invoice._id,
                invoiceNumber: invoice.invoiceNumber,
                flatId,
                userId,
                residentName: invoice.residentName || "Resident",
                flatNumber: invoice.flatNumber || "",
                blockName: invoice.blockName || "",
                amount: currentPayment,
                amountInWords: numberToWords(currentPayment),
                paymentMode,
                paymentAccountName: payment.paymentAccountName,
                transactionRef: referenceNumber || chequeDetails?.chequeNumber || "",
                invoiceTotalAmount: invoice.totalAmount,
                previousPaidAmount: prevPaid,
                currentPaidAmount: currentPayment,
                remainingBalance: newBalance,
                generatedAt: new Date(),
                generatedBy: recordedBy,
            });

            payment.receiptId = receipt._id;
            payment.receiptNumber = receiptNum;
            await payment.save();

            await InvoicePayment.create({
                societyId,
                invoiceId: invoice._id,
                flatId,
                userId,
                amountPaid: currentPayment,
                paymentMode,
                paymentAccount: payment.paymentAccountName,
                paymentDate: payDate,
                receiptNumber: receiptNum,
                referenceNumber: referenceNumber || chequeDetails?.chequeNumber || "",
                paymentType: "OFFLINE",
                recordedBy,
                excessAmount,
            });
        }

        await logBillingAction({
            req,
            db,
            action: "PAYMENT.RECORD_OFFLINE",
            resource: "Payment",
            resourceId: payment._id,
            amount: payment.amount,
            details: { paymentNumber, paymentMode, receiptNumber: receipt?.receiptNumber },
        });

        // ── AUTO-POST TO LEDGER ──
        // Debit: Cash (1011) or Bank (1012) based on mode
        // Credit: Accounts Receivable (1021)
        if (payment.amount > 0) {
            try {
                const debitCode = paymentMode === "CASH" ? "1011" : "1012";
                await generateAutomaticPosting({
                    societyId,
                    userId: recordedBy,
                    userRole: "admin",
                    eventType: "OFFLINE_PAYMENT",
                    amount: payment.amount,
                    transactionDate: payDate,
                    debitAccountCode: debitCode, 
                    creditAccountCode: "1021", 
                    description: `Offline ${paymentMode} payment received for ${payment.paymentNumber}`,
                    referenceId: payment._id,
                    referenceNumber: payment.paymentNumber,
                    residentId: userId,
                    flatId: flatId,
                }, db);
            } catch (err) {
                console.error("Failed to auto-post offline payment to ledger:", err.message);
                // Swallowed so UI still reports successful payment save
            }
        }

        return { payment, receipt };
    }

    // ── 5. Dashboard Overview Metrics ──
    static async getOverviewStats({ db, societyId, startDate, endDate, wing, blockId, flatId, paymentMode, paymentAccountId }) {
        const { Payment } = getPaymentModels(db);
        const { BillingInvoice } = getBillingModels(db);
        const mongoose = require("mongoose");

        const socObjectId = typeof societyId === "string" ? new mongoose.Types.ObjectId(societyId) : societyId;

        let filter = { societyId: socObjectId };
        if (startDate || endDate) {
            filter.paymentDate = {};
            if (startDate) filter.paymentDate.$gte = new Date(startDate);
            if (endDate) {
                const endD = new Date(endDate);
                endD.setHours(23, 59, 59, 999);
                filter.paymentDate.$lte = endD;
            }
        }
        if (flatId) filter.flatId = typeof flatId === "string" ? new mongoose.Types.ObjectId(flatId) : flatId;
        if (paymentMode) filter.paymentMode = paymentMode;
        if (paymentAccountId) filter.paymentAccountId = paymentAccountId;

        const totalColl = await Payment.aggregate([
            { $match: { ...filter, paymentStatus: "SUCCESS" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayColl = await Payment.aggregate([
            { $match: { societyId: socObjectId, paymentStatus: "SUCCESS", paymentDate: { $gte: todayStart, $lte: todayEnd } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const onlineColl = await Payment.aggregate([
            { $match: { ...filter, paymentStatus: "SUCCESS", paymentSource: "ONLINE" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const offlineColl = await Payment.aggregate([
            { $match: { ...filter, paymentStatus: "SUCCESS", paymentSource: "OFFLINE" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]);

        const pendingCount = await Payment.countDocuments({ societyId: socObjectId, paymentStatus: "PENDING" });
        const failedCount = await Payment.countDocuments({ societyId: socObjectId, paymentStatus: "FAILED" });
        const unmatchedCount = await Payment.countDocuments({
            societyId: socObjectId,
            paymentStatus: "SUCCESS",
            reconciliationStatus: { $in: ["UNRECONCILED", "MATCH_FAILED", "MANUAL_REVIEW"] },
        });

        // Calculate Outstanding Invoice Balance (including fineAmount)
        const outstanding = await BillingInvoice.aggregate([
            { $match: { societyId: socObjectId, status: { $nin: ["PAID", "CANCELLED"] } } },
            {
                $group: {
                    _id: null,
                    total: {
                        $sum: {
                            $subtract: [
                                { $add: ["$totalAmount", { $ifNull: ["$fineAmount", 0] }] },
                                { $ifNull: ["$paidAmount", 0] }
                            ]
                        }
                    }
                }
            },
        ]);

        return {
            totalCollected: totalColl[0]?.total || 0,
            todayCollection: todayColl[0]?.total || 0,
            onlineCollection: onlineColl[0]?.total || 0,
            offlineCollection: offlineColl[0]?.total || 0,
            pendingPaymentsCount: pendingCount,
            failedPaymentsCount: failedCount,
            unmatchedPaymentsCount: unmatchedCount,
            outstandingAmount: outstanding[0]?.total || 0,
        };
    }

    // ── 6. Paginated Payments List ──
    static async getPaymentsList({ db, societyId, page = 1, limit = 10, search, startDate, endDate, flatId, paymentMode, paymentStatus, paymentSource, paymentAccountId, residentId, invoiceId }) {
        const { Payment } = getPaymentModels(db);

        const query = { societyId };

        if (paymentStatus) query.paymentStatus = paymentStatus;
        if (paymentSource) query.paymentSource = paymentSource;
        if (paymentMode) query.paymentMode = paymentMode;
        if (paymentAccountId) query.paymentAccountId = paymentAccountId;
        if (flatId) query.flatId = flatId;
        if (residentId) query.userId = residentId;
        if (invoiceId) query.invoiceId = invoiceId;

        if (startDate || endDate) {
            query.paymentDate = {};
            if (startDate) query.paymentDate.$gte = new Date(startDate);
            if (endDate) query.paymentDate.$lte = new Date(endDate);
        }

        if (search) {
            const regex = new RegExp(search, "i");
            query.$or = [
                { paymentNumber: regex },
                { receiptNumber: regex },
                { gatewayTransactionId: regex },
                { transactionReference: regex },
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const total = await Payment.countDocuments(query);
        const payments = await Payment.find(query)
            .populate("flatId", "flatNumber blockName wingName ownerName tenantName ownerPhone tenantPhone")
            .populate("userId", "name firstName lastName email phone")
            .populate("invoiceId", "invoiceNumber totalAmount paidAmount status residentName residentPhone residentEmail")
            .sort({ paymentDate: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        return {
            data: payments,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        };
    }

    // ── 7. Pending / Failed / Unmatched Payments ──
    static async getPendingFailedPayments({ db, societyId, page = 1, limit = 10, search }) {
        const { Payment } = getPaymentModels(db);

        const query = {
            societyId,
            $or: [
                { paymentStatus: { $in: ["PENDING", "FAILED"] } },
                { reconciliationStatus: { $in: ["UNRECONCILED", "MATCH_FAILED", "MANUAL_REVIEW"] } },
            ],
        };

        if (search) {
            const regex = new RegExp(search, "i");
            query.$and = [
                {
                    $or: [
                        { paymentNumber: regex },
                        { gatewayTransactionId: regex },
                        { transactionReference: regex },
                    ],
                },
            ];
        }

        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 10;
        const skip = (pageNum - 1) * limitNum;

        const total = await Payment.countDocuments(query);
        const items = await Payment.find(query)
            .populate("flatId", "flatNumber blockName wingName")
            .populate("userId", "name email phone")
            .populate("invoiceId", "invoiceNumber totalAmount paidAmount status")
            .sort({ paymentDate: -1 })
            .skip(skip)
            .limit(limitNum)
            .lean();

        return {
            data: items,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1,
            },
        };
    }

    // ── 8. Manual Reconciliation ──
    static async manualReconcilePayment({ req, db, societyId, paymentId, invoiceId, userId }) {
        const { Payment, Receipt, AdvanceAccount } = getPaymentModels(db);
        const { BillingInvoice, InvoicePayment } = getBillingModels(db);

        const payment = await Payment.findOne({ _id: paymentId, societyId });
        if (!payment) throw new Error("Payment record not found.");

        const invoice = await BillingInvoice.findOne({ _id: invoiceId, societyId });
        if (!invoice) throw new Error("Selected invoice not found.");

        payment.invoiceId = invoice._id;
        payment.flatId = invoice.flatId;
        payment.userId = invoice.userId;
        payment.reconciliationStatus = "RECONCILED";
        if (payment.paymentStatus !== "SUCCESS") {
            payment.paymentStatus = "SUCCESS";
        }

        const prevPaid = invoice.paidAmount || 0;
        const remaining = Math.max(0, invoice.totalAmount - prevPaid);
        const currentPayment = payment.amount;

        let appliedToInvoice = Math.min(remaining, currentPayment);
        let excessAmount = Math.max(0, currentPayment - remaining);

        invoice.paidAmount = prevPaid + appliedToInvoice;
        const newBalance = Math.max(0, invoice.totalAmount - invoice.paidAmount);

        if (newBalance === 0) {
            invoice.status = "PAID";
        } else if (invoice.paidAmount > 0) {
            invoice.status = "PARTIALLY_PAID";
        }
        await invoice.save();

        if (excessAmount > 0) {
            payment.excessAmount = excessAmount;
            let advanceAcc = await AdvanceAccount.findOne({ societyId, flatId: invoice.flatId });
            if (!advanceAcc) {
                advanceAcc = new AdvanceAccount({
                    societyId,
                    flatId: invoice.flatId,
                    userId: invoice.userId,
                    advanceBalance: 0,
                    securityDepositBalance: 0,
                    transactions: [],
                });
            }
            advanceAcc.advanceBalance += excessAmount;
            advanceAcc.transactions.push({
                type: "CREDIT",
                accountType: "ADVANCE",
                amount: excessAmount,
                referencePaymentId: payment._id,
                referenceInvoiceId: invoice._id,
                description: `Manual Reconciliation Excess from Payment ${payment.paymentNumber}`,
                date: new Date(),
                recordedBy: userId,
            });
            await advanceAcc.save();
        }

        const receiptNum = await generateUniqueReceiptNumber(db, societyId);
        const receipt = await Receipt.create({
            societyId,
            receiptNumber: receiptNum,
            paymentId: payment._id,
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            flatId: invoice.flatId,
            userId: invoice.userId,
            residentName: invoice.residentName || "Resident",
            flatNumber: invoice.flatNumber || "",
            blockName: invoice.blockName || "",
            amount: currentPayment,
            amountInWords: numberToWords(currentPayment),
            paymentMode: payment.paymentMode,
            paymentAccountName: payment.paymentAccountName,
            transactionRef: payment.gatewayTransactionId || payment.transactionReference || "",
            invoiceTotalAmount: invoice.totalAmount,
            previousPaidAmount: prevPaid,
            currentPaidAmount: currentPayment,
            remainingBalance: newBalance,
            generatedAt: new Date(),
            generatedBy: userId,
        });

        payment.receiptId = receipt._id;
        payment.receiptNumber = receiptNum;
        await payment.save();

        await InvoicePayment.create({
            societyId,
            invoiceId: invoice._id,
            flatId: invoice.flatId,
            userId: invoice.userId,
            amountPaid: currentPayment,
            paymentMode: payment.paymentMode,
            paymentAccount: payment.paymentAccountName,
            paymentDate: payment.paymentDate,
            receiptNumber: receiptNum,
            referenceNumber: payment.gatewayTransactionId || payment.transactionReference || "",
            paymentType: payment.paymentSource,
            recordedBy: userId,
            excessAmount,
        });

        await logBillingAction({
            req,
            db,
            action: "PAYMENT.MANUAL_RECONCILE",
            resource: "Payment",
            resourceId: payment._id,
            amount: payment.amount,
            details: { paymentNumber: payment.paymentNumber, invoiceId, receiptNumber: receiptNum },
        });

        return { payment, receipt };
    }

    // ── 9. Collections Analytics ──
    static async getCollectionsAnalytics({ db, societyId, startDate, endDate, flatId, paymentAccountId }) {
        const { Payment } = getPaymentModels(db);
        const mongoose = require("mongoose");

        const socObjectId = typeof societyId === "string" ? new mongoose.Types.ObjectId(societyId) : societyId;

        const filter = { societyId: socObjectId, paymentStatus: "SUCCESS" };
        if (startDate || endDate) {
            filter.paymentDate = {};
            if (startDate) filter.paymentDate.$gte = new Date(startDate);
            if (endDate) {
                const endD = new Date(endDate);
                endD.setHours(23, 59, 59, 999);
                filter.paymentDate.$lte = endD;
            }
        }
        if (flatId) filter.flatId = typeof flatId === "string" ? new mongoose.Types.ObjectId(flatId) : flatId;
        if (paymentAccountId) filter.paymentAccountId = paymentAccountId;

        const byMode = await Payment.aggregate([
            { $match: filter },
            { $group: { _id: "$paymentMode", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]);

        const bySource = await Payment.aggregate([
            { $match: filter },
            { $group: { _id: "$paymentSource", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]);

        const byAccount = await Payment.aggregate([
            { $match: filter },
            { $group: { _id: "$paymentAccountName", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]);

        return { byMode, bySource, byAccount };
    }
}

module.exports = PaymentService;