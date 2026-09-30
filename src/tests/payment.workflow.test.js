"use strict";

const assert = require("assert");

// Setup dummy mongoose
const mongoose = {
    Types: {
        ObjectId: function(id) { return id || Math.random().toString(36).substring(7); }
    }
};

let paymentsStore = [];
let invoicesStore = [];
let receiptsStore = [];
let advanceStore = [];
let auditStore = [];
let invoicePaymentsStore = [];
let journalStore = [];

let sessionMock = {
    withTransaction: async (cb) => {
        try { await cb(); } catch (err) { throw err; }
    },
    abortTransaction: async () => {},
    endSession: () => {}
};

let dbMock = {
    startSession: async () => sessionMock,
    models: {},
    model: () => ({})
};

dbMock.models.Payment = {
    findOne: (q) => {
        let p = paymentsStore.find(x => x.gatewayOrderId === q.gatewayOrderId || x._id === q._id);
        if(!p) return null;
        return { ...p, save: async function() { Object.assign(p, this); return p; } };
    },
    countDocuments: async () => paymentsStore.length,
    create: async (docs, opts) => {
        let items = Array.isArray(docs) ? docs : [docs];
        items = items.map(i => ({...i, _id: "pay_" + Math.random(), save: async function() { Object.assign(i, this); return i; }}));
        paymentsStore.push(...items);
        return Array.isArray(docs) ? items : items[0];
    }
};

dbMock.models.BillingInvoice = {
    findOne: (q) => {
        let p = invoicesStore.find(x => x._id === q._id);
        if(!p) {
            let n = { session: () => null };
            return n;
        }
        let mocked = { ...p, save: async function() { 
            let idx = invoicesStore.findIndex(i => i._id === p._id);
            if (idx !== -1) invoicesStore[idx] = Object.assign(invoicesStore[idx], this);
            return this;
        }};
        mocked.session = () => mocked;
        return mocked;
    },
    find: (q) => {
        let arr = invoicesStore.filter(i => i.flatId === q.flatId && q.status.$nin.includes(i.status) === false);
        return {
            sort: () => ({
                session: () => arr.map(a => ({ ...a, save: async function() { Object.assign(a, this); return a; } }))
            })
        };
    }
};

dbMock.models.Receipt = {
    countDocuments: async () => receiptsStore.length,
    create: async (docs, opts) => {
        let items = Array.isArray(docs) ? docs : [docs];
        items = items.map(i => ({...i, _id: "rec_" + Math.random()}));
        receiptsStore.push(...items);
        return Array.isArray(docs) ? items : items[0];
    },
    findOne: async (q) => receiptsStore.find(x => x.paymentId === q.paymentId)
};

// Mock AdvanceAccount as a class/constructor function
class AdvanceAccountMock {
    constructor(data) {
        Object.assign(this, data);
        if (!this._id) this._id = "adv_" + Math.random();
    }
    async save() {
        let idx = advanceStore.findIndex(i => i._id === this._id);
        if (idx !== -1) advanceStore[idx] = Object.assign(advanceStore[idx], this);
        else advanceStore.push(this);
        return this;
    }
    static findOne(q) {
        let p = advanceStore.find(x => x.flatId === q.flatId);
        if(!p) return null;
        return Object.assign(new AdvanceAccountMock(p), p);
    }
    static async create(docs) {
        let items = Array.isArray(docs) ? docs : [docs];
        items = items.map(i => new AdvanceAccountMock(i));
        advanceStore.push(...items);
        return Array.isArray(docs) ? items : items[0];
    }
}
dbMock.models.AdvanceAccount = AdvanceAccountMock;

dbMock.models.InvoicePayment = {
    create: async (docs, opts) => {
        let items = Array.isArray(docs) ? docs : [docs];
        invoicePaymentsStore.push(...items);
        return Array.isArray(docs) ? items : items[0];
    }
};

dbMock.models.ChartOfAccount = {
    countDocuments: async () => 1,
    findOne: () => ({ lean: () => ({ _id: "coa_test" }) }),
    find: () => ({ lean: () => [] }),
    insertMany: async () => {}
};
dbMock.models.FinancialAccount = {
    findOne: () => ({ sort: () => ({ lean: () => ({ _id: "fa_test", accountName: "Test Bank" }) }) }),
    find: () => ({ lean: () => [] })
};
dbMock.models.JournalEntry = {
    create: async (docs) => {
        let items = Array.isArray(docs) ? docs : [docs];
        journalStore.push(...items);
        return items;
    }
};
// Both BillingAudit and AuditModel depending on what audit uses
dbMock.models.BillingAudit = {
    create: async (docs) => { auditStore.push(docs); return docs; }
};
dbMock.models.AuditModel = {
    create: async (docs) => { auditStore.push(docs); return docs; }
};

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
    if (path.includes('payment.model') || path.includes('billing.model') || path.includes('ledger.model') || path.includes('reconciliation.model') || path.includes('billingAudit.model')) {
        let orig = originalRequire.apply(this, arguments);
        for (let key in orig) {
            if (key.startsWith('get')) {
                orig[key] = () => dbMock.models;
            }
        }
        return orig;
    }
    if (path.includes('ledgerPosting.service')) {
        return {
            autoPost: async (label, fn) => { 
                auditStore.push({ label: 'ledger_auto_post' }); 
            },
            postConfirmedCollection: async () => {}
        };
    }
    if (path.includes('billingAudit.service')) {
        return {
            logBillingAction: async (args) => auditStore.push(args),
            getBillingAuditModel: () => dbMock.models.BillingAudit
        }
    }
    return originalRequire.apply(this, arguments);
};

const PaymentServicePatched = require('e:/MSquare/MySocietySuite/BE/src/modules/payment/payment.service.js');

function resetMocks() {
    paymentsStore.length = 0;
    invoicesStore.length = 0;
    receiptsStore.length = 0;
    advanceStore.length = 0;
    auditStore.length = 0;
    invoicePaymentsStore.length = 0;
    journalStore.length = 0;
}

async function runTests() {
    console.log("Running Payment Workflow Tests...");
    resetMocks();

    try {
        console.log("Test A: Rs. 5000 invoice, Rs. 5000 online payment");
        let invId = "inv_1";
        invoicesStore.push({ _id: invId, societyId: "soc_1", flatId: "flat_1", totalAmount: 5000, fineAmount: 0, paidAmount: 0, status: "UNPAID" });
        paymentsStore.push({ _id: "pay_1", societyId: "soc_1", gatewayOrderId: "order_1", amount: 5000, paymentStatus: "INITIATED", invoiceId: invId });
        
        let res = await PaymentServicePatched.verifyOnlinePayment({
            db: dbMock, societyId: "soc_1", userId: "user_1", razorpay_order_id: "order_1", razorpay_payment_id: "txn_1", razorpay_signature: null
        });
        
        assert.strictEqual(res.payment.paymentStatus, "SUCCESS");
        assert.strictEqual(invoicesStore[0].status, "PAID");
        assert.strictEqual(receiptsStore.length, 1);
        console.log("✔ Test A Passed");

        console.log("Test B: Duplicate webhook");
        let res2 = await PaymentServicePatched.verifyOnlinePayment({
            db: dbMock, societyId: "soc_1", userId: "user_1", razorpay_order_id: "order_1", razorpay_payment_id: "txn_1", razorpay_signature: null
        });
        assert.strictEqual(res2.payment.paymentStatus, "SUCCESS");
        assert.strictEqual(receiptsStore.length, 1);
        console.log("✔ Test B Passed");

        resetMocks();

        console.log("Test C: Partial Rs. 3000");
        invoicesStore.push({ _id: "inv_2", societyId: "soc_1", flatId: "flat_1", totalAmount: 5000, fineAmount: 0, paidAmount: 0, status: "UNPAID" });
        paymentsStore.push({ _id: "pay_2", societyId: "soc_1", gatewayOrderId: "order_2", amount: 3000, paymentStatus: "INITIATED", invoiceId: "inv_2" });
        
        await PaymentServicePatched.verifyOnlinePayment({
            db: dbMock, societyId: "soc_1", userId: "user_1", razorpay_order_id: "order_2", razorpay_payment_id: "txn_2"
        });
        
        assert.strictEqual(invoicesStore[0].status, "PARTIALLY_PAID");
        assert.strictEqual(invoicesStore[0].paidAmount, 3000);
        console.log("✔ Test C Passed");

        resetMocks();

        console.log("Test D: Overpayment Rs. 6000 on Rs. 5000 invoice");
        invoicesStore.push({ _id: "inv_3", societyId: "soc_1", flatId: "flat_1", totalAmount: 5000, fineAmount: 0, paidAmount: 0, status: "UNPAID" });
        paymentsStore.push({ _id: "pay_3", societyId: "soc_1", gatewayOrderId: "order_3", amount: 6000, paymentStatus: "INITIATED", invoiceId: "inv_3" });
        
        await PaymentServicePatched.verifyOnlinePayment({
            db: dbMock, societyId: "soc_1", userId: "user_1", razorpay_order_id: "order_3", razorpay_payment_id: "txn_3"
        });
        
        assert.strictEqual(invoicesStore[0].status, "PAID");
        assert.strictEqual(advanceStore.length, 1);
        assert.strictEqual(advanceStore[0].advanceBalance, 1000);
        console.log("✔ Test D Passed");

        resetMocks();

        console.log("Test F: Unmatched payment (offline)");
        let resF = await PaymentServicePatched.recordOfflinePayment({
            db: dbMock, societyId: "soc_1", recordedBy: "user_1", flatId: "flat_unmatched", amount: 2000, paymentMode: "CASH"
        });
        assert.strictEqual(resF.payment.invoiceId, null);
        console.log("✔ Test F Passed");

        console.log("All mocked unit tests passed successfully.");
    } catch(err) {
        console.error("Test Failed!", err);
        process.exit(1);
    }
}

runTests();
