"use strict";

const ParkingService = require("./parking.service");
const { sendSuccess, sendPaginated } = require("../../utils/response.utils");

class ParkingController {

    async createSlot(req, res, next) {
        try {
            const slot = await ParkingService.createSlot({
                societyId: req.societyId,
                userId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 201, "Parking slot created successfully.", { slot });
        } catch (err) { next(err); }
    }

    async listSlots(req, res, next) {
        try {
            const { slots, meta } = await ParkingService.listSlots({
                societyId: req.societyId,
                query: req.query,
            });
            return sendPaginated(res, 200, "Parking slots retrieved.", { slots }, meta);
        } catch (err) { next(err); }
    }

    async getSlotById(req, res, next) {
        try {
            const slot = await ParkingService.getSlotById({
                slotId: req.params.id,
                societyId: req.societyId,
            });
            return sendSuccess(res, 200, "Parking slot retrieved.", { slot });
        } catch (err) { next(err); }
    }

    async updateSlot(req, res, next) {
        try {
            const slot = await ParkingService.updateSlot({
                slotId: req.params.id,
                societyId: req.societyId,
                userId: req.user.id,
                body: req.body,
                version: req.body.version,
            });
            return sendSuccess(res, 200, "Parking slot updated.", { slot });
        } catch (err) { next(err); }
    }

    async activateSlot(req, res, next) {
        try {
            const slot = await ParkingService.activateSlot({
                slotId: req.params.id,
                societyId: req.societyId,
                userId: req.user.id,
            });
            return sendSuccess(res, 200, "Parking slot activated.", { slot });
        } catch (err) { next(err); }
    }

    async deactivateSlot(req, res, next) {
        try {
            const slot = await ParkingService.deactivateSlot({
                slotId: req.params.id,
                societyId: req.societyId,
                userId: req.user.id,
            });
            return sendSuccess(res, 200, "Parking slot deactivated.", { slot });
        } catch (err) { next(err); }
    }

    // ── Dashboard ──────────────────────────────────────────────────────────────

    async getDashboardStats(req, res, next) {
        try {
            const stats = await ParkingService.getDashboardStats({ societyId: req.societyId });
            return sendSuccess(res, 200, "Parking dashboard stats retrieved.", { stats });
        } catch (err) { next(err); }
    }

    // ── Vehicles ───────────────────────────────────────────────────────────────

    async registerVehicle(req, res, next) {
        try {
            const vehicle = await ParkingService.registerVehicle({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                body: req.body,
            });
            return sendSuccess(res, 201, "Vehicle registered successfully.", { vehicle });
        } catch (err) { next(err); }
    }

    async listVehicles(req, res, next) {
        try {
            const { vehicles, meta } = await ParkingService.listVehicles({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                query: req.query,
            });
            return sendPaginated(res, 200, "Vehicles retrieved.", { vehicles }, meta);
        } catch (err) { next(err); }
    }

    async getVehicleById(req, res, next) {
        try {
            const vehicle = await ParkingService.getVehicleById({
                vehicleId: req.params.id,
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
            });
            return sendSuccess(res, 200, "Vehicle retrieved.", { vehicle });
        } catch (err) { next(err); }
    }

    async updateVehicle(req, res, next) {
        try {
            const vehicle = await ParkingService.updateVehicle({
                vehicleId: req.params.id,
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                body: req.body,
            });
            return sendSuccess(res, 200, "Vehicle updated.", { vehicle });
        } catch (err) { next(err); }
    }

    async deactivateVehicle(req, res, next) {
        try {
            const result = await ParkingService.deactivateVehicle({
                vehicleId: req.params.id,
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
            });
            return sendSuccess(res, 200, result.message, {});
        } catch (err) { next(err); }
    }

    // ── Parking Assignments ────────────────────────────────────────────────────

    async allocateParking(req, res, next) {
        try {
            const { assignment, slot } = await ParkingService.allocateParking({
                societyId: req.societyId,
                assignedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 201, "Parking allocated successfully.", { assignment, slot });
        } catch (err) { next(err); }
    }

    async listAssignments(req, res, next) {
        try {
            const { assignments, meta } = await ParkingService.listAssignments({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                query: req.query,
            });
            return sendPaginated(res, 200, "Parking assignments retrieved.", { assignments }, meta);
        } catch (err) { next(err); }
    }

    async getAssignmentById(req, res, next) {
        try {
            const assignment = await ParkingService.getAssignmentById({
                assignmentId: req.params.id,
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
            });
            return sendSuccess(res, 200, "Parking assignment retrieved.", { assignment });
        } catch (err) { next(err); }
    }

    async releaseParking(req, res, next) {
        try {
            const assignment = await ParkingService.releaseParking({
                assignmentId: req.params.id,
                societyId: req.societyId,
                releasedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 200, "Parking released successfully.", { assignment });
        } catch (err) { next(err); }
    }

    async reassignParking(req, res, next) {
        try {
            const result = await ParkingService.reassignParking({
                assignmentId: req.params.id,
                societyId: req.societyId,
                reassignedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 200, "Parking reassigned successfully.", result);
        } catch (err) { next(err); }
    }

    // ── Parking Requests ───────────────────────────────────────────────────────

    async createRequest(req, res, next) {
        try {
            const request = await ParkingService.createRequest({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 201, "Parking request submitted.", { request });
        } catch (err) { next(err); }
    }

    async listRequests(req, res, next) {
        try {
            const { requests, meta } = await ParkingService.listRequests({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                query: req.query,
            });
            return sendPaginated(res, 200, "Parking requests retrieved.", { requests }, meta);
        } catch (err) { next(err); }
    }

    async approveRequest(req, res, next) {
        try {
            const request = await ParkingService.approveRequest({
                requestId: req.params.id,
                societyId: req.societyId,
                reviewedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 200, "Parking request approved.", { request });
        } catch (err) { next(err); }
    }

    async rejectRequest(req, res, next) {
        try {
            const request = await ParkingService.rejectRequest({
                requestId: req.params.id,
                societyId: req.societyId,
                reviewedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 200, "Parking request rejected.", { request });
        } catch (err) { next(err); }
    }

    // ── Visitor Parking ────────────────────────────────────────────────────────

    async createVisitorSession(req, res, next) {
        try {
            const session = await ParkingService.createVisitorSession({
                societyId: req.societyId,
                recordedByUserId: req.user.id,
                body: req.body,
            });
            return sendSuccess(res, 201, "Visitor parking session created.", { session });
        } catch (err) { next(err); }
    }

    async listVisitorSessions(req, res, next) {
        try {
            const { sessions, meta } = await ParkingService.listVisitorSessions({
                societyId: req.societyId,
                query: req.query,
            });
            return sendPaginated(res, 200, "Visitor parking sessions retrieved.", { sessions }, meta);
        } catch (err) { next(err); }
    }

    async getVisitorSessionById(req, res, next) {
        try {
            const db = require("../../config/operationsDb").getOperationsConnection();
            const session = await db.model("VisitorParking").findOne({
                _id: req.params.id,
                societyId: req.societyId,
            })
                .populate("parkingSlotId", "slotNumber wing floor")
                .populate("hostFlatId", "flatNumber floor")
                .lean();
            if (!session) {
                const AppError = require("../../common/AppError");
                throw new AppError("Visitor parking session not found.", 404, "VISITOR_SESSION_EXPIRED");
            }
            return sendSuccess(res, 200, "Visitor session retrieved.", { session });
        } catch (err) { next(err); }
    }

    async exitVisitor(req, res, next) {
        try {
            const session = await ParkingService.exitVisitor({
                sessionId: req.params.id,
                societyId: req.societyId,
                exitRecordedByUserId: req.user.id,
            });
            return sendSuccess(res, 200, "Visitor exit recorded.", { session });
        } catch (err) { next(err); }
    }

    // ── Violations ─────────────────────────────────────────────────────────────

    async createViolation(req, res, next) {
        try {
            const violation = await ParkingService.createViolation({
                societyId: req.societyId,
                reportedByUserId: req.user.id,
                body: req.body,
                files: req.files,
            });
            return sendSuccess(res, 201, "Parking violation recorded.", { violation });
        } catch (err) { next(err); }
    }

    async listViolations(req, res, next) {
        try {
            const { violations, meta } = await ParkingService.listViolations({
                societyId: req.societyId,
                query: req.query,
            });
            return sendPaginated(res, 200, "Parking violations retrieved.", { violations }, meta);
        } catch (err) { next(err); }
    }

    // ── History ────────────────────────────────────────────────────────────────

    async getHistory(req, res, next) {
        try {
            const { history, meta } = await ParkingService.getHistory({
                societyId: req.societyId,
                requestingUserId: req.user.id,
                requestingUserRole: req.user.role,
                query: req.query,
            });
            return sendPaginated(res, 200, "Parking history retrieved.", { history }, meta);
        } catch (err) { next(err); }
    }
}

module.exports = new ParkingController();
