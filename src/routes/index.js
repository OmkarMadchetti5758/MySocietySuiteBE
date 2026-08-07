const router = require("express").Router();

router.use("/health", require("./health.routes"));
router.use("/auth", require("./auth.routes"));

module.exports = router;