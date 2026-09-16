"use strict";

const DunningService = require("./dunning.service");

class DunningController {
    // GET /api/v1/billing/dunning/overview
    static async getOverviewStats(req, res, next) {
        try {
            const stats = await DunningService.getOverviewStats(req);
            return res.status(200).json({ success: true, data: stats });
        } catch (error) {
            return next(error);
        }
    }

    // GET /api/v1/billing/dunning/rules
    static async getRules(req, res, next) {
        try {
            const rules = await DunningService.getRules(req);
            return res.status(200).json({ success: true, data: rules });
        } catch (error) {
            return next(error);
        }
    }

    // POST /api/v1/billing/dunning/rules
    static async createRule(req, res, next) {
        try {
            const newRule = await DunningService.createRule(req, req.body);
            return res.status(201).json({ success: true, message: "Fine rule submitted for Committee Admin approval.", data: newRule });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/v1/billing/dunning/rules/:id/approve
    static async approveRule(req, res, next) {
        try {
            const ruleId = req.params.id;
            const rule = await DunningService.approveRule(req, ruleId);
            return res.status(200).json({ success: true, message: "Fine rule approved and activated.", data: rule });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/v1/billing/dunning/rules/:id/reject
    static async rejectRule(req, res, next) {
        try {
            const ruleId = req.params.id;
            const { reason } = req.body;
            const rule = await DunningService.rejectRule(req, ruleId, reason);
            return res.status(200).json({ success: true, message: "Fine rule rejected.", data: rule });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/v1/billing/dunning/arrears
    static async getArrears(req, res, next) {
        try {
            const arrears = await DunningService.getArrears(req);
            return res.status(200).json({ success: true, data: arrears });
        } catch (error) {
            return next(error);
        }
    }

    // GET /api/v1/billing/dunning/ageing
    static async getAgeing(req, res, next) {
        try {
            const ageingData = await DunningService.getAgeing(req);
            return res.status(200).json({ success: true, data: ageingData });
        } catch (error) {
            return next(error);
        }
    }

    // GET /api/v1/billing/dunning/defaulters
    static async getDefaulters(req, res, next) {
        try {
            const defaulters = await DunningService.getDefaulters(req);
            return res.status(200).json({ success: true, data: defaulters });
        } catch (error) {
            return next(error);
        }
    }

    // GET /api/v1/billing/dunning/reminders
    static async getReminders(req, res, next) {
        try {
            const data = await DunningService.getReminders(req);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return next(error);
        }
    }

    // POST /api/v1/billing/dunning/reminders/config
    static async updateDunningConfig(req, res, next) {
        try {
            const updated = await DunningService.updateDunningConfig(req, req.body);
            return res.status(200).json({ success: true, message: "Dunning reminder configuration updated.", data: updated });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/v1/billing/dunning/reminders/send
    static async sendReminder(req, res, next) {
        try {
            const reminder = await DunningService.sendReminder(req, req.body);
            return res.status(200).json({ success: true, message: "Reminder dispatched successfully.", data: reminder });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/v1/billing/dunning/waivers
    static async getWaivers(req, res, next) {
        try {
            const waivers = await DunningService.getWaivers(req);
            return res.status(200).json({ success: true, data: waivers });
        } catch (error) {
            return next(error);
        }
    }

    // POST /api/v1/billing/dunning/waivers
    static async waiveFine(req, res, next) {
        try {
            const waiver = await DunningService.waiveFine(req, req.body);
            return res.status(201).json({ success: true, message: "Fine waived successfully with audit log entry.", data: waiver });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/v1/billing/dunning/run
    static async runDunningProcess(req, res, next) {
        try {
            const result = await DunningService.runDunningProcess(req);
            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            return res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = DunningController;
