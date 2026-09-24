"use strict";

const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const mongoose = require("mongoose");
const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");
const AppError = require("../../common/AppError");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");
const { ROLES, PAGINATION, PAYMENT_STATUS, PAYMENT_METHOD } = require("../../common/constants");
const { getPaymentModels } = require("../payment/payment.model");
const PaymentService = require("../payment/payment.service"); 

const getFestivalCollectionModel = () => getOperationsConnection().model("FestivalCollection");
const getFestivalContributionModel = () => getOperationsConnection().model("FestivalContribution");
const getFlatModel = () => getOperationsConnection().model("Flat");
const getBlockModel = () => getOperationsConnection().model("Block");
const getUserSocietyMappingModel = () => getMasterConnection().model("UserSocietyMapping");

const isApplicableToResident = async (collection, flatId, blockId) => {
    if (collection.applicableType === "ALL") return true;
    if (collection.applicableType === "SPECIFIC_BLOCK") {
        return collection.applicableBlocks.some(id => String(id) === String(blockId));
    }
    if (collection.applicableType === "SPECIFIC_FLAT") {
        return collection.applicableFlats.some(id => String(id) === String(flatId));
    }
    return false;
};

exports.createCollection = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const { title, description, purpose, targetAmount, suggestedAmount, amountPerFlat, startDate, dueDate, eventDate, applicableType, applicableBlocks, applicableFlats } = req.body;
        const societyId = req.societyId;

        const collection = await FestivalCollection.create({
            societyId,
            title,
            description,
            purpose,
            targetAmount,
            suggestedAmount: suggestedAmount || 0,
            amountPerFlat: amountPerFlat || 0,
            startDate: new Date(startDate),
            dueDate: new Date(dueDate),
            eventDate: new Date(eventDate),
            applicableType: applicableType || "ALL",
            applicableBlocks: applicableBlocks || [],
            applicableFlats: applicableFlats || [],
            status: "ACTIVE",
            createdBy: req.user.id,
        });

        return sendSuccess(res, 201, "Festival Collection created successfully", { collection });
    } catch (error) {
        next(error);
    }
};

exports.getCollections = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const { page = PAGINATION.DEFAULT_PAGE, limit = PAGINATION.DEFAULT_LIMIT, status } = req.query;
        const societyId = req.societyId;

        const query = { societyId };
        const isResident = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT].includes(req.user.role);
        
        let applicableFlats = [];
        let applicableBlocks = [];
        
        if (isResident) {
            query.status = "ACTIVE";
            const UserSocietyMapping = getUserSocietyMappingModel();
            // Schema has single flatId field, not flats array
            const mapping = await UserSocietyMapping.findOne({ userId: req.user.id, societyId }).lean();
            
            if (mapping && mapping.flatId) {
                applicableFlats = [String(mapping.flatId)];
                // Get the flat's blockId from Flat model
                try {
                    const Flat = getFlatModel();
                    const flat = await Flat.findById(mapping.flatId).lean();
                    if (flat && flat.blockId) {
                        applicableBlocks = [String(flat.blockId)];
                    }
                } catch (_) {}
            }
            
            query.$or = [
                { applicableType: "ALL" },
                { applicableType: "SPECIFIC_BLOCK", applicableBlocks: { $in: applicableBlocks } },
                { applicableType: "SPECIFIC_FLAT", applicableFlats: { $in: applicableFlats } }
            ];
        } else if (status) {
            query.status = status;
        }

        const skip = (page - 1) * limit;

        const collections = await FestivalCollection.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate("createdBy", "name email");

        const total = await FestivalCollection.countDocuments(query);

        return sendPaginated(res, 200, "Collections fetched successfully", collections, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        next(error);
    }
};

exports.getCollectionById = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const { id } = req.params;

        const collection = await FestivalCollection.findOne({ _id: id, societyId: req.societyId })
            .populate("createdBy", "name email")
            .populate("updatedBy", "name email");

        if (!collection) {
            return next(new AppError("COLLECTION_NOT_FOUND", 404, "Collection not found"));
        }

        const isResident = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT].includes(req.user.role);
        if (isResident && collection.status !== "ACTIVE") {
            return next(new AppError("UNAUTHORIZED", 403, "Cannot view inactive collections"));
        }
        
        return sendSuccess(res, 200, "Collection fetched successfully", { collection });
    } catch (error) {
        next(error);
    }
};

exports.updateCollection = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const { id } = req.params;
        const updates = req.body;
        
        delete updates.societyId;
        delete updates.createdBy;

        const collection = await FestivalCollection.findOneAndUpdate(
            { _id: id, societyId: req.societyId },
            { ...updates, updatedBy: req.user.id },
            { new: true, runValidators: true }
        );

        if (!collection) return next(new AppError("NOT_FOUND", 404, "Collection not found"));

        return sendSuccess(res, 200, "Collection updated successfully", { collection });
    } catch (error) {
        next(error);
    }
};

exports.initiateOnlinePayment = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const FestivalContribution = getFestivalContributionModel();
        const Flat = getFlatModel();
        const { id } = req.params;
        const { amount, flatId } = req.body;
        
        if (!amount || amount <= 0) {
            return next(new AppError("INVALID_AMOUNT", 400, "Invalid payment amount"));
        }

        const collection = await FestivalCollection.findOne({ _id: id, societyId: req.societyId });
        if (!collection || collection.status !== "ACTIVE") {
            return next(new AppError("INVALID_COLLECTION", 400, "Collection not active or not found"));
        }

        const flat = await Flat.findOne({ _id: flatId, societyId: req.societyId });
        if (!flat) return next(new AppError("INVALID_FLAT", 400, "Invalid flat"));

        const applicable = await isApplicableToResident(collection, flat._id, flat.blockId);
        if (!applicable) {
            return next(new AppError("NOT_APPLICABLE", 403, "This collection is not applicable to your flat"));
        }

        const receiptRef = `FEST_${Date.now()}_${flat.flatNumber}`;
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            return next(new AppError("GATEWAY_ERROR", 500, "Payment gateway credentials missing."));
        }
        
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
        const postData = JSON.stringify({
            amount: Math.round(amount * 100),
            currency: "INR",
            receipt: receiptRef,
            notes: { collectionId: id, flatId: flatId, residentId: req.user.id },
        });

        const https = require("https");
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

        const razorpayOrder = await new Promise((resolve, reject) => {
            const request = https.request(options, (response) => {
                let body = "";
                response.on("data", (chunk) => (body += chunk));
                response.on("end", () => {
                    const parsed = JSON.parse(body);
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        reject(new AppError("GATEWAY_ERROR", 500, parsed.error?.description || "Gateway failed"));
                    }
                });
            });
            request.on("error", (e) => reject(e));
            request.write(postData);
            request.end();
        });

        let contribution = await FestivalContribution.findOne({
            societyId: req.societyId,
            festivalCollectionId: collection._id,
            flatId: flat._id
        });

        if (contribution) {
            if (contribution.status === PAYMENT_STATUS.SUCCESS) {
                return next(new AppError("ALREADY_PAID", 400, "Contribution has already been paid for this flat."));
            }
            contribution.amount = amount;
            contribution.paidBy = req.user.id;
            contribution.status = PAYMENT_STATUS.INITIATED;
            contribution.paymentSource = "ONLINE";
            contribution.orderId = razorpayOrder.id;
            contribution.gatewayOrderId = razorpayOrder.id;
            contribution.transactionRef = razorpayOrder.id;
            await contribution.save();
        } else {
            contribution = await FestivalContribution.create({
                societyId: req.societyId,
                festivalCollectionId: collection._id,
                flatId: flat._id,
                paidBy: req.user.id,
                amount: amount,
                status: PAYMENT_STATUS.INITIATED,
                paymentSource: "ONLINE",
                orderId: razorpayOrder.id,
                gatewayOrderId: razorpayOrder.id,
                transactionRef: razorpayOrder.id,
            });
        }

        return sendSuccess(res, 200, "Payment initiated", {
            order: razorpayOrder,
            key: keyId,
            contributionId: contribution._id
        });
    } catch (error) {
        next(error);
    }
};

exports.verifyOnlinePayment = async (req, res, next) => {
    try {
        const FestivalContribution = getFestivalContributionModel();
        const FestivalCollection = getFestivalCollectionModel();
        const { Payment, Receipt } = getPaymentModels();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, contributionId } = req.body;
        
        const keySecret = process.env.RAZORPAY_KEY_SECRET;
        
        const generated_signature = crypto
            .createHmac("sha256", keySecret)
            .update(razorpay_order_id + "|" + razorpay_payment_id)
            .digest("hex");

        if (generated_signature !== razorpay_signature) {
            return next(new AppError("INVALID_SIGNATURE", 400, "Payment signature verification failed"));
        }

        const contribution = await FestivalContribution.findOne({ _id: contributionId, societyId: req.societyId }).populate('flatId paidBy');
        if (!contribution) return next(new AppError("NOT_FOUND", 404, "Contribution record not found"));

        if (contribution.status === PAYMENT_STATUS.SUCCESS) {
            return sendSuccess(res, 200, "Payment already processed");
        }

        const count = await Payment.countDocuments({ societyId: req.societyId });
        const paymentNumber = `PAY-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
        
        const rCount = await Receipt.countDocuments({ societyId: req.societyId });
        const receiptNumber = `REC/${new Date().getFullYear()}/${String(rCount + 1).padStart(6, "0")}`;

        const payment = await Payment.create({
            societyId: req.societyId,
            flatId: contribution.flatId._id,
            userId: contribution.paidBy._id,
            festivalCollectionId: contribution.festivalCollectionId,
            paymentCategory: "FESTIVAL",
            paymentAccountId: "ONLINE_GATEWAY",
            paymentAccountName: "Razorpay Gateway",
            paymentNumber,
            amount: contribution.amount,
            paymentMode: "ONLINE",
            paymentSource: "ONLINE",
            paymentStatus: "SUCCESS",
            reconciliationStatus: "UNRECONCILED",
            gatewayOrderId: razorpay_order_id,
            gatewayTransactionId: razorpay_payment_id,
            gatewaySignature: razorpay_signature,
            paymentDate: new Date(),
            recordedBy: req.user.id,
            receiptNumber
        });

        const numberToWords = (amount) => {
            if (!amount || amount <= 0) return "Zero Rupees Only";
            const num = Math.floor(amount);
            const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
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
        };

        const receipt = await Receipt.create({
            societyId: req.societyId,
            receiptNumber,
            receiptCategory: "FESTIVAL",
            paymentId: payment._id,
            festivalCollectionId: contribution.festivalCollectionId,
            flatId: contribution.flatId._id,
            userId: contribution.paidBy._id,
            residentName: contribution.paidBy.name || "Resident",
            flatNumber: contribution.flatId.flatNumber || "",
            amount: contribution.amount,
            amountInWords: numberToWords(contribution.amount),
            paymentMode: "ONLINE",
            paymentAccountName: "Razorpay Gateway",
            transactionRef: razorpay_payment_id,
            currentPaidAmount: contribution.amount,
            generatedAt: new Date(),
            generatedBy: req.user.id,
        });

        payment.receiptId = receipt._id;
        await payment.save();

        contribution.status = PAYMENT_STATUS.SUCCESS;
        contribution.paymentId = payment._id;
        contribution.receiptId = receipt._id;
        contribution.orderId = razorpay_order_id || contribution.orderId;
        contribution.gatewayOrderId = razorpay_order_id || contribution.gatewayOrderId;
        contribution.transactionRef = razorpay_payment_id || contribution.transactionRef;
        contribution.paymentDate = new Date();
        await contribution.save();

        await FestivalCollection.updateOne(
            { _id: contribution.festivalCollectionId },
            { $inc: { collectedAmount: contribution.amount } }
        );

        return sendSuccess(res, 200, "Payment verified successfully", { receipt });
    } catch (error) {
        next(error);
    }
};

exports.recordOfflineContribution = async (req, res, next) => {
    try {
        const FestivalContribution = getFestivalContributionModel();
        const FestivalCollection = getFestivalCollectionModel();
        const { Payment, Receipt } = getPaymentModels();
        const Flat = getFlatModel();
        
        const { id } = req.params;
        const { flatId, residentId, amount, paymentMode, transactionRef, paymentAccountId, notes } = req.body;

        const collection = await FestivalCollection.findOne({ _id: id, societyId: req.societyId });
        if (!collection || collection.status !== "ACTIVE") {
            return next(new AppError("INVALID_COLLECTION", 400, "Collection not active or not found"));
        }
        
        const flat = await Flat.findOne({ _id: flatId, societyId: req.societyId });
        if (!flat) return next(new AppError("INVALID_FLAT", 400, "Invalid flat"));

        const count = await Payment.countDocuments({ societyId: req.societyId });
        const paymentNumber = `PAY-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`;
        
        const rCount = await Receipt.countDocuments({ societyId: req.societyId });
        const receiptNumber = `REC/${new Date().getFullYear()}/${String(rCount + 1).padStart(6, "0")}`;

        const payment = await Payment.create({
            societyId: req.societyId,
            flatId: flat._id,
            userId: residentId,
            festivalCollectionId: collection._id,
            paymentCategory: "FESTIVAL",
            paymentAccountId: paymentAccountId || "OFFLINE_CASH", 
            paymentAccountName: "Cash/Bank Account",
            paymentNumber,
            amount: amount,
            paymentMode: paymentMode || "CASH",
            paymentSource: "OFFLINE",
            paymentStatus: "SUCCESS",
            reconciliationStatus: "UNRECONCILED",
            transactionReference: transactionRef,
            paymentDate: new Date(),
            recordedBy: req.user.id,
            receiptNumber,
            notes
        });

        const numberToWords = (amt) => {
            const num = Math.floor(amt);
            const a = ["", "One ", "Two ", "Three ", "Four ", "Five ", "Six ", "Seven ", "Eight ", "Nine ", "Ten ", "Eleven ", "Twelve ", "Thirteen ", "Fourteen ", "Fifteen ", "Sixteen ", "Seventeen ", "Eighteen ", "Nineteen "];
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
        };

        const receipt = await Receipt.create({
            societyId: req.societyId,
            receiptNumber,
            receiptCategory: "FESTIVAL",
            paymentId: payment._id,
            festivalCollectionId: collection._id,
            flatId: flat._id,
            userId: residentId,
            residentName: "Resident",
            flatNumber: flat.flatNumber || "",
            amount: amount,
            amountInWords: numberToWords(amount),
            paymentMode: paymentMode || "CASH",
            paymentAccountName: "Cash/Bank Account",
            transactionRef: transactionRef || "",
            currentPaidAmount: amount,
            generatedAt: new Date(),
            generatedBy: req.user.id,
        });

        payment.receiptId = receipt._id;
        await payment.save();

        const contribution = await FestivalContribution.create({
            societyId: req.societyId,
            festivalCollectionId: collection._id,
            flatId: flat._id,
            paidBy: residentId,
            amount: amount,
            status: PAYMENT_STATUS.SUCCESS,
            paymentMethod: paymentMode || "CASH",
            paymentSource: "OFFLINE",
            paymentId: payment._id,
            receiptId: receipt._id,
            transactionRef: transactionRef,
            paymentDate: new Date(),
            recordedBy: req.user.id
        });

        await FestivalCollection.updateOne(
            { _id: collection._id },
            { $inc: { collectedAmount: amount } }
        );

        return sendSuccess(res, 201, "Offline contribution recorded successfully", { contribution, receipt });
    } catch (error) {
        next(error);
    }
};

exports.getContributions = async (req, res, next) => {
    try {
        const FestivalContribution = getFestivalContributionModel();
        const { id } = req.params;
        const { page = PAGINATION.DEFAULT_PAGE, limit = PAGINATION.DEFAULT_LIMIT } = req.query;

        const query = { festivalCollectionId: id, societyId: req.societyId, status: PAYMENT_STATUS.SUCCESS };
        const skip = (page - 1) * limit;

        const contributions = await FestivalContribution.find(query)
            .populate("flatId", "flatNumber")
            .populate("paidBy", "name email")
            .populate("receiptId", "receiptNumber")
            .populate("paymentId", "paymentNumber gatewayOrderId gatewayTransactionId")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await FestivalContribution.countDocuments(query);

        return sendPaginated(res, 200, "Contributions fetched", contributions, {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        next(error);
    }
};

exports.getResidentStatus = async (req, res, next) => {
    try {
        const FestivalContribution = getFestivalContributionModel();
        const { id } = req.params;
        
        const contributions = await FestivalContribution.find({
            festivalCollectionId: id,
            societyId: req.societyId,
            paidBy: req.user.id,
            status: PAYMENT_STATUS.SUCCESS
        })
        .populate("receiptId", "receiptNumber generatedAt")
        .populate("paymentId", "paymentNumber gatewayOrderId gatewayTransactionId");

        return sendSuccess(res, 200, "Resident status fetched", { contributions });
    } catch (error) {
        next(error);
    }
};

exports.getCollectionReport = async (req, res, next) => {
    try {
        const FestivalCollection = getFestivalCollectionModel();
        const FestivalContribution = getFestivalContributionModel();
        const { id } = req.params;

        const collection = await FestivalCollection.findOne({ _id: id, societyId: req.societyId });
        if (!collection) return next(new AppError("NOT_FOUND", 404, "Collection not found"));

        const contributions = await FestivalContribution.aggregate([
            { $match: { festivalCollectionId: collection._id, status: PAYMENT_STATUS.SUCCESS } },
            { $group: { _id: "$paymentMethod", total: { $sum: "$amount" }, count: { $sum: 1 } } }
        ]);

        const totalPaid = await FestivalContribution.countDocuments({ festivalCollectionId: collection._id, status: PAYMENT_STATUS.SUCCESS });

        return sendSuccess(res, 200, "Collection report fetched", {
            collection,
            metrics: {
                totalCollected: collection.collectedAmount,
                targetAmount: collection.targetAmount,
                totalPaidResidents: totalPaid,
                methodBreakdown: contributions
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.downloadContributionReceipt = async (req, res, next) => {
    try {
        const FestivalContribution = getFestivalContributionModel();
        const FestivalCollection = getFestivalCollectionModel();
        const Flat = getFlatModel();
        const { id, contributionId } = req.params;

        const contribution = await FestivalContribution.findOne({
            _id: contributionId,
            festivalCollectionId: id,
            societyId: req.societyId,
        }).lean();

        if (!contribution) {
            return next(new AppError("NOT_FOUND", 404, "Contribution not found"));
        }

        // Only the payer or admin can download
        const isAdmin = !["resident_owner", "resident_tenant"].includes(req.user.role);
        if (!isAdmin && String(contribution.paidBy) !== String(req.user.id)) {
            return next(new AppError("UNAUTHORIZED", 403, "Access denied"));
        }

        const collection = await FestivalCollection.findById(id).lean();
        const flat = await Flat.findById(contribution.flatId).lean();

        // --- Build PDF ---
        const doc = new PDFDocument({ margin: 50, size: 'A4' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${contributionId}.pdf"`);
        doc.pipe(res);

        const orange = '#EA580C';
        const dark = '#1a1a1a';
        const grey = '#6b7280';
        const lightGrey = '#f3f4f6';

        // Header band
        doc.rect(0, 0, doc.page.width, 110).fill(orange);

        doc.fillColor('white')
           .fontSize(22)
           .font('Helvetica-Bold')
           .text('MySocietySuite', 50, 30)
           .fontSize(11)
           .font('Helvetica')
           .text('Festival Contribution Receipt', 50, 58)
           .fontSize(9)
           .text('This is a system-generated receipt', 50, 78);

        // Receipt number box
        const receiptRef = contribution.transactionRef
            ? contribution.transactionRef.substring(0, 20)
            : `FEST-${String(contributionId).slice(-8).toUpperCase()}`;

        doc.fillColor(orange)
           .fontSize(9)
           .font('Helvetica-Bold')
           .text('Receipt No.', 390, 35)
           .fillColor('white')
           .fontSize(11)
           .text(receiptRef, 390, 50, { width: 160 });

        // Move below header
        doc.moveDown(4);

        // ── Collection Info ──
        doc.fillColor(orange).fontSize(12).font('Helvetica-Bold').text('Festival Details', 50, 130);
        doc.moveTo(50, 148).lineTo(545, 148).strokeColor(orange).lineWidth(1.5).stroke();

        const infoY = 158;
        const col2 = 310;

        const addField = (label, value, x, y) => {
            doc.fillColor(grey).fontSize(8).font('Helvetica').text(label, x, y);
            doc.fillColor(dark).fontSize(10).font('Helvetica-Bold').text(value || '—', x, y + 13);
        };

        addField('Festival / Event Name', collection?.title || 'N/A', 50, infoY);
        addField('Purpose', collection?.purpose || 'N/A', col2, infoY);
        addField('Event Date', collection?.eventDate ? new Date(collection.eventDate).toLocaleDateString('en-IN') : 'N/A', 50, infoY + 45);
        addField('Applicable To', collection?.applicableType || 'ALL', col2, infoY + 45);

        // ── Payment Info ──
        doc.fillColor(orange).fontSize(12).font('Helvetica-Bold').text('Payment Details', 50, infoY + 100);
        doc.moveTo(50, infoY + 118).lineTo(545, infoY + 118).strokeColor(orange).lineWidth(1.5).stroke();

        const payY = infoY + 128;
        addField('Flat Number', flat?.flatNumber || 'N/A', 50, payY);
        addField('Payment Mode', contribution.paymentSource || 'ONLINE', col2, payY);
        addField('Payment Date', contribution.paymentDate ? new Date(contribution.paymentDate).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN'), 50, payY + 45);
        addField('Transaction Reference', contribution.transactionRef || 'N/A', col2, payY + 45);
        addField('Status', contribution.status, 50, payY + 90);

        // ── Amount Box ──
        const amtY = payY + 145;
        doc.rect(50, amtY, 495, 65).fill(lightGrey);
        doc.fillColor(grey).fontSize(10).font('Helvetica').text('Amount Paid', 70, amtY + 15);
        doc.fillColor(orange).fontSize(26).font('Helvetica-Bold').text(
            `\u20B9 ${Number(contribution.amount).toLocaleString('en-IN')}`,
            70, amtY + 30
        );

        // ── Footer ──
        const footerY = doc.page.height - 80;
        doc.rect(0, footerY, doc.page.width, 80).fill(lightGrey);
        doc.fillColor(grey)
           .fontSize(8)
           .font('Helvetica')
           .text('This is a computer-generated receipt and does not require a physical signature.', 50, footerY + 15, { align: 'center', width: doc.page.width - 100 })
           .text(`Generated on ${new Date().toLocaleString('en-IN')} by MySocietySuite`, 50, footerY + 32, { align: 'center', width: doc.page.width - 100 });

        doc.end();
    } catch (error) {
        next(error);
    }
};
