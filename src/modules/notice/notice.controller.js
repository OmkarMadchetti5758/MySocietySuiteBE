"use strict";

const NoticeService = require("./notice.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

class NoticeController {
    async createNotice(req, res, next) {
        try {
            if (!req.body.targetBlockId) {
                req.body.targetBlockId = null;
            }
            const notice = await NoticeService.createNotice(req.societyId, req.user.id, req.body);
            return sendSuccess(res, 201, "Notice created successfully", notice);
        } catch (error) {
            console.error("createNotice ERROR:", error.message, error.stack);
            next(error);
        }
    }

    async getNotices(req, res, next) {
        try {
            // Admin can see all, resident can see ALL + specific block
            // If user is resident, we extract their blockId (assumes resident info is populated or can be checked)
            // For now, if req.query.residentBlockId is passed, we filter.
            const queryParams = {
                targetType: req.query.targetType,
                targetBlockId: req.query.targetBlockId
            };
            const notices = await NoticeService.getNotices(req.societyId, queryParams);
            return sendSuccess(res, 200, "Notices fetched successfully", notices);
        } catch (error) {
            next(error);
        }
    }

    async getNoticeById(req, res, next) {
        try {
            const notice = await NoticeService.getNoticeById(req.societyId, req.params.id);
            if (!notice) return sendError(res, 404, "Notice not found");
            return sendSuccess(res, 200, "Notice fetched successfully", notice);
        } catch (error) {
            next(error);
        }
    }

    async updateNotice(req, res, next) {
        try {
            if (!req.body.targetBlockId) {
                req.body.targetBlockId = null;
            }
            const notice = await NoticeService.updateNotice(req.societyId, req.params.id, req.body);
            if (!notice) return sendError(res, 404, "Notice not found");
            return sendSuccess(res, 200, "Notice updated successfully", notice);
        } catch (error) {
            console.error("updateNotice ERROR:", error.message, error.stack);
            next(error);
        }
    }

    async deleteNotice(req, res, next) {
        try {
            const notice = await NoticeService.deleteNotice(req.societyId, req.params.id);
            if (!notice) return sendError(res, 404, "Notice not found");
            return sendSuccess(res, 200, "Notice deleted successfully", notice);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new NoticeController();
