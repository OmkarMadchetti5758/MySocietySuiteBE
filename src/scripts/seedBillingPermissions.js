"use strict";

const { getMasterConnection } = require("../config/masterDb");
const { BILLING_PERMISSIONS, BILLING_ROLE_MATRIX } = require("../common/billingPermissions");
const { ROLES } = require("../common/constants");

/**
 * Idempotent Seed Script for Billing Actions & RBAC Permissions Matrix
 */
async function seedBillingPermissions() {
    console.log("[SEED] Initializing Billing Permissions Seed...");
    const masterDb = getMasterConnection();

    // Ensure Master DB connection is ready
    if (masterDb.readyState !== 1) {
        await new Promise((resolve) => masterDb.once("open", resolve));
    }

    const PermissionModel = masterDb.model("Permission");
    const RoleModel = masterDb.model("Role");

    // 1. Seed Permission Catalog Entry for Billing Accounts if not existing
    const billingModuleKey = "billingAccounts";
    const existingPerm = await PermissionModel.findOne({ moduleKey: billingModuleKey });

    if (!existingPerm) {
        await PermissionModel.create({
            moduleKey: billingModuleKey,
            moduleName: "Billing & Accounts",
            sortOrder: 2,
            validAccessLevels: ["none", "view", "full"],
            hardBlockedFor: [ROLES.SECURITY_GUARD, ROLES.VENDOR],
            description: "Granular Accounting, Billing & Invoicing permissions",
        });
        console.log(`[SEED] Created Permission catalog entry for '${billingModuleKey}'`);
    } else {
        console.log(`[SEED] Permission catalog entry for '${billingModuleKey}' already exists.`);
    }

    // 2. Seed / Update GLOBAL Role Default Matrices
    const globalRolesToUpdate = [
        { roleKey: ROLES.ADMIN, roleName: "Committee / Society Admin" },
        { roleKey: ROLES.ACCOUNTANT, roleName: "Accountant" },
        { roleKey: ROLES.RESIDENT_OWNER, roleName: "Resident Owner" },
        { roleKey: ROLES.RESIDENT_TENANT, roleName: "Resident Tenant" },
    ];

    for (const item of globalRolesToUpdate) {
        const rolePermissionsList = BILLING_ROLE_MATRIX[item.roleKey] || [];
        const accessLevel = item.roleKey === ROLES.ADMIN || item.roleKey === ROLES.ACCOUNTANT ? "full" : "view_pay_own";

        let globalRoleDoc = await RoleModel.findOne({ societyId: "GLOBAL", roleKey: item.roleKey });
        if (!globalRoleDoc) {
            globalRoleDoc = new RoleModel({
                societyId: "GLOBAL",
                roleKey: item.roleKey,
                roleName: item.roleName,
                isSystemRole: true,
                isEditable: item.roleKey !== ROLES.ADMIN,
                permissions: new Map(),
            });
        }

        // Set or update billingAccounts module permission
        const permsMap = globalRoleDoc.permissions || new Map();
        permsMap.set(billingModuleKey, { access: accessLevel, enabled: true });
        globalRoleDoc.permissions = permsMap;
        globalRoleDoc.updatedAt = new Date();

        await globalRoleDoc.save();
        console.log(`[SEED] Successfully updated GLOBAL role template for '${item.roleKey}' (${rolePermissionsList.length} billing actions configured).`);
    }

    console.log("[SEED] Billing Permissions Seed Completed Idempotently.");
}

module.exports = seedBillingPermissions;

if (require.main === module) {
    const { connectMasterDb } = require("../config/masterDb");
    const { connectOperationsDb } = require("../config/operationsDb");
    const env = require("../config/env");

    (async () => {
        try {
            await connectMasterDb(env.MONGO_MASTER_URI);
            await connectOperationsDb(env.MONGO_OPS_URI);
            await seedBillingPermissions();
            process.exit(0);
        } catch (err) {
            console.error("[SEED ERROR]", err);
            process.exit(1);
        }
    })();
}
