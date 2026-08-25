"use strict";

const express = require("express");
const PollController = require("./poll.controller");
const authenticate = require("../../middleware/authenticate");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");
const injectSocietyId = require("../../middleware/injectSocietyId");

const router = express.Router({ mergeParams: true });

router.use(authenticate);
router.use(injectSocietyId);

// Residents and above can VIEW
router.get(
    "/",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.VIEW),
    PollController.getPolls
);

router.get(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.VIEW),
    PollController.getPollById
);

// Residents and above can vote and see results
router.post(
    "/:id/vote",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.VIEW),
    PollController.votePoll
);

router.get(
    "/:id/results",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.VIEW),
    PollController.getPollResults
);

// Admins (FULL) can CREATE, UPDATE, DELETE
router.post(
    "/",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    PollController.createPoll
);

router.put(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    PollController.updatePoll
);

router.delete(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    PollController.deletePoll
);

module.exports = router;
