"use strict";

const express = require("express");
const NoticeController = require("./notice.controller");
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
    NoticeController.getNotices
);

router.get(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.VIEW),
    NoticeController.getNoticeById
);

// Admins (FULL) can CREATE, UPDATE, DELETE
router.post(
    "/",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    NoticeController.createNotice
);

router.put(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    NoticeController.updateNotice
);

router.delete(
    "/:id",
    checkPermission(MODULES.NOTICE_BOARD_POLLS, PERMISSION_LEVELS.FULL),
    NoticeController.deleteNotice
);

module.exports = router;
