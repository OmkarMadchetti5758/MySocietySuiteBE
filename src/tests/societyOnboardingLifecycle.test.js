"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { ROLES, SOCIETY_STATUS, USER_STATUS } = require("../common/constants");
const AppError = require("../common/AppError");

/**
 * Society Onboarding Lifecycle & Activation Inconsistency Test Suite
 *
 * Covers:
 *  1. Society lifecycle state guards in SuperAdminRepository (pending, invited admin, active, trial, inactive)
 *  2. Query enrichment (adminStatus, isOnboarded)
 *  3. Invite validation (unexpired, expired, used, suspended, already active, prematurely active society recovery)
 *  4. Password setup and activation (trial transition, user active state, token used)
 *  5. Resend invitation (old token invalidation, secure 24h token generation)
 *  6. Tenant login & isolation (invited account lockout, activated login, wrong credentials, multi-tenant requirement)
 */
async function runSocietyOnboardingLifecycleTests() {
    console.log("===============================================================");
    console.log("Running Society Onboarding Lifecycle & Inconsistency Tests...");
    console.log("===============================================================\n");

    let testCount = 0;
    const pass = (name) => {
        testCount++;
        console.log(`  ✓ [TEST ${testCount}] ${name}`);
    };

    // ─────────────────────────────────────────────────────────────
    // In-Memory Test Store
    // ─────────────────────────────────────────────────────────────
    const societies = [];
    const users = [];
    const inviteTokens = [];
    const userSocietyMappings = [];
    let sentEmails = [];

    // Helper: Reset store
    const resetStore = () => {
        societies.length = 0;
        users.length = 0;
        inviteTokens.length = 0;
        userSocietyMappings.length = 0;
        sentEmails.length = 0;
    };

    // Helper: Model generator
    const createMockSocietyModel = () => {
        return {
            findById(id) {
                const doc = societies.find((s) => String(s._id) === String(id));
                const res = doc ? {
                    ...doc,
                    save: async function () {
                        const idx = societies.findIndex((s) => String(s._id) === String(this._id));
                        if (idx !== -1) societies[idx] = { ...this };
                        return this;
                    },
                    toObject: function () { return { ...this }; }
                } : null;

                const p = Promise.resolve(res);
                p.populate = () => ({
                    lean: async () => (res ? { ...res } : null)
                });
                p.select = () => ({
                    lean: async () => (res ? { ...res } : null)
                });
                p.lean = async () => (res ? { ...res } : null);
                return p;
            },
            findOne(query) {
                const doc = societies.find((s) => {
                    if (query._id && String(s._id) !== String(query._id)) return false;
                    if (query.status && s.status !== query.status) return false;
                    return true;
                });
                const res = doc ? { ...doc } : null;
                const p = Promise.resolve(res);
                p.lean = async () => res;
                return p;
            },
            find(query = {}) {
                const matchRegex = (str, pattern, options) => {
                    if (!pattern) return true;
                    if (pattern instanceof RegExp) return pattern.test(str || "");
                    return new RegExp(pattern, options || "i").test(str || "");
                };
                let list = societies.filter((s) => {
                    if (query.name && query.name.$regex && !matchRegex(s.name, query.name.$regex, query.name.$options)) {
                        return false;
                    }
                    if (query.status && s.status !== query.status) return false;
                    if (query.$and && Array.isArray(query.$and)) {
                        for (const cond of query.$and) {
                            if (cond.name && cond.name.$regex && !matchRegex(s.name, cond.name.$regex, cond.name.$options)) return false;
                            if (cond.status) {
                                if (cond.status.$in && !cond.status.$in.includes(s.status)) return false;
                                if (typeof cond.status === "string" && s.status !== cond.status) return false;
                            }
                            if (cond._id) {
                                if (cond._id.$nin) {
                                    const nins = cond._id.$nin.map(String);
                                    if (nins.includes(String(s._id))) return false;
                                }
                                if (cond._id.$in) {
                                    const ins = cond._id.$in.map(String);
                                    if (!ins.includes(String(s._id))) return false;
                                }
                            }
                            if (cond.adminId) {
                                if (cond.adminId.$nin) {
                                    const nins = cond.adminId.$nin.map(String);
                                    if (s.adminId && nins.includes(String(s.adminId))) return false;
                                }
                                if (cond.adminId.$in) {
                                    const ins = cond.adminId.$in.map(String);
                                    if (!s.adminId || !ins.includes(String(s.adminId))) return false;
                                }
                            }
                            if (cond.subscriptionPlanId) {
                                if (cond.subscriptionPlanId.$ne !== undefined && s.subscriptionPlanId == null) return false;
                                if (cond.subscriptionPlanId instanceof mongoose.Types.ObjectId && String(s.subscriptionPlanId) !== String(cond.subscriptionPlanId)) return false;
                            }
                            if (cond.$or) {
                                const orMatch = cond.$or.some(clause => {
                                    if (clause.subscriptionPlanId === null && !s.subscriptionPlanId) return true;
                                    if (clause.subscriptionPlanId && clause.subscriptionPlanId.$exists === false && !s.subscriptionPlanId) return true;
                                    if (clause.status) {
                                        if (clause.status.$in && clause.status.$in.includes(s.status)) return true;
                                        if (typeof clause.status === "string" && clause.status === s.status) return true;
                                    }
                                    if (clause._id && clause._id.$in) {
                                        const ins = clause._id.$in.map(String);
                                        if (ins.includes(String(s._id))) return true;
                                    }
                                    if (clause.adminId && clause.adminId.$in) {
                                        const ins = clause.adminId.$in.map(String);
                                        if (s.adminId && ins.includes(String(s.adminId))) return true;
                                    }
                                    return false;
                                });
                                if (!orMatch) return false;
                            }
                        }
                    }
                    return true;
                });
                return {
                    populate: () => ({
                        sort: () => ({
                            skip: (skipCount) => ({
                                limit: (limitCount) => ({
                                    lean: async () => list.slice(skipCount, skipCount + limitCount).map((item) => ({ ...item }))
                                })
                            })
                        })
                    }),
                    lean: async () => list.map((item) => ({ ...item }))
                };
            },
            countDocuments: async (query = {}) => {
                const matchRegex = (str, pattern, options) => {
                    if (!pattern) return true;
                    if (pattern instanceof RegExp) return pattern.test(str || "");
                    return new RegExp(pattern, options || "i").test(str || "");
                };
                let list = societies.filter((s) => {
                    if (query.name && query.name.$regex && !matchRegex(s.name, query.name.$regex, query.name.$options)) {
                        return false;
                    }
                    if (query.status && s.status !== query.status) return false;
                    if (query.$and && Array.isArray(query.$and)) {
                        for (const cond of query.$and) {
                            if (cond.name && cond.name.$regex && !matchRegex(s.name, cond.name.$regex, cond.name.$options)) return false;
                            if (cond.status) {
                                if (cond.status.$in && !cond.status.$in.includes(s.status)) return false;
                                if (typeof cond.status === "string" && s.status !== cond.status) return false;
                            }
                            if (cond._id) {
                                if (cond._id.$nin) {
                                    const nins = cond._id.$nin.map(String);
                                    if (nins.includes(String(s._id))) return false;
                                }
                                if (cond._id.$in) {
                                    const ins = cond._id.$in.map(String);
                                    if (!ins.includes(String(s._id))) return false;
                                }
                            }
                            if (cond.adminId) {
                                if (cond.adminId.$nin) {
                                    const nins = cond.adminId.$nin.map(String);
                                    if (s.adminId && nins.includes(String(s.adminId))) return false;
                                }
                                if (cond.adminId.$in) {
                                    const ins = cond.adminId.$in.map(String);
                                    if (!s.adminId || !ins.includes(String(s.adminId))) return false;
                                }
                            }
                            if (cond.subscriptionPlanId) {
                                if (cond.subscriptionPlanId.$ne !== undefined && s.subscriptionPlanId == null) return false;
                                if (cond.subscriptionPlanId instanceof mongoose.Types.ObjectId && String(s.subscriptionPlanId) !== String(cond.subscriptionPlanId)) return false;
                            }
                            if (cond.$or) {
                                const orMatch = cond.$or.some(clause => {
                                    if (clause.subscriptionPlanId === null && !s.subscriptionPlanId) return true;
                                    if (clause.subscriptionPlanId && clause.subscriptionPlanId.$exists === false && !s.subscriptionPlanId) return true;
                                    if (clause.status) {
                                        if (clause.status.$in && clause.status.$in.includes(s.status)) return true;
                                        if (typeof clause.status === "string" && clause.status === s.status) return true;
                                    }
                                    if (clause._id && clause._id.$in) {
                                        const ins = clause._id.$in.map(String);
                                        if (ins.includes(String(s._id))) return true;
                                    }
                                    if (clause.adminId && clause.adminId.$in) {
                                        const ins = clause.adminId.$in.map(String);
                                        if (s.adminId && ins.includes(String(s.adminId))) return true;
                                    }
                                    return false;
                                });
                                if (!orMatch) return false;
                            }
                        }
                    }
                    return true;
                });
                return list.length;
            }
        };
    };

    const createMockUserModel = () => {
        return {
            findById(id) {
                const doc = users.find((u) => String(u._id) === String(id));
                const res = doc ? {
                    ...doc,
                    save: async function () {
                        const idx = users.findIndex((u) => String(u._id) === String(this._id));
                        if (this.password && !this.password.startsWith("$2a$")) {
                            this.password = bcrypt.hashSync(this.password, 10);
                        }
                        if (idx !== -1) users[idx] = { ...this };
                        return this;
                    },
                    comparePassword: async function (candidate) {
                        if (!this.password) return false;
                        return bcrypt.compare(candidate, this.password);
                    },
                    toObject: function () { return { ...this }; }
                } : null;

                const p = Promise.resolve(res);
                p.select = () => ({
                    lean: async () => (res ? { ...res } : null)
                });
                p.lean = async () => (res ? { ...res } : null);
                return p;
            },
            findOne(query) {
                const doc = users.find((u) => {
                    if (query._id && String(u._id) !== String(query._id)) return false;
                    if (query.societyId && String(u.societyId) !== String(query.societyId)) return false;
                    if (query.email && u.email.toLowerCase() !== query.email.toLowerCase()) return false;
                    if (query.mobile && u.mobile !== query.mobile) return false;
                    if (query.role && u.role !== query.role) return false;
                    if (query.status && u.status !== query.status) return false;
                    return true;
                });
                const res = doc ? {
                    ...doc,
                    save: async function () {
                        const idx = users.findIndex((u) => String(u._id) === String(this._id));
                        if (this.password && !this.password.startsWith("$2a$")) {
                            this.password = bcrypt.hashSync(this.password, 10);
                        }
                        if (idx !== -1) users[idx] = { ...this };
                        return this;
                    },
                    comparePassword: async function (candidate) {
                        if (!this.password) return false;
                        return bcrypt.compare(candidate, this.password);
                    },
                    toObject: function () { return { ...this }; }
                } : null;

                const p = Promise.resolve(res);
                p.select = () => ({
                    lean: async () => (res ? { ...res } : null)
                });
                p.lean = async () => (res ? { ...res } : null);
                return p;
            },
            find(query) {
                let list = users.filter((u) => {
                    if (query._id && query._id.$in) {
                        const ids = query._id.$in.map(String);
                        if (!ids.includes(String(u._id))) return false;
                    }
                    if (query.societyId && query.societyId.$in) {
                        const ids = query.societyId.$in.map(String);
                        if (!ids.includes(String(u.societyId))) return false;
                    }
                    if (query.role && u.role !== query.role) return false;
                    if (query.status) {
                        if (query.status.$in && !query.status.$in.includes(u.status)) return false;
                        if (typeof query.status === "string" && u.status !== query.status) return false;
                    }
                    return true;
                });
                return {
                    select: (fields) => ({
                        lean: async () => list.map((u) => ({ ...u }))
                    }),
                    lean: async () => list.map((u) => ({ ...u }))
                };
            },
            async findByIdAndUpdate(id, update) {
                const doc = users.find((u) => String(u._id) === String(id));
                if (doc) {
                    if (update.$unset && update.$unset.refreshToken) delete doc.refreshToken;
                    if (update.refreshToken) doc.refreshToken = update.refreshToken;
                    if (update.lastLogin) doc.lastLogin = update.lastLogin;
                }
                return doc;
            }
        };
    };

    const createMockInviteTokenModel = () => {
        return {
            hashToken(token) {
                return crypto.createHash("sha256").update(token).digest("hex");
            },
            generateToken() {
                const plainToken = crypto.randomBytes(32).toString("hex");
                const tokenHash = crypto.createHash("sha256").update(plainToken).digest("hex");
                return { plainToken, tokenHash };
            },
            async findOne(query) {
                const doc = inviteTokens.find((t) => {
                    if (query.tokenHash && t.tokenHash !== query.tokenHash) return false;
                    return true;
                });
                if (!doc) return null;
                return {
                    ...doc,
                    save: async function () {
                        const idx = inviteTokens.findIndex((t) => String(t._id) === String(this._id));
                        if (idx !== -1) inviteTokens[idx] = { ...this };
                        return this;
                    }
                };
            },
            async create(doc) {
                const item = {
                    _id: new mongoose.Types.ObjectId(),
                    used: false,
                    ...doc,
                    createdAt: new Date()
                };
                inviteTokens.push(item);
                return item;
            },
            async updateMany(query, update) {
                let count = 0;
                for (const t of inviteTokens) {
                    let match = true;
                    if (query.adminId && String(t.adminId) !== String(query.adminId)) match = false;
                    if (query.used !== undefined && t.used !== query.used) match = false;
                    if (match) {
                        if (update.$set) Object.assign(t, update.$set);
                        count++;
                    }
                }
                return { modifiedCount: count };
            }
        };
    };

    const createMockMappingModel = () => {
        return {
            async updateMany(query, update) {
                for (const m of userSocietyMappings) {
                    if (query.societyId && String(m.societyId) === String(query.societyId)) {
                        if (update.$set) Object.assign(m, update.$set);
                    }
                }
                return { acknowledged: true };
            },
            find(query) {
                const list = userSocietyMappings.filter((m) => {
                    if (query.identifier && m.identifier !== query.identifier) return false;
                    if (query.societyId && String(m.societyId) !== String(query.societyId)) return false;
                    if (query.userId && String(m.userId) !== String(query.userId)) return false;
                    return true;
                });
                const p = Promise.resolve(list);
                p.lean = async () => list;
                return p;
            },
            async insertMany(docs) {
                for (const d of docs) {
                    userSocietyMappings.push({ ...d });
                }
                return docs;
            },
            findOne(query) {
                const doc = userSocietyMappings.find((m) => {
                    if (query.societyId && String(m.societyId) !== String(query.societyId)) return false;
                    if (query.userId && String(m.userId) !== String(query.userId)) return false;
                    if (query.identifier && m.identifier !== query.identifier) return false;
                    return true;
                });
                const res = doc ? { ...doc } : null;
                const p = Promise.resolve(res);
                p.lean = async () => res;
                return p;
            }
        };
    };

    // Mock master and operations connection
    const mockMasterDb = {
        model(name) {
            if (name === "Society") return createMockSocietyModel();
            if (name === "InviteToken") return createMockInviteTokenModel();
            if (name === "UserSocietyMapping") return createMockMappingModel();
            if (name === "SubscriptionPlan") {
                return {
                    find: () => ({ sort: () => ({ lean: async () => [] }) }),
                    findById: async () => null,
                    findOne: async () => null
                };
            }
            throw new Error(`Unmocked master model: ${name}`);
        }
    };

    const mockOpsDb = {
        model(name) {
            if (name === "User") return createMockUserModel();
            if (name === "Staff" || name === "ManagerAssignment" || name === "Vendor") {
                return {
                    updateOne: async () => ({ acknowledged: true }),
                    findOne: async () => null
                };
            }
            throw new Error(`Unmocked ops model: ${name}`);
        }
    };

    // Override connections in require cache
    const masterDbModule = require("../config/masterDb");
    masterDbModule.getMasterConnection = () => mockMasterDb;

    const opsDbModule = require("../config/operationsDb");
    opsDbModule.getOperationsConnection = () => mockOpsDb;

    // Spy on email service
    const emailService = require("../services/email.service");
    const originalSendInviteEmail = emailService.sendInviteEmail;
    emailService.sendInviteEmail = async (opts) => {
        sentEmails.push(opts);
        return true;
    };

    const SuperAdminRepository = require("../modules/superAdmin/superAdmin.repository");
    const AuthService = require("../modules/auth/auth.service");

    try {
        // =========================================================================
        // SECTION 1: SuperAdminRepository Status Mutation Lifecycle Guards
        // =========================================================================
        console.log("--- Section 1: SuperAdminRepository Lifecycle Protection ---");
        resetStore();

        const pendingSocId = new mongoose.Types.ObjectId();
        const pendingAdminId = new mongoose.Types.ObjectId();
        societies.push({
            _id: pendingSocId,
            name: "Pending Soc",
            status: SOCIETY_STATUS.PENDING_VERIFICATION,
            adminId: pendingAdminId,
            contactEmail: "pendingadmin@example.com",
            address: { city: "Pune", state: "MH" }
        });
        users.push({
            _id: pendingAdminId,
            societyId: pendingSocId,
            name: "Pending Admin",
            email: "pendingadmin@example.com",
            mobile: "9876543210",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED,
            isActive: false
        });

        // Test 1: updateSocietyStatus rejects when society status is pending_verification
        await assert.rejects(
            async () => SuperAdminRepository.updateSocietyStatus(pendingSocId, SOCIETY_STATUS.ACTIVE),
            (err) => {
                assert(err instanceof AppError, "Should throw AppError");
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("Cannot change status of a pending society"));
                return true;
            },
            "Should reject status change on pending_verification society"
        );
        pass("SuperAdminRepository.updateSocietyStatus rejects pending_verification society");

        // Test 2: updateSocietyStatus rejects when society status is pending_approval
        societies[0].status = SOCIETY_STATUS.PENDING_APPROVAL;
        await assert.rejects(
            async () => SuperAdminRepository.updateSocietyStatus(pendingSocId, SOCIETY_STATUS.ACTIVE),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("Cannot change status of a pending society"));
                return true;
            },
            "Should reject status change on pending_approval society"
        );
        pass("SuperAdminRepository.updateSocietyStatus rejects pending_approval society");

        // Test 3: updateSocietyStatus rejects when society is active but admin is STILL invited
        societies[0].status = SOCIETY_STATUS.ACTIVE; // corrupted/inconsistent state like SUKRUTI
        await assert.rejects(
            async () => SuperAdminRepository.updateSocietyStatus(pendingSocId, SOCIETY_STATUS.INACTIVE),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("whose admin has not completed the onboarding invitation flow"));
                return true;
            },
            "Should reject status change if admin is still invited"
        );
        pass("SuperAdminRepository.updateSocietyStatus rejects change when admin user is 'invited'");

        // Test 4: updateSociety rejects activating society if admin is still invited
        await assert.rejects(
            async () => SuperAdminRepository.updateSociety(pendingSocId, {
                societyDetails: { status: SOCIETY_STATUS.ACTIVE }
            }),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("Cannot activate a society whose admin has not completed"));
                return true;
            },
            "updateSociety should reject setting status=active when admin is invited"
        );
        pass("SuperAdminRepository.updateSociety rejects setting status='active' when admin is 'invited'");

        // Test 5: updateSocietyStatus succeeds once admin is active
        users[0].status = USER_STATUS.ACTIVE;
        users[0].isActive = true;
        users[0].password = "$2a$10$hashedpasswordstring";
        const updated = await SuperAdminRepository.updateSocietyStatus(pendingSocId, SOCIETY_STATUS.INACTIVE);
        assert.strictEqual(updated.status, SOCIETY_STATUS.INACTIVE);
        assert.strictEqual(societies[0].status, SOCIETY_STATUS.INACTIVE);
        pass("SuperAdminRepository.updateSocietyStatus allows activation/deactivation once admin is 'active'");

        // Test 6: getPaginatedSocieties returns adminStatus and isOnboarded correctly
        const resultActive = await SuperAdminRepository.getPaginatedSocieties();
        const socInList = resultActive.societies.find((s) => String(s._id) === String(pendingSocId));
        assert.strictEqual(socInList.adminStatus, "active");
        assert.strictEqual(socInList.isOnboarded, true);

        // Switch admin back to invited
        users[0].status = USER_STATUS.INVITED;
        const resultInvited = await SuperAdminRepository.getPaginatedSocieties();
        const socInvited = resultInvited.societies.find((s) => String(s._id) === String(pendingSocId));
        assert.strictEqual(socInvited.adminStatus, "invited");
        assert.strictEqual(socInvited.isOnboarded, false);
        pass("SuperAdminRepository.getPaginatedSocieties enriches rows with adminStatus and isOnboarded");

        // Test 6b: getPaginatedSocieties filters by status and plan
        societies.push({
            _id: new mongoose.Types.ObjectId(),
            name: "Trial Society Alpha",
            status: SOCIETY_STATUS.TRIAL,
            subscriptionPlanId: null,
            adminId: null
        });
        societies.push({
            _id: new mongoose.Types.ObjectId(),
            name: "Premium Society Beta",
            status: SOCIETY_STATUS.ACTIVE,
            subscriptionPlanId: new mongoose.Types.ObjectId(),
            adminId: null
        });

        // Filter by status=trial
        const filteredTrial = await SuperAdminRepository.getPaginatedSocieties(1, 10, "", { status: "trial" });
        assert(filteredTrial.societies.every((s) => s.status === "trial"), "All returned societies must be trial");

        // Filter by plan=premium
        const filteredPremium = await SuperAdminRepository.getPaginatedSocieties(1, 10, "", { plan: "premium" });
        assert(filteredPremium.societies.every((s) => s.subscriptionPlanId != null), "All returned societies must have a plan");

        // Filter by plan=trial
        const filteredPlanTrial = await SuperAdminRepository.getPaginatedSocieties(1, 10, "", { plan: "trial" });
        assert(filteredPlanTrial.societies.every((s) => !s.subscriptionPlanId), "All returned societies must have no plan");

        pass("SuperAdminRepository.getPaginatedSocieties applies status and plan filters correctly");

        // Test 7c: Regression test for Pending Verification filter bug with inconsistent onboarding (SUKRUTI scenario)
        // Setup:
        // 1. Sukruti: status="active", but admin has status="invited" (incomplete onboarding)
        // 2. PendingSoc: status="pending_approval", admin has status="invited"
        // 3. ActiveSoc: status="active", admin has status="active"
        // 4. InactiveSoc: status="inactive"
        const sukrutiSocId = new mongoose.Types.ObjectId();
        const sukrutiAdminId = new mongoose.Types.ObjectId();
        societies.push({
            _id: sukrutiSocId,
            name: "SUKRUTI",
            status: SOCIETY_STATUS.ACTIVE, // Premature active state
            subscriptionPlanId: new mongoose.Types.ObjectId(),
            adminId: sukrutiAdminId
        });
        users.push({
            _id: sukrutiAdminId,
            societyId: sukrutiSocId,
            name: "Balaji Borude",
            email: "balajiborude25@gmail.com",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED // Incomplete admin onboarding
        });

        const pendingApprovalSocId = new mongoose.Types.ObjectId();
        const pendingApprovalAdminId = new mongoose.Types.ObjectId();
        societies.push({
            _id: pendingApprovalSocId,
            name: "Approval Pending Society",
            status: SOCIETY_STATUS.PENDING_APPROVAL,
            subscriptionPlanId: null,
            adminId: pendingApprovalAdminId
        });
        users.push({
            _id: pendingApprovalAdminId,
            societyId: pendingApprovalSocId,
            name: "Pending Admin",
            email: "pending@society.com",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED
        });

        const activeOnboardedSocId = new mongoose.Types.ObjectId();
        const activeOnboardedAdminId = new mongoose.Types.ObjectId();
        societies.push({
            _id: activeOnboardedSocId,
            name: "Fully Active Society",
            status: SOCIETY_STATUS.ACTIVE,
            subscriptionPlanId: new mongoose.Types.ObjectId(),
            adminId: activeOnboardedAdminId
        });
        users.push({
            _id: activeOnboardedAdminId,
            societyId: activeOnboardedSocId,
            name: "Active Admin",
            email: "active@society.com",
            role: ROLES.ADMIN,
            status: USER_STATUS.ACTIVE
        });

        // 1. Filter by status: pending_verification MUST include SUKRUTI and pending approval society
        const pendingFilterResult = await SuperAdminRepository.getPaginatedSocieties(1, 10, "", { status: "pending_verification" });
        const pendingReturnedIds = pendingFilterResult.societies.map((s) => String(s._id));
        assert(
            pendingReturnedIds.includes(String(sukrutiSocId)),
            "SUKRUTI with status='active' but invited admin must be returned under 'pending_verification' filter"
        );
        assert(
            pendingReturnedIds.includes(String(pendingApprovalSocId)),
            "pending_approval society must be returned under 'pending_verification' filter"
        );
        assert(
            !pendingReturnedIds.includes(String(activeOnboardedSocId)),
            "Fully active onboarded society must NOT be returned under 'pending_verification' filter"
        );

        // 2. Filter by status: active MUST exclude SUKRUTI (since its admin is invited)
        const activeFilterResult = await SuperAdminRepository.getPaginatedSocieties(1, 10, "", { status: "active" });
        const activeReturnedIds = activeFilterResult.societies.map((s) => String(s._id));
        assert(
            !activeReturnedIds.includes(String(sukrutiSocId)),
            "SUKRUTI must NOT appear under 'active' filter while admin onboarding is incomplete"
        );
        assert(
            activeReturnedIds.includes(String(activeOnboardedSocId)),
            "Fully active onboarded society must appear under 'active' filter"
        );

        // 3. Search and pagination along with pending_verification filter
        const searchResult = await SuperAdminRepository.getPaginatedSocieties(1, 10, "SUKRUTI", { status: "pending_verification" });
        assert.strictEqual(searchResult.total, 1);
        assert.strictEqual(String(searchResult.societies[0]._id), String(sukrutiSocId));
        assert.strictEqual(searchResult.societies[0].adminStatus, "invited");
        assert.strictEqual(searchResult.societies[0].isOnboarded, false);

        pass("SuperAdminRepository.getPaginatedSocieties Pending Verification filter correctly returns incomplete onboarding societies and excludes them from Active");

        // =========================================================================
        // SECTION 2: Invite Validation (validateInvite) & Premature Active Recovery
        // =========================================================================
        console.log("\n--- Section 2: Invite Validation & Inconsistent Recovery ---");
        resetStore();

        const testSocId = new mongoose.Types.ObjectId();
        const testAdminId = new mongoose.Types.ObjectId();
        const validPlainToken = "valid_secure_token_hex_1234567890abcdef";
        const validHash = crypto.createHash("sha256").update(validPlainToken).digest("hex");

        societies.push({
            _id: testSocId,
            name: "Sukruti Housing",
            status: SOCIETY_STATUS.ACTIVE, // Prematurely active!
            adminId: testAdminId,
            contactEmail: "admin@sukruti.com",
            address: { city: "Nashik", state: "MH" }
        });
        users.push({
            _id: testAdminId,
            societyId: testSocId,
            name: "Balaji Admin",
            email: "admin@sukruti.com",
            mobile: "9579704298",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED, // Still invited
            isActive: false,
            password: null
        });

        const futureDate = new Date();
        futureDate.setHours(futureDate.getHours() + 12);
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: validHash,
            societyId: testSocId,
            adminId: testAdminId,
            used: false,
            expiresAt: futureDate
        });

        // Test 7: validateInvite SUCCEEDS even when society was prematurely marked active
        const validated = await AuthService.validateInvite(validPlainToken);
        assert.strictEqual(validated.adminEmail, "admin@sukruti.com");
        assert.strictEqual(validated.societyName, "Sukruti Housing");
        assert.strictEqual(validated.userRole, ROLES.ADMIN);
        pass("AuthService.validateInvite allows invited admin to validate invite even if society is prematurely 'active'");

        // Test 8: validateInvite succeeds when society is pending_verification
        societies[0].status = SOCIETY_STATUS.PENDING_VERIFICATION;
        const validatedPending = await AuthService.validateInvite(validPlainToken);
        assert.strictEqual(validatedPending.societyId, testSocId.toString());
        pass("AuthService.validateInvite validates pending_verification society");

        // Test 9: validateInvite succeeds when society is pending_approval
        societies[0].status = SOCIETY_STATUS.PENDING_APPROVAL;
        const validatedApproval = await AuthService.validateInvite(validPlainToken);
        assert.strictEqual(validatedApproval.societyId, testSocId.toString());
        pass("AuthService.validateInvite validates pending_approval society");

        // Test 10: validateInvite rejects if token is expired
        const expiredPlain = "expired_token_123";
        const expiredHash = crypto.createHash("sha256").update(expiredPlain).digest("hex");
        const pastDate = new Date();
        pastDate.setHours(pastDate.getHours() - 1);
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: expiredHash,
            societyId: testSocId,
            adminId: testAdminId,
            used: false,
            expiresAt: pastDate
        });
        await assert.rejects(
            async () => AuthService.validateInvite(expiredPlain),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("expired"));
                return true;
            },
            "Should reject expired token"
        );
        pass("AuthService.validateInvite rejects expired invite link");

        // Test 11: validateInvite rejects if token already used
        const usedPlain = "used_token_123";
        const usedHash = crypto.createHash("sha256").update(usedPlain).digest("hex");
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: usedHash,
            societyId: testSocId,
            adminId: testAdminId,
            used: true,
            expiresAt: futureDate
        });
        await assert.rejects(
            async () => AuthService.validateInvite(usedPlain),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("already been used"));
                return true;
            },
            "Should reject used token"
        );
        pass("AuthService.validateInvite rejects already used invite link");

        // Test 12: validateInvite rejects if society is suspended
        societies[0].status = SOCIETY_STATUS.SUSPENDED;
        await assert.rejects(
            async () => AuthService.validateInvite(validPlainToken),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("suspended"));
                return true;
            },
            "Should reject suspended society"
        );
        pass("AuthService.validateInvite rejects invite when society is suspended");

        // Test 13: validateInvite rejects if admin account already active
        societies[0].status = SOCIETY_STATUS.TRIAL;
        users[0].status = USER_STATUS.ACTIVE;
        await assert.rejects(
            async () => AuthService.validateInvite(validPlainToken),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("already been activated"));
                return true;
            },
            "Should reject already activated admin"
        );
        pass("AuthService.validateInvite rejects invite when admin user is already active");

        // =========================================================================
        // SECTION 3: Invitation Activation & Password Setup (activateInvite)
        // =========================================================================
        console.log("\n--- Section 3: Activation & Password Setup Lifecycle ---");
        resetStore();

        const actSocId = new mongoose.Types.ObjectId();
        const actAdminId = new mongoose.Types.ObjectId();
        const actPlainToken = "act_secure_token_abcdef123456";
        const actTokenHash = crypto.createHash("sha256").update(actPlainToken).digest("hex");

        societies.push({
            _id: actSocId,
            name: "Sukruti Phase 1",
            status: SOCIETY_STATUS.PENDING_VERIFICATION,
            adminId: actAdminId,
            contactEmail: "balaji@example.com",
            address: { city: "Nashik", state: "MH" }
        });
        users.push({
            _id: actAdminId,
            societyId: actSocId,
            name: "Balaji Borude",
            email: "balaji@example.com",
            mobile: "9579704298",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED,
            isActive: false,
            password: null
        });
        userSocietyMappings.push({
            societyId: actSocId,
            userId: actAdminId,
            identifier: "balaji@example.com",
            roleKeys: ["admin"],
            status: "active"
        });
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: actTokenHash,
            societyId: actSocId,
            adminId: actAdminId,
            used: false,
            expiresAt: futureDate
        });

        // Test 14: activateInvite validates minimum password length
        await assert.rejects(
            async () => AuthService.activateInvite(actPlainToken, "12345"),
            (err) => {
                assert.strictEqual(err.statusCode, 400);
                assert(err.message.includes("at least 6 characters"));
                return true;
            },
            "Password under 6 chars should be rejected"
        );
        pass("AuthService.activateInvite enforces minimum password length (>= 6 chars)");

        // Test 15: activateInvite successfully sets password, activates user, marks token used, transitions society to trial
        const activatedResult = await AuthService.activateInvite(actPlainToken, "StrongSecurePassword@123");
        assert.ok(activatedResult.accessToken, "Should return accessToken");
        assert.ok(activatedResult.refreshToken, "Should return refreshToken");
        assert.strictEqual(activatedResult.user.status, "active");
        assert.strictEqual(activatedResult.user.password, undefined, "Password must not be exposed");

        // Verify database state changes
        assert.strictEqual(users[0].status, USER_STATUS.ACTIVE, "User status must be 'active'");
        assert.strictEqual(users[0].isActive, true, "User isActive must be true");
        assert.ok(bcrypt.compareSync("StrongSecurePassword@123", users[0].password), "Password must be a valid bcrypt hash of the input password");
        assert.strictEqual(inviteTokens[0].used, true, "Invite token must be marked used");
        assert.strictEqual(societies[0].status, SOCIETY_STATUS.TRIAL, "Pending society must transition to trial");
        pass("AuthService.activateInvite transitions pending society to trial and activates admin without exposing password hash");

        // =========================================================================
        // SECTION 4: Resend Invitation (resendInvite)
        // =========================================================================
        console.log("\n--- Section 4: Resend Invitation Mechanism ---");
        resetStore();

        const resendSocId = new mongoose.Types.ObjectId();
        const resendAdminId = new mongoose.Types.ObjectId();
        societies.push({
            _id: resendSocId,
            name: "Sukruti Phase 2",
            status: SOCIETY_STATUS.PENDING_VERIFICATION,
            adminId: resendAdminId,
            contactEmail: "adminresend@sukruti.com"
        });
        users.push({
            _id: resendAdminId,
            societyId: resendSocId,
            name: "Admin Resend",
            email: "adminresend@sukruti.com",
            mobile: "9123456789",
            role: ROLES.ADMIN,
            status: USER_STATUS.INVITED,
            isActive: false
        });

        // Add 2 old unused tokens (one expired, one unexpired)
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: "old_hash_1",
            societyId: resendSocId,
            adminId: resendAdminId,
            used: false,
            expiresAt: pastDate
        });
        inviteTokens.push({
            _id: new mongoose.Types.ObjectId(),
            tokenHash: "old_hash_2",
            societyId: resendSocId,
            adminId: resendAdminId,
            used: false,
            expiresAt: futureDate
        });

        // Test 16: resendInvite invalidates prior unused tokens and generates fresh token
        const resendResult = await AuthService.resendInvite("adminresend@sukruti.com");
        assert.strictEqual(resendResult.message, "Invite resent");

        // Verify old tokens were invalidated
        assert.strictEqual(inviteTokens[0].used, true, "Old token 1 must be marked used");
        assert.strictEqual(inviteTokens[1].used, true, "Old token 2 must be marked used");

        // Verify new token exists
        assert.strictEqual(inviteTokens.length, 3, "New token must have been inserted");
        const newToken = inviteTokens[2];
        assert.strictEqual(newToken.used, false, "New token must be unused");
        assert.strictEqual(String(newToken.adminId), String(resendAdminId));
        assert.strictEqual(String(newToken.societyId), String(resendSocId));

        // Verify expiration is ~24 hours in future
        const now = new Date();
        const diffHours = (newToken.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
        assert(diffHours >= 23.9 && diffHours <= 24.1, `Expiry should be ~24h (got ${diffHours})`);

        // Verify email was sent
        assert.strictEqual(sentEmails.length, 1);
        assert.strictEqual(sentEmails[0].to, "adminresend@sukruti.com");
        assert(sentEmails[0].inviteLink.includes("/activate-account?token="));
        pass("AuthService.resendInvite invalidates prior tokens and generates secure 24h token with email");

        // Test 17: resendInvite rejects unknown or already-activated email
        await assert.rejects(
            async () => AuthService.resendInvite("unknown@example.com"),
            (err) => {
                assert.strictEqual(err.statusCode, 404);
                return true;
            },
            "Should 404 on uninvited email"
        );
        pass("AuthService.resendInvite rejects non-pending or nonexistent emails with 404");

        // =========================================================================
        // SECTION 5: Tenant Isolation & Authentication State Verification
        // =========================================================================
        console.log("\n--- Section 5: Tenant Isolation & Login State ---");

        const mockAuthRepo = require("../modules/auth/auth.repository");
        const originalFindUser = mockAuthRepo.findUserByIdentifier;
        const originalGetMappings = mockAuthRepo.getMappingsForIdentifier;
        const originalSaveRefresh = mockAuthRepo.saveRefreshToken;

        mockAuthRepo.getMappingsForIdentifier = async (ident) => {
            return userSocietyMappings.filter((m) => m.identifier === ident);
        };
        mockAuthRepo.findUserByIdentifier = async (socId, ident) => {
            const u = users.find((item) => String(item.societyId) === String(socId) && (item.email === ident || item.mobile === ident));
            if (!u) return null;
            return {
                ...u,
                comparePassword: async (candidate) => {
                    if (!u.password) return false;
                    return bcrypt.compare(candidate, u.password);
                },
                toObject: () => ({ ...u })
            };
        };
        mockAuthRepo.saveRefreshToken = async () => true;

        societies[0].status = SOCIETY_STATUS.ACTIVE;

        userSocietyMappings.push({
            societyId: resendSocId,
            userId: resendAdminId,
            identifier: "adminresend@sukruti.com",
            roleKeys: ["admin"],
            status: "active"
        });

        // Test 18: Unactivated (invited) user cannot log in
        await assert.rejects(
            async () => AuthService.login("adminresend@sukruti.com", "anypassword", resendSocId.toString()),
            (err) => {
                assert.strictEqual(err.statusCode, 403);
                assert(err.message.includes("inactive") || err.message.includes("USER_INACTIVE"));
                return true;
            },
            "Invited user must not be allowed to log in"
        );
        pass("AuthService.login rejects invited admin before password setup (HTTP 403 USER_INACTIVE)");

        // Test 19: Wrong password rejected once active
        users[0].status = USER_STATUS.ACTIVE;
        users[0].isActive = true;
        users[0].password = bcrypt.hashSync("CorrectPassword@123", 10);

        await assert.rejects(
            async () => AuthService.login("adminresend@sukruti.com", "WrongPassword@123", resendSocId.toString()),
            (err) => {
                assert.strictEqual(err.statusCode, 401);
                assert(err.message.includes("Invalid") || err.message.includes("password"));
                return true;
            },
            "Wrong password must be rejected"
        );
        pass("AuthService.login rejects incorrect password (HTTP 401 INVALID_CREDENTIALS)");

        // Test 20: Successful login once active with correct password
        const loginResult = await AuthService.login("adminresend@sukruti.com", "CorrectPassword@123", resendSocId.toString());
        assert.ok(loginResult.accessToken, "Login must provide access token");
        assert.ok(loginResult.refreshToken, "Login must provide refresh token");
        assert.strictEqual(loginResult.user.email, "adminresend@sukruti.com");
        assert.strictEqual(loginResult.user.password, undefined, "Password hash must not be returned in login result");
        pass("AuthService.login succeeds with valid credentials for active tenant admin");

        // Test 21: Multi-society user requires tenant header
        const secondSocId = new mongoose.Types.ObjectId();
        userSocietyMappings.push({
            societyId: secondSocId,
            userId: resendAdminId,
            identifier: "adminresend@sukruti.com",
            roleKeys: ["admin"],
            status: "active"
        });
        await assert.rejects(
            async () => AuthService.login("adminresend@sukruti.com", "CorrectPassword@123"), // No header
            (err) => {
                assert.strictEqual(err.statusCode, 409);
                assert.strictEqual(err.errorCode, "MULTI_SOCIETY_USER");
                return true;
            },
            "Multi-society user without header must receive 409 MULTI_SOCIETY_USER"
        );
        pass("AuthService.login enforces tenant isolation with HTTP 409 when user belongs to multiple societies");

        // Restore original mocks
        emailService.sendInviteEmail = originalSendInviteEmail;
        mockAuthRepo.findUserByIdentifier = originalFindUser;
        mockAuthRepo.getMappingsForIdentifier = originalGetMappings;
        mockAuthRepo.saveRefreshToken = originalSaveRefresh;

        console.log("\n===============================================================");
        console.log(`✅ All ${testCount} Society Onboarding Lifecycle Tests Passed Successfully!`);
        console.log("===============================================================\n");
        return true;
    } catch (err) {
        console.error("\n❌ Test Failed:", err);
        throw err;
    }
}

if (require.main === module) {
    runSocietyOnboardingLifecycleTests()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = runSocietyOnboardingLifecycleTests;
