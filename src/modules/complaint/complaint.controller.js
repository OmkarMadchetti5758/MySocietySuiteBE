"use strict";

const ComplaintService = require("./complaint.service");
const VendorService    = require("../vendor/vendor.service");
const { sendSuccess }  = require("../../utils/response.utils");
const { MODULES, PERMISSION_LEVELS, ROLES, COMPLAINT_STATUS } = require("../../common/constants");
const AppError         = require("../../common/AppError");

class ComplaintController {

    // ─────────────────────────────────────────────────────────────────────────
    // ── Resident Endpoints ────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * POST /complaints
     * Create a new complaint (resident).
     * societyId, raisedBy, flatId resolved from JWT — never trusted from body.
     */
    async createComplaint(req, res, next) {
        try {
            const { category, description, priority, attachments } = req.body;

            // If files were uploaded via multer, convert to URL paths
            const fileAttachments = req.files
                ? req.files.map(f => `/uploads/${f.filename}`)
                : (attachments || []);

            const complaint = await ComplaintService.createComplaint({
                societyId:   req.societyId,
                userId:      req.user.id,
                role:        req.user.role,
                category,
                description,
                priority,
                attachments: fileAttachments,
            });

            return sendSuccess(res, 201, "Complaint created successfully.", {
                ticketId:  complaint.ticketId,
                status:    complaint.status,
                createdAt: complaint.createdAt,
                _id:       complaint._id,
            });
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints
     * For residents: returns their own complaints only.
     * For admins/managers: returns all society complaints (with filters).
     */
    async listComplaints(req, res, next) {
        try {
            const { status, category, priority, sort, page, limit, slaBreached } = req.query;
            const residentRoles = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT];
            const isResident = residentRoles.includes(req.user.role);

            const filter = {};

            // Status filter — validated against enum
            if (status && Object.values(COMPLAINT_STATUS).includes(status)) {
                filter.status = status;
            }

            // Role-based filtering
            if (isResident) {
                // Residents only see their own complaints
                filter.raisedBy = req.user.id;
            } else if (![ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FACILITY_MANAGER, ROLES.COMMITTEE_MEMBER].includes(req.user.role)) {
                // General staff, guards, etc. only see tickets assigned to them
                filter.assignedStaffId = req.user.id;
            }

            if (category) {
                filter.category = category;
            }
            if (priority) {
                filter.priority = priority;
            }
            if (slaBreached === "true") {
                filter["escalation.isEscalated"] = true;
            }

            const data = await ComplaintService.listComplaints({
                societyId: req.societyId,
                filter,
                sort:  sort || "newest",
                page:  parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 10,
            });

            return sendSuccess(res, 200, "Complaints retrieved successfully.", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/:id
     * Get a single complaint. Residents are restricted to their own.
     */
    async getComplaintById(req, res, next) {
        try {
            const residentRoles = [ROLES.RESIDENT_OWNER, ROLES.RESIDENT_TENANT, ROLES.RESIDENT];
            const isResident = residentRoles.includes(req.user.role);

            const complaint = await ComplaintService.getComplaintById({
                societyId:   req.societyId,
                complaintId: req.params.id,
                userId:      req.user.id,
                isResident,
                userRole:    req.user.role,
            });

            return sendSuccess(res, 200, "Complaint retrieved successfully.", complaint);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/resident-info
     * Fetch basic resident info (email, flat, wing) for raising tickets.
     */
    async getResidentInfo(req, res, next) {
        try {
            const info = await ComplaintService.getResidentInfo(req.societyId, req.user.id, req.user.email);
            return sendSuccess(res, 200, "Resident info retrieved.", info);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /complaints/:id/confirm-resolution
     * Resident confirms resolution → CLOSED.
     */
    async confirmResolution(req, res, next) {
        try {
            const complaint = await ComplaintService.confirmResolution({
                societyId:   req.societyId,
                complaintId: req.params.id,
                userId:      req.user.id,
                role:        req.user.role,
            });

            return sendSuccess(res, 200, "Resolution confirmed. Complaint is now closed.", complaint);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /complaints/:id/reopen
     * Resident reopens a RESOLVED complaint (unsatisfied).
     */
    async reopenComplaint(req, res, next) {
        try {
            const { reopeningRemarks } = req.body;
            const complaint = await ComplaintService.reopenComplaint({
                societyId:       req.societyId,
                complaintId:     req.params.id,
                userId:          req.user.id,
                role:            req.user.role,
                reopeningRemarks,
            });

            return sendSuccess(res, 200, "Complaint reopened successfully.", complaint);
        } catch (error) {
            next(error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Admin / Facility Manager Endpoints ───────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * PATCH /complaints/:id/assign
     * Assign or reassign a complaint to staff or vendor.
     */
    async assignComplaint(req, res, next) {
        try {
            const { assignedToType, assigneeId, remarks } = req.body;

            if (!assignedToType || !assigneeId) {
                throw new AppError("assignedToType and assigneeId are required.", 400, "INVALID_ASSIGNMENT");
            }

            const complaint = await ComplaintService.assignComplaint({
                societyId:      req.societyId,
                complaintId:    req.params.id,
                assignedBy:     req.user.id,
                role:           req.user.role,
                assignedToType,
                assigneeId,
                remarks,
            });

            return sendSuccess(res, 200, "Complaint assigned successfully.", complaint);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /complaints/:id/status
     * Update complaint status.
     * Admin can use this; vendors/staff use their own scoped endpoint.
     */
    async updateComplaintStatus(req, res, next) {
        try {
            const { status, resolutionRemarks } = req.body;

            if (!status) {
                throw new AppError("status is required.", 400, "INVALID_STATUS_TRANSITION");
            }

            const complaint = await ComplaintService.updateComplaintStatus({
                societyId:         req.societyId,
                complaintId:       req.params.id,
                newStatus:         status,
                updatedBy:         req.user.id,
                role:              req.user.role,
                callerType:        "admin",
                resolutionRemarks,
            });

            return sendSuccess(res, 200, "Complaint status updated successfully.", complaint);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/:id/history
     * Get full audit history for a complaint.
     */
    async getComplaintHistory(req, res, next) {
        try {
            const history = await ComplaintService.getComplaintHistory({
                societyId:   req.societyId,
                complaintId: req.params.id,
            });

            return sendSuccess(res, 200, "Complaint history retrieved successfully.", history);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/summary
     * Returns summary metrics for Committee / Facility Manager reporting.
     */
    async getComplaintSummary(req, res, next) {
        try {
            const summary = await ComplaintService.getComplaintSummary(req.societyId);
            return sendSuccess(res, 200, "Complaint summary retrieved.", summary);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/categories
     * Returns the list of valid complaint categories.
     */
    async getCategories(req, res, next) {
        try {
            const categories = ComplaintService.getValidCategories();
            return sendSuccess(res, 200, "Categories retrieved.", categories);
        } catch (error) {
            next(error);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── Vendor Portal Endpoints ───────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * GET /complaints/vendor/assigned
     * Vendor views only their assigned complaints.
     */
    async getVendorAssignedComplaints(req, res, next) {
        try {
            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);
            const data = await ComplaintService.getVendorAssignedComplaints({
                societyId: req.societyId,
                vendorId,
                page:  parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 10,
            });

            return sendSuccess(res, 200, "Assigned complaints retrieved.", data);
        } catch (error) {
            next(error);
        }
    }

    /**
     * GET /complaints/vendor/:id
     * Vendor gets a single complaint (must be assigned to them).
     */
    async getVendorComplaintById(req, res, next) {
        try {
            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);
            const complaint = await ComplaintService.getVendorComplaintById({
                societyId:   req.societyId,
                vendorId,
                complaintId: req.params.id,
            });

            return sendSuccess(res, 200, "Complaint retrieved.", complaint);
        } catch (error) {
            next(error);
        }
    }

    /**
     * PATCH /complaints/vendor/:id/status
     * Vendor updates complaint status (OPEN → IN_PROGRESS or IN_PROGRESS → RESOLVED only).
     * Ownership re-validated at write time for race condition safety.
     */
    async vendorUpdateStatus(req, res, next) {
        try {
            const { status, resolutionRemarks } = req.body;

            if (!status) {
                throw new AppError("status is required.", 400, "INVALID_STATUS_TRANSITION");
            }

            const vendorId = await VendorService.getVendorIdForUser(req.societyId, req.user.id);

            const complaint = await ComplaintService.updateComplaintStatus({
                societyId:         req.societyId,
                complaintId:       req.params.id,
                newStatus:         status,
                updatedBy:         req.user.id,
                role:              req.user.role,
                callerType:        "vendor",
                assigneeId:        vendorId,
                resolutionRemarks,
            });

            return sendSuccess(res, 200, "Complaint status updated.", complaint);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ComplaintController();
