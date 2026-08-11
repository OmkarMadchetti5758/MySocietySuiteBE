const router = require("express").Router();

router.use("/health", require("./health.routes"));
router.use("/auth", require("./auth.routes"));
router.use("/super-admin", require("../modules/superAdmin/superAdmin.routes"));

module.exports = router;