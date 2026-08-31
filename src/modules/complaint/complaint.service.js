"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const AppError = require("../../common/AppError");
const { COMPLAINT_STATUS, COMPLAINT_PRIORITY, ROLES } = require("../../common/constants");

// ── Valid status transition map ───────────────────────────────────────────────
// Defines exactly which transitions are legal from each state.
// This is the single source of truth — enforced in _assertValidTransition().
const VALID_TRANSITIONS = {
    [COMPLAINT_STATUS.OPEN]:        [COMPLAINT_STATUS.IN_PROGRESS],
    [COMPLAINT_STATUS.IN_PROGRESS]: [COMPLAINT_STATUS.RESOLVED],
    [COMPLAINT_STATUS.RESOLVED]:    [COMPLAINT_STATUS.CLOSED, COMPLAINT_STATUS.OPEN], // CLOSED=confirm, OPEN=reopen
};

// ── SLA hours per priority (configurable defaults) ────────────────────────────
// Can be overridden via GlobalSetting in future; kept here for single-responsibility.
const SLA_HOURS_BY_PRIORITY = {
    [COMPLAINT_PRIORITY.LOW]:      72, // 3 days
    [COMPLAINT_PRIORITY.MEDIUM]:   48, // 2 days
    [COMPLAINT_PRIORITY.HIGH]:     24, // 1 day
    [COMPLAINT_PRIORITY.URGENT]:   8,  // 8 hours
};

// ── Valid sort fields allowlist ────────────────────────────────────────────────
const SORT_ALLOWLIST = {
    newest:          { createdAt: -1 },
    oldest:          { createdAt: 1 },
    sla_due_soon:    { "sla.dueAt": 1 },
    recently_updated:{ updatedAt: -1 },
    priority:        { priority: -1, createdAt: -1 },
};

// ── Valid complaint categories allowlist ──────────────────────────────────────
const VALID_CATEGORIES = [
    "Plumbing",
    "Electrical",
    "Carpentry",
    "Housekeeping",
    "Lift/Elevator",
    "Pest Control",
    "Common Area",
    "Security",
    "Parking",
    "Water Supply",
    "Waste Management",
    "Internet/Cable",
    "Gas Supply",
    "Noise",
    "Other",
];

class ComplaintService {

    // ─────────────────────────────────────────────────────────────────────────
    // ── Internal Helpers ──────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Atomically increment the ticket counter and return the next sequence number.
     * Uses findOneAndUpdate($inc, { upsert: true }) which is safe under concurrency.
     */
    async _generateTicketId(opsDb) {
        const Counter = opsDb.model("Counter");
        const counter = await Counter.findOneAndUpdate(
            { _id: "ticket_id" },
            { $inc: { seq: 1 } },
            { upsert: true, new: true }
        );
        return `TKT-${String(counter.seq).padStart(7, "0")}`;
    }

    /**
     * Validate that the from→to transition is permitted.
     */
    _assertValidTransition(currentStatus, newStatus) {
        const allowed = VALID_TRANSITIONS[currentStatus] || [];
        if (!allowed.includes(newStatus)) {
            throw new AppError(
                `Invalid status transition: ${currentStatus} → ${newStatus}`,
                400,
                "INVALID_STATUS_TRANSITION"
            );
        }
    }

    /**
     * Calculate SLA duration and due date based on complaint priority.
     */
    _buildSla(priority) {
        const durationHours = SLA_HOURS_BY_PRIORITY[priority] || SLA_HOURS_BY_PRIORITY[COMPLAINT_PRIORITY.MEDIUM];
        const startedAt = new Date();
        const dueAt = new Date(startedAt.getTime() + durationHours * 60 * 60 * 1000);
        return { durationHours, startedAt, dueAt, status: "within" };
    }

    /**
     * Append a history event (used inside transactions via session arg).
     */
    async _createHistory(opsDb, { societyId, complaintId, action, performedBy, performedByRole, previousValue, newValue, remarks }, session = null) {
        const ComplaintHistory = opsDb.model("ComplaintHistory");
        const doc = new ComplaintHistory({
            societyId,
            complaintId,
            action,
            performedBy,
            performedByRole,
            previousValue: previousValue ?? null,
            newValue: newValue ?? null,
            remarks: remarks ?? null,
        });
        if (session) {
            await doc.save({ session });
        } else {
            await doc.save();
        }
        return doc;
    }

    /**
     * Resolve the Staff._id for a user-facing staffId, enforce same society + active.
     */
    async _assertStaffEligible(opsDb, societyId, staffId) {
        const Staff = opsDb.model("Staff");
        const staff = await Staff.findOne({ _id: staffId, societyId }).lean();
        if (!staff) {
            throw new AppError("Staff member not found in this society.", 404, "ASSIGNEE_NOT_FOUND");
        }
        if (staff.isActive === false || staff.status === "deactivated") {
            throw new AppError("Staff member is inactive and cannot receive assignments.", 400, "ASSIGNEE_INACTIVE");
        }
        return staff;
    }

    /**
     * Fetch vendor and verify it's active, in same society, with a valid contract.
     */
    async _assertVendorEligible(opsDb, societyId, vendorId) {
        const Vendor = opsDb.model("Vendor");
        const vendor = await Vendor.findOne({ _id: vendorId, societyId }).lean();
        if (!vendor) {
            throw new AppError("Vendor not found in this society.", 404, "ASSIGNEE_NOT_FOUND");
        }
        if (vendor.status !== "ACTIVE") {
            throw new AppError("Vendor is inactive and cannot receive assignments.", 400, "VENDOR_NOT_ELIGIBLE");
        }
        const now = new Date();
        if (vendor.contractStartDate && new Date(vendor.contractStartDate) > now) {
            throw new AppError("Vendor contract has not started yet.", 400, "VENDOR_NOT_ELIGIBLE");
        }
        if (vendor.contractEndDate && new Date(vendor.contractEndDate) < now) {
            throw new AppError("Vendor contract has expired.", 400, "VENDOR_NOT_ELIGIBLE");
        }
        return vendor;
    }

    /**
     * Fetch the active resident record for a given userId in a society.
     * This is used during complaint creation to derive flatId from the authenticated user.
     */
    async _resolveResidentContext(opsDb, societyId, userId) {
        const Resident = opsDb.model("Resident");
        const resident = await Resident.findOne({ societyId, userId, isActive: true }).lean();
        if (!resident) {
            throw new AppError(
                "No active resident profile found for your account in this society.",
                403,
                "RESIDENT_NOT_FOUND"
            );
        }
        if (!resident.flatId) {
            throw new AppError(
                "Your resident profile is not linked to a flat. Please contact your society admin.",
                403,
                "RESIDENT_NO_FLAT"
            );
        }
        return resident;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Complaint Creation ────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a new complaint ticket.
     *
     * Security:
     *  - societyId, raisedBy, flatId are derived from JWT/authenticated user — NEVER from client.
     *  - category is validated against the predefined allowlist.
     *  - description is trimmed and checked for whitespace-only.
     *  - attachments are pre-uploaded URLs; service validates they are strings only.
     *
     * Concurrency:
     *  - ticketId uses atomic findOneAndUpdate($inc) — collision-safe.
     *
     * @param {Object} params
     * @param {string} params.societyId        - From JWT
     * @param {string} params.userId           - From JWT
     * @param {string} params.role             - From JWT (for history record)
     * @param {string} params.category         - From request body (validated)
     * @param {string} params.description      - From request body (validated)
     * @param {string} [params.priority]       - Optional from body, restricted to enum
     * @param {string[]} [params.attachments]  - Optional pre-uploaded URLs
     */
    async createComplaint({ societyId, userId, role, category, description, priority, attachments = [] }) {
        const opsDb = getOperationsConnection();

        // ── Input Validation ──────────────────────────────────────────────────
        const trimmedCategory = (category || "").trim();
        if (!trimmedCategory) {
            throw new AppError("Category is required.", 400, "INVALID_COMPLAINT_DATA");
        }
        if (!VALID_CATEGORIES.includes(trimmedCategory)) {
            throw new AppError(
                `Invalid category. Allowed: ${VALID_CATEGORIES.join(", ")}`,
                400,
                "INVALID_CATEGORY"
            );
        }

        const trimmedDescription = (description || "").trim();
        if (!trimmedDescription) {
            throw new AppError("Description cannot be empty.", 400, "INVALID_COMPLAINT_DATA");
        }

        // Validate priority if provided
        const resolvedPriority = priority && Object.values(COMPLAINT_PRIORITY).includes(priority)
            ? priority
            : COMPLAINT_PRIORITY.MEDIUM;

        // Validate attachments — must be an array of strings (URLs)
        if (!Array.isArray(attachments)) {
            throw new AppError("Attachments must be an array.", 400, "INVALID_ATTACHMENT");
        }
        const validAttachments = attachments.filter(a => typeof a === "string" && a.trim().length > 0);

        // ── Resident Context Resolution ───────────────────────────────────────
        // Derives flatId from authenticated user — never trust client-provided flatId.
        const resident = await this._resolveResidentContext(opsDb, societyId, userId);

        // ── Atomic Operations (ticketId + complaint + history) ────────────────
        const session = await opsDb.startSession();
        let complaint;

        try {
            await session.withTransaction(async () => {
                // 1. Generate unique ticket ID (atomic counter)
                const ticketId = await this._generateTicketId(opsDb);

                // 2. Calculate SLA
                const sla = this._buildSla(resolvedPriority);

                // 3. Create complaint document
                const Complaint = opsDb.model("Complaint");
                const [newComplaint] = await Complaint.create(
                    [{
                        ticketId,
                        societyId,
                        flatId:      resident.flatId,
                        raisedBy:    userId,
                        category:    trimmedCategory,
                        description: trimmedDescription,
                        priority:    resolvedPriority,
                        attachments: validAttachments,
                        status:      COMPLAINT_STATUS.OPEN,
                        sla,
                    }],
                    { session }
                );
                complaint = newComplaint;

                // 4. Create initial history record
                await this._createHistory(
                    opsDb,
                    {
                        societyId,
                        complaintId:     complaint._id,
                        action:          "CREATED",
                        performedBy:     userId,
                        performedByRole: role,
                        newValue:        { status: COMPLAINT_STATUS.OPEN, ticketId },
                        remarks:         null,
                    },
                    session
                );
            });
        } finally {
            await session.endSession();
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Complaint Retrieval ───────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get basic resident info for raising tickets
     */
    async getResidentInfo(societyId, userId, email) {
        const opsDb = getOperationsConnection();
        const resident = await this._resolveResidentContext(opsDb, societyId, userId);
        
        // Populate the flat and block details
        const Flat = opsDb.model("Flat");
        const flat = await Flat.findById(resident.flatId).populate("blockId", "name").lean();

        return {
            email: email,
            flatNumber: flat ? flat.flatNumber : "N/A",
            wing: flat && flat.blockId ? flat.blockId.name : "N/A"
        };
    }

    /**
     * List complaints with filters, pagination, and sorting.
     * The query filter is shaped by the caller (controller) based on role.
     */
    async listComplaints({ societyId, filter = {}, sort = "newest", page = 1, limit = 10 }) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");
        const { buildPaginationMeta, getPaginationOptions } = require("../../utils/pagination.utils");

        const resolvedSort = SORT_ALLOWLIST[sort] || SORT_ALLOWLIST.newest;
        const { skip, limit: safeLimit, page: safePage } = getPaginationOptions({ page, limit });

        const query = { societyId, ...filter };

        const [complaints, total] = await Promise.all([
            Complaint.find(query)
                .populate("raisedBy",       "name email mobile")
                .populate("assignedStaffId","name role phone")
                .populate("assignedVendorId","name serviceCategory phone email")
                .populate({
                    path: "flatId",
                    select: "flatNumber blockId",
                    populate: { path: "blockId", select: "name" }
                })
                .sort(resolvedSort)
                .skip(skip)
                .limit(safeLimit)
                .lean(),
            Complaint.countDocuments(query),
        ]);

        return {
            complaints,
            pagination: buildPaginationMeta(total, safePage, safeLimit),
        };
    }

    /**
     * Get a single complaint, always scoped to societyId.
     * Optionally enforces that raisedBy === userId (for resident access).
     */
    async getComplaintById({ societyId, complaintId, userId = null, isResident = false }) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        const filter = { _id: complaintId, societyId };

        // Resident MUST only see their own complaint
        if (isResident && userId) {
            filter.raisedBy = userId;
        }

        const complaint = await Complaint.findOne(filter)
            .populate("raisedBy",        "name email mobile")
            .populate("assignedStaffId", "name role phone")
            .populate("assignedVendorId","name serviceCategory phone email")
            .populate("assignedBy",      "name email")
            .populate("resolvedBy",      "name email")
            .populate("closedBy",        "name email")
            .populate({
                path: "flatId",
                select: "flatNumber blockId",
                populate: { path: "blockId", select: "name" }
            })
            .lean();

        if (!complaint) {
            if (isResident) {
                // Don't leak existence to residents — return 404 for both unauthorized and not-found
                throw new AppError("Complaint not found.", 404, "COMPLAINT_NOT_FOUND");
            }
            throw new AppError("Complaint not found.", 404, "COMPLAINT_NOT_FOUND");
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Assignment ────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Assign or reassign a complaint to an internal staff member or a vendor.
     * Validates assignee eligibility and same-society membership.
     * Uses a session to atomically update complaint + write history.
     *
     * @param {Object} params
     * @param {string} params.societyId        - From JWT
     * @param {string} params.complaintId      - From URL params
     * @param {string} params.assignedBy       - userId from JWT
     * @param {string} params.role             - role from JWT
     * @param {"internal_staff"|"vendor"} params.assignedToType
     * @param {string} params.assigneeId       - staffId or vendorId
     * @param {string} [params.remarks]        - Optional assignment remarks
     */
    async assignComplaint({ societyId, complaintId, assignedBy, role, assignedToType, assigneeId, remarks }) {
        const opsDb = getOperationsConnection();

        if (!["internal_staff", "vendor"].includes(assignedToType)) {
            throw new AppError("assignedToType must be 'internal_staff' or 'vendor'.", 400, "INVALID_ASSIGNMENT");
        }

        // Validate assignee eligibility BEFORE starting the transaction (read-only checks)
        if (assignedToType === "internal_staff") {
            await this._assertStaffEligible(opsDb, societyId, assigneeId);
        } else {
            await this._assertVendorEligible(opsDb, societyId, assigneeId);
        }

        const session = await opsDb.startSession();
        let complaint;

        try {
            await session.withTransaction(async () => {
                const Complaint = opsDb.model("Complaint");

                // Fetch complaint — must belong to same society
                const current = await Complaint.findOne({ _id: complaintId, societyId }).session(session);
                if (!current) {
                    throw new AppError("Complaint not found.", 404, "COMPLAINT_NOT_FOUND");
                }

                // Closed / rejected tickets cannot be reassigned
                if ([COMPLAINT_STATUS.CLOSED].includes(current.status)) {
                    throw new AppError("Cannot assign a closed complaint.", 400, "COMPLAINT_ALREADY_CLOSED");
                }

                // Idempotency: same assignment already in place
                const isSameStaff   = assignedToType === "internal_staff" && current.assignedStaffId?.toString() === assigneeId.toString();
                const isSameVendor  = assignedToType === "vendor" && current.assignedVendorId?.toString() === assigneeId.toString();
                if (isSameStaff || isSameVendor) {
                    throw new AppError("Complaint is already assigned to this assignee.", 400, "ALREADY_ASSIGNED");
                }

                const isReassignment = !!current.assignedStaffId || !!current.assignedVendorId;
                const action = isReassignment ? "REASSIGNED" : "ASSIGNED";

                const previousAssignee = {
                    type:     current.assignedToType,
                    staffId:  current.assignedStaffId,
                    vendorId: current.assignedVendorId,
                };

                // Clear previous assignment fields
                const updateFields = {
                    assignedToType:  assignedToType,
                    assignedStaffId: assignedToType === "internal_staff" ? assigneeId : null,
                    assignedVendorId:assignedToType === "vendor"          ? assigneeId : null,
                    assignedBy,
                    assignedAt:      new Date(),
                    $inc:            { version: 1 },
                };

                const updated = await Complaint.findOneAndUpdate(
                    { _id: complaintId, societyId },
                    { $set: {
                        assignedToType:   updateFields.assignedToType,
                        assignedStaffId:  updateFields.assignedStaffId,
                        assignedVendorId: updateFields.assignedVendorId,
                        assignedBy:       updateFields.assignedBy,
                        assignedAt:       updateFields.assignedAt,
                    }, $inc: { version: 1 } },
                    { new: true, session }
                );

                if (!updated) {
                    throw new AppError("Complaint could not be updated.", 500, "COMPLAINT_UPDATE_FAILED");
                }
                complaint = updated;

                // Create history entry
                await this._createHistory(
                    opsDb,
                    {
                        societyId,
                        complaintId: complaint._id,
                        action,
                        performedBy:     assignedBy,
                        performedByRole: role,
                        previousValue:   previousAssignee,
                        newValue:        { type: assignedToType, assigneeId },
                        remarks:         remarks ?? null,
                    },
                    session
                );
            });
        } finally {
            await session.endSession();
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Status Update (by Assignee) ───────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Update complaint status. Called by assignees (staff or vendor).
     *
     * Security:
     *  - For vendors: verifies complaint.assignedVendorId === vendorId at write time (race-safe)
     *  - For staff: verifies complaint.assignedStaffId === staffId at write time
     *  - societyId always in filter
     *
     * @param {Object} params
     * @param {string} params.societyId
     * @param {string} params.complaintId
     * @param {string} params.newStatus         - Target status (limited by transition rules)
     * @param {string} params.updatedBy         - userId from JWT
     * @param {string} params.role              - role from JWT
     * @param {"vendor"|"staff"|"admin"} params.callerType
     * @param {string} [params.assigneeId]      - vendorId or staffId (for ownership check)
     * @param {string} [params.resolutionRemarks]
     */
    async updateComplaintStatus({ societyId, complaintId, newStatus, updatedBy, role, callerType, assigneeId, resolutionRemarks }) {
        const opsDb = getOperationsConnection();

        if (!Object.values(COMPLAINT_STATUS).includes(newStatus)) {
            throw new AppError("Invalid status value.", 400, "INVALID_STATUS_TRANSITION");
        }

        const session = await opsDb.startSession();
        let complaint;

        try {
            await session.withTransaction(async () => {
                const Complaint = opsDb.model("Complaint");

                // Build filter: always societyId-scoped + ownership check at write time
                const filter = { _id: complaintId, societyId };

                if (callerType === "vendor") {
                    filter.assignedVendorId = assigneeId;
                } else if (callerType === "staff") {
                    filter.assignedStaffId = assigneeId;
                }

                const current = await Complaint.findOne(filter).session(session);

                if (!current) {
                    if (callerType === "vendor" || callerType === "staff") {
                        throw new AppError(
                            "This complaint is not assigned to you or does not exist.",
                            403,
                            "COMPLAINT_NO_LONGER_ASSIGNED"
                        );
                    }
                    throw new AppError("Complaint not found.", 404, "COMPLAINT_NOT_FOUND");
                }

                // Closed complaint protection
                if (current.status === COMPLAINT_STATUS.CLOSED) {
                    throw new AppError("Cannot modify a closed complaint.", 400, "COMPLAINT_ALREADY_CLOSED");
                }

                // Validate transition
                this._assertValidTransition(current.status, newStatus);

                const now = new Date();
                const setFields = {
                    status: newStatus,
                };

                if (newStatus === COMPLAINT_STATUS.RESOLVED) {
                    setFields.resolvedAt = now;
                    setFields.resolvedBy = updatedBy;
                    if (resolutionRemarks) setFields.resolutionRemarks = resolutionRemarks;
                    // Update SLA status
                    setFields["sla.status"] = current.sla?.dueAt && now <= current.sla.dueAt
                        ? "resolved_within"
                        : "breached";
                }

                const updated = await Complaint.findOneAndUpdate(
                    filter,
                    { $set: setFields, $inc: { version: 1 } },
                    { new: true, session }
                );

                if (!updated) {
                    throw new AppError(
                        "Complaint was modified by another request. Please refresh and try again.",
                        409,
                        "COMPLAINT_CHANGED"
                    );
                }
                complaint = updated;

                await this._createHistory(
                    opsDb,
                    {
                        societyId,
                        complaintId: complaint._id,
                        action:      newStatus === COMPLAINT_STATUS.RESOLVED ? "RESOLUTION_SUBMITTED" : "STATUS_CHANGED",
                        performedBy:     updatedBy,
                        performedByRole: role,
                        previousValue:   { status: current.status },
                        newValue:        { status: newStatus },
                        remarks:         resolutionRemarks ?? null,
                    },
                    session
                );
            });
        } finally {
            await session.endSession();
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Resident: Confirm Resolution → CLOSED ────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resident confirms the resolution, moving ticket to CLOSED.
     *
     * Security:
     *  - Verifies complaint.raisedBy === userId (only the owner can close)
     *  - Verifies societyId
     *  - Idempotent: if already CLOSED, returns a specific error
     */
    async confirmResolution({ societyId, complaintId, userId, role }) {
        const opsDb = getOperationsConnection();
        const session = await opsDb.startSession();
        let complaint;

        try {
            await session.withTransaction(async () => {
                const Complaint = opsDb.model("Complaint");

                const current = await Complaint.findOne({
                    _id: complaintId,
                    societyId,
                    raisedBy: userId, // Only the resident who raised it
                }).session(session);

                if (!current) {
                    throw new AppError(
                        "Complaint not found or you are not authorized to confirm its resolution.",
                        403,
                        "COMPLAINT_NOT_FOUND"
                    );
                }

                if (current.status === COMPLAINT_STATUS.CLOSED) {
                    throw new AppError("Complaint is already closed.", 400, "COMPLAINT_ALREADY_CLOSED");
                }

                if (current.status !== COMPLAINT_STATUS.RESOLVED) {
                    throw new AppError(
                        "Complaint can only be closed when it is in RESOLVED status.",
                        400,
                        "INVALID_STATUS_TRANSITION"
                    );
                }

                const now = new Date();
                const updated = await Complaint.findOneAndUpdate(
                    { _id: complaintId, societyId, raisedBy: userId, status: COMPLAINT_STATUS.RESOLVED },
                    {
                        $set: { status: COMPLAINT_STATUS.CLOSED, closedAt: now, closedBy: userId },
                        $inc: { version: 1 },
                    },
                    { new: true, session }
                );

                if (!updated) {
                    throw new AppError(
                        "Complaint state changed concurrently. Please refresh and try again.",
                        409,
                        "COMPLAINT_CHANGED"
                    );
                }
                complaint = updated;

                await this._createHistory(
                    opsDb,
                    {
                        societyId,
                        complaintId: complaint._id,
                        action:          "RESOLUTION_CONFIRMED",
                        performedBy:     userId,
                        performedByRole: role,
                        previousValue:   { status: COMPLAINT_STATUS.RESOLVED },
                        newValue:        { status: COMPLAINT_STATUS.CLOSED },
                        remarks:         null,
                    },
                    session
                );
            });
        } finally {
            await session.endSession();
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Resident: Reopen ──────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resident reopens a RESOLVED complaint (unsatisfied with resolution).
     * Per BRD: reopening is allowed from RESOLVED state (before CLOSED).
     * Remarks are required.
     *
     * SLA: A new SLA cycle starts for the reopened complaint.
     *
     * Security:
     *  - Only the complaint owner can reopen
     *  - societyId always in filter
     */
    async reopenComplaint({ societyId, complaintId, userId, role, reopeningRemarks }) {
        const opsDb = getOperationsConnection();

        const trimmedRemarks = (reopeningRemarks || "").trim();
        if (!trimmedRemarks) {
            throw new AppError("Reopening remarks are required.", 400, "INVALID_COMPLAINT_DATA");
        }

        const session = await opsDb.startSession();
        let complaint;

        try {
            await session.withTransaction(async () => {
                const Complaint = opsDb.model("Complaint");

                const current = await Complaint.findOne({
                    _id: complaintId,
                    societyId,
                    raisedBy: userId,
                }).session(session);

                if (!current) {
                    throw new AppError(
                        "Complaint not found or you are not authorized to reopen it.",
                        403,
                        "COMPLAINT_NOT_FOUND"
                    );
                }

                if (current.status === COMPLAINT_STATUS.OPEN) {
                    throw new AppError("Complaint is already open.", 400, "COMPLAINT_ALREADY_OPEN");
                }
                if (current.status === COMPLAINT_STATUS.IN_PROGRESS) {
                    throw new AppError("Complaint is still in progress. It cannot be reopened.", 400, "REOPEN_NOT_ALLOWED");
                }
                if (current.status === COMPLAINT_STATUS.CLOSED) {
                    // Per BRD: reopening from CLOSED is not defined. RESOLVED → OPEN is the allowed path.
                    throw new AppError(
                        "Closed complaints cannot be reopened. Please raise a new complaint.",
                        400,
                        "REOPEN_NOT_ALLOWED"
                    );
                }
                if (current.status !== COMPLAINT_STATUS.RESOLVED) {
                    throw new AppError("Complaint cannot be reopened from its current state.", 400, "REOPEN_NOT_ALLOWED");
                }

                const now = new Date();
                // New SLA cycle for the reopened ticket
                const newSla = this._buildSla(current.priority);

                const updated = await Complaint.findOneAndUpdate(
                    { _id: complaintId, societyId, raisedBy: userId, status: COMPLAINT_STATUS.RESOLVED },
                    {
                        $set: {
                            status:           COMPLAINT_STATUS.OPEN,
                            reopenedAt:       now,
                            reopenedBy:       userId,
                            reopeningRemarks: trimmedRemarks,
                            sla:              newSla,
                            // Reset assignment so admin can reassign
                        },
                        $inc: { version: 1, reopenCount: 1 },
                    },
                    { new: true, session }
                );

                if (!updated) {
                    throw new AppError(
                        "Complaint state changed concurrently. Please refresh and try again.",
                        409,
                        "COMPLAINT_CHANGED"
                    );
                }
                complaint = updated;

                await this._createHistory(
                    opsDb,
                    {
                        societyId,
                        complaintId: complaint._id,
                        action:          "REOPENED",
                        performedBy:     userId,
                        performedByRole: role,
                        previousValue:   { status: COMPLAINT_STATUS.RESOLVED },
                        newValue:        { status: COMPLAINT_STATUS.OPEN },
                        remarks:         trimmedRemarks,
                    },
                    session
                );
            });
        } finally {
            await session.endSession();
        }

        return complaint;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Complaint History ─────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    async getComplaintHistory({ societyId, complaintId }) {
        const opsDb = getOperationsConnection();
        const ComplaintHistory = opsDb.model("ComplaintHistory");

        // First verify the complaint belongs to this society
        const Complaint = opsDb.model("Complaint");
        const exists = await Complaint.exists({ _id: complaintId, societyId });
        if (!exists) {
            throw new AppError("Complaint not found.", 404, "COMPLAINT_NOT_FOUND");
        }

        return ComplaintHistory.find({ societyId, complaintId })
            .populate("performedBy", "name email")
            .sort({ createdAt: 1 }) // Chronological order
            .lean();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Reporting / Summary ───────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns complaint summary metrics for a society.
     * Supports the BRD Complaint Summary Report.
     */
    async getComplaintSummary(societyId) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        const [statusCounts, resolutionTimeAgg] = await Promise.all([
            // Count by status
            Complaint.aggregate([
                { $match: { societyId: require("mongoose").Types.ObjectId.createFromHexString(societyId.toString()) } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
            ]),
            // Average resolution time (only for tickets that have resolvedAt AND createdAt)
            Complaint.aggregate([
                {
                    $match: {
                        societyId:  require("mongoose").Types.ObjectId.createFromHexString(societyId.toString()),
                        resolvedAt: { $ne: null },
                    },
                },
                {
                    $project: {
                        resolutionTimeMs: { $subtract: ["$resolvedAt", "$createdAt"] },
                    },
                },
                {
                    $group: {
                        _id: null,
                        avgResolutionTimeMs: { $avg: "$resolutionTimeMs" },
                        totalResolved:       { $sum: 1 },
                    },
                },
            ]),
        ]);

        const counts = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
        statusCounts.forEach(({ _id, count }) => {
            counts[_id] = count;
        });

        const resData = resolutionTimeAgg[0] || {};
        const avgResolutionTimeHours = resData.avgResolutionTimeMs
            ? Math.round(resData.avgResolutionTimeMs / (1000 * 60 * 60) * 10) / 10
            : null;

        return {
            open:                   counts.open,
            inProgress:             counts.in_progress,
            resolved:               counts.resolved,
            closed:                 counts.closed,
            totalResolved:          resData.totalResolved ?? 0,
            avgResolutionTimeHours,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── SLA Escalation (run by scheduler) ────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Escalates complaints whose SLA due date has passed and are still OPEN or IN_PROGRESS.
     *
     * Idempotent: uses $set on escalation.isEscalated = true and checks it isn't already set.
     * Safe to call multiple times — will not re-escalate already-escalated tickets.
     *
     * @returns {{ escalatedCount: number }}
     */
    async runSlaEscalation() {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        const now = new Date();

        const result = await Complaint.updateMany(
            {
                status:                  { $in: [COMPLAINT_STATUS.OPEN, COMPLAINT_STATUS.IN_PROGRESS] },
                "sla.dueAt":             { $lte: now },
                "escalation.isEscalated":false, // Idempotency — skip already-escalated tickets
            },
            {
                $set: {
                    "sla.status":               "breached",
                    "escalation.isEscalated":    true,
                    "escalation.escalatedAt":    now,
                    "escalation.escalationLevel":1,
                    "escalation.escalationReason":"SLA breach — no action taken within configured window",
                },
                $inc: { version: 1 },
            }
        );

        // Write a history entry for each newly escalated complaint
        if (result.modifiedCount > 0) {
            const escalated = await Complaint.find({
                "escalation.isEscalated": true,
                "escalation.escalatedAt": { $gte: now },
            }).select("_id societyId").lean();

            // Use a system userId placeholder for the escalation action
            const SYSTEM_ACTOR_ID = require("mongoose").Types.ObjectId.createFromHexString("000000000000000000000000");

            for (const c of escalated) {
                try {
                    await this._createHistory(opsDb, {
                        societyId:       c.societyId,
                        complaintId:     c._id,
                        action:          "ESCALATED",
                        performedBy:     SYSTEM_ACTOR_ID,
                        performedByRole: "system",
                        previousValue:   { "escalation.isEscalated": false },
                        newValue:        { "escalation.isEscalated": true },
                        remarks:         "Auto-escalated by SLA scheduler",
                    });
                } catch (_) {
                    // Non-critical: history failure must not fail the main escalation
                }
            }
        }

        return { escalatedCount: result.modifiedCount };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Vendor Portal ─────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns complaints assigned to a specific vendor.
     * Double-enforces: societyId + assignedVendorId.
     */
    async getVendorAssignedComplaints({ societyId, vendorId, page = 1, limit = 10 }) {
        const opsDb = getOperationsConnection();
        return this.listComplaints({
            societyId,
            filter: { assignedVendorId: vendorId },
            page,
            limit,
        });
    }

    /**
     * Returns a single complaint assigned to a vendor — double ownership check.
     */
    async getVendorComplaintById({ societyId, vendorId, complaintId }) {
        const opsDb = getOperationsConnection();
        const Complaint = opsDb.model("Complaint");

        const complaint = await Complaint.findOne({
            _id: complaintId,
            societyId,
            assignedVendorId: vendorId,
        })
            .populate("raisedBy", "name")
            .populate("assignedVendorId", "name serviceCategory")
            .lean();

        if (!complaint) {
            throw new AppError(
                "Complaint not found or not assigned to you.",
                403,
                "COMPLAINT_NO_LONGER_ASSIGNED"
            );
        }
        return complaint;
    }

    /**
     * Returns valid complaint categories.
     */
    getValidCategories() {
        return VALID_CATEGORIES;
    }
}

module.exports = new ComplaintService();
