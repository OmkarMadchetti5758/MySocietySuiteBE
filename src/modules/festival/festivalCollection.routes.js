"use strict";

const express = require("express");
const router = express.Router();

const festivalCollectionController = require("./festivalCollection.controller");
const authenticate = require("../../middleware/authenticate");
const injectSocietyId = require("../../middleware/injectSocietyId");
const checkPermission = require("../../middleware/checkPermission");
const { MODULES, PERMISSION_LEVELS } = require("../../common/constants");

router.use(authenticate);
router.use(injectSocietyId);

// Residents, Admins, Accountants can fetch collections
router.get("/", festivalCollectionController.getCollections);
router.get("/:id", festivalCollectionController.getCollectionById);
router.get("/:id/resident-status", festivalCollectionController.getResidentStatus);
router.get("/:id/contributions/:contributionId/receipt", festivalCollectionController.downloadContributionReceipt);

// Resident Online Payment
router.post("/:id/pay/online/initiate", festivalCollectionController.initiateOnlinePayment);
router.post("/:id/pay/online/verify", festivalCollectionController.verifyOnlinePayment);

// Admin / Accountant Actions
router.post(
    "/",
    checkPermission([MODULES.FESTIVAL_COLLECTION, MODULES.COMMUNITY_EVENTS], PERMISSION_LEVELS.FULL),
    festivalCollectionController.createCollection
);

router.patch(
    "/:id",
    checkPermission([MODULES.FESTIVAL_COLLECTION, MODULES.COMMUNITY_EVENTS], PERMISSION_LEVELS.FULL),
    festivalCollectionController.updateCollection
);

router.post(
    "/:id/pay/offline",
    checkPermission([MODULES.FESTIVAL_COLLECTION, MODULES.COMMUNITY_EVENTS], PERMISSION_LEVELS.MANAGE), // Allows recording offline payment
    festivalCollectionController.recordOfflineContribution
);

router.get(
    "/:id/contributions",
    checkPermission([MODULES.FESTIVAL_COLLECTION, MODULES.COMMUNITY_EVENTS], PERMISSION_LEVELS.VIEW),
    festivalCollectionController.getContributions
);

router.get(
    "/:id/report",
    checkPermission([MODULES.FESTIVAL_COLLECTION, MODULES.COMMUNITY_EVENTS], PERMISSION_LEVELS.VIEW),
    festivalCollectionController.getCollectionReport
);

module.exports = router;
