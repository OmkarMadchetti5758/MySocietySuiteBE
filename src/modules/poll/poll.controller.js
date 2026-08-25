"use strict";

const PollService = require("./poll.service");
const { sendSuccess, sendError } = require("../../utils/response.utils");

class PollController {
    async createPoll(req, res, next) {
        try {
            if (!req.body.targetBlockId) {
                delete req.body.targetBlockId;
            }
            const poll = await PollService.createPoll(req.societyId, req.user.id, req.body);
            return sendSuccess(res, 201, "Poll created successfully", poll);
        } catch (error) {
            next(error);
        }
    }

    async getPolls(req, res, next) {
        try {
            const queryParams = {
                targetType: req.query.targetType,
                targetBlockId: req.query.targetBlockId
            };
            const polls = await PollService.getPolls(req.societyId, queryParams, req.user.id);
            return sendSuccess(res, 200, "Polls fetched successfully", polls);
        } catch (error) {
            next(error);
        }
    }

    async getPollById(req, res, next) {
        try {
            const poll = await PollService.getPollById(req.societyId, req.params.id);
            if (!poll) return sendError(res, 404, "Poll not found");
            return sendSuccess(res, 200, "Poll fetched successfully", poll);
        } catch (error) {
            next(error);
        }
    }

    async votePoll(req, res, next) {
        try {
            const { optionId } = req.body;
            await PollService.votePoll(req.societyId, req.params.id, req.user.id, optionId);
            return sendSuccess(res, 200, "Vote recorded successfully");
        } catch (error) {
            if (error.code === 11000) {
                return sendError(res, 400, "You have already voted in this poll");
            }
            if (error.message.includes("Poll not found") || error.message.includes("closed") || error.message.includes("Invalid")) {
                return sendError(res, 400, error.message);
            }
            next(error);
        }
    }

    async getPollResults(req, res, next) {
        try {
            const results = await PollService.getPollResults(req.societyId, req.params.id);
            return sendSuccess(res, 200, "Poll results fetched successfully", results);
        } catch (error) {
            if (error.message === "Poll not found") return sendError(res, 404, error.message);
            next(error);
        }
    }

    async updatePoll(req, res, next) {
        try {
            const poll = await PollService.updatePoll(req.societyId, req.params.id, req.body);
            if (!poll) return sendError(res, 404, "Poll not found");
            return sendSuccess(res, 200, "Poll updated successfully", poll);
        } catch (error) {
            next(error);
        }
    }

    async deletePoll(req, res, next) {
        try {
            const poll = await PollService.deletePoll(req.societyId, req.params.id);
            if (!poll) return sendError(res, 404, "Poll not found");
            return sendSuccess(res, 200, "Poll deleted successfully", poll);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new PollController();
