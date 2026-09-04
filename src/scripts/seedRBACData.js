"use strict";

/**
 * seedRBACData.js
 *
 * Seeds the RBAC foundation data into the Master DB:
 *   1. 13 Permission catalog docs (one per module from BRD §7.2)
 *   2. 7 GLOBAL Role docs (one per society-level role from BRD §7.1)
 *      societyId = "GLOBAL" → system defaults; societies fall back to these
 *      until a Committee Admin customizes a role (copy-on-write).
 *
 * Safe to re-run: uses upsert (updateOne with upsert:true) — idempotent.
 *
 * Usage:
 *   node src/scripts/seedRBACData.js
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const mongoose = require("mongoose");
const { connectMasterDB, getMasterConnection } = require("../config/masterDb");

// ─── Permission Catalog (13 modules) ──────────────────────────────────────────
const PERMISSION_CATALOG = [
    {
        moduleKey:        "societyFlatSetup",
        moduleName:       "Society & Flat Setup",
        sortOrder:        1,
        validAccessLevels: ["none", "view", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "Configure society structure, blocks, and flat assignments.",
    },
    {
        moduleKey:        "billingAccounts",
        moduleName:       "Billing & Accounts",
        sortOrder:        2,
        validAccessLevels: ["none", "view", "view_pay_own", "full"],
        hardBlockedFor:  ["security_guard", "facility_manager", "vendor"],
        description:     "Manage maintenance billing, payments, and financial accounts.",
    },
    {
        moduleKey:        "visitorManagement",
        moduleName:       "Visitor Management",
        sortOrder:        3,
        validAccessLevels: ["none", "view", "approve_own", "full"],
        hardBlockedFor:  ["vendor"],
        description:     "Log and manage visitor entries and approvals.",
    },
    {
        moduleKey:        "complaintsHelpdesk",
        moduleName:       "Complaints & Helpdesk",
        sortOrder:        4,
        validAccessLevels: ["none", "view", "raise_own", "manage_assigned", "full"],
        hardBlockedFor:  [],
        description:     "Raise, track, and resolve complaints and helpdesk tickets.",
    },
    {
        moduleKey:        "noticeBoardPolls",
        moduleName:       "Notice Board & Polls",
        sortOrder:        5,
        validAccessLevels: ["none", "view", "vote", "full"],
        hardBlockedFor:  ["vendor"],
        description:     "Post notices, announcements, and run society polls.",
    },
    {
        moduleKey:        "amenityBooking",
        moduleName:       "Amenity Booking",
        sortOrder:        6,
        validAccessLevels: ["none", "view", "book_own", "manage", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "Configure amenities and manage bookings.",
    },
    {
        moduleKey:        "parkingManagement",
        moduleName:       "Parking Management",
        sortOrder:        7,
        validAccessLevels: ["none", "view", "manage", "full"],
        hardBlockedFor:  ["vendor"],
        description:     "Manage parking slots, allocations, and vehicle entries.",
    },
    {
        moduleKey:        "vendorManagement",
        moduleName:       "Vendor Management",
        sortOrder:        8,
        validAccessLevels: ["none", "view", "view_own_profile", "full"],
        hardBlockedFor:  ["security_guard", "resident_owner", "resident_tenant"],
        description:     "Onboard, manage, and review vendor contracts and work orders.",
    },
    {
        moduleKey:        "staffManagement",
        moduleName:       "Staff Management",
        sortOrder:        9,
        validAccessLevels: ["none", "view", "manage", "full"],
        hardBlockedFor:  ["security_guard", "resident_owner", "resident_tenant", "vendor"],
        description:     "Manage society staff, attendance, and payroll.",
    },
    {
        moduleKey:        "documentsManager",
        moduleName:       "Documents Manager",
        sortOrder:        10,
        validAccessLevels: ["none", "view", "view_restricted", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "Upload and manage society documents, circulars, and legal files.",
    },
    {
        moduleKey:        "reportsDashboard",
        moduleName:       "Reports & Dashboard",
        sortOrder:        11,
        validAccessLevels: ["none", "view", "financial", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "View and export society-level reports and analytics.",
    },
    {
        moduleKey:        "aiAssistant",
        moduleName:       "MySociety AI Assistant",
        sortOrder:        12,
        validAccessLevels: ["none", "view", "financial_queries", "facility_queries", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "AI-powered queries about your society's data.",
    },
    {
        moduleKey:        "festivalCollectionManagement",
        moduleName:       "Festival Collection Management",
        sortOrder:        13,
        validAccessLevels: ["none", "view", "pay_own", "financial", "full"],
        hardBlockedFor:  ["security_guard", "vendor"],
        description:     "Manage festival fund collections and contributions.",
    },
];

// ─── GLOBAL Role Templates (BRD §7.2) ─────────────────────────────────────────
// Super Admin is EXCLUDED — it's platform-level, managed in a separate system.
// society admins never see or edit the super_admin role.
const GLOBAL_ROLES = [
    {
        roleKey:      "admin",
        roleName:     "Committee / Society Admin",
        isSystemRole: true,
        isEditable:   false, // Committee Admin CANNOT edit their own role (self-elevation prevention)
        permissions: {
            societyFlatSetup:             { access: "full",           enabled: true  },
            billingAccounts:              { access: "full",           enabled: true  },
            visitorManagement:            { access: "view",           enabled: true  },
            complaintsHelpdesk:           { access: "full",           enabled: true  },
            noticeBoardPolls:             { access: "full",           enabled: true  },
            amenityBooking:               { access: "full",           enabled: true  },
            parkingManagement:            { access: "full",           enabled: true  },
            vendorManagement:             { access: "full",           enabled: true  },
            staffManagement:              { access: "full",           enabled: true  },
            documentsManager:             { access: "full",           enabled: true  },
            reportsDashboard:             { access: "full",           enabled: true  },
            aiAssistant:                  { access: "full",           enabled: true  },
            festivalCollectionManagement: { access: "full",           enabled: true  },
        },
    },
    {
        roleKey:      "accountant",
        roleName:     "Accountant",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "view",            enabled: true  },
            billingAccounts:              { access: "full",            enabled: true  },
            visitorManagement:            { access: "none",            enabled: false },
            complaintsHelpdesk:           { access: "view",            enabled: true  },
            noticeBoardPolls:             { access: "view",            enabled: true  },
            amenityBooking:               { access: "view",            enabled: true  },
            parkingManagement:            { access: "view",            enabled: true  },
            vendorManagement:             { access: "view",            enabled: true  },
            staffManagement:              { access: "view",            enabled: true  },
            documentsManager:             { access: "view",            enabled: true  },
            reportsDashboard:             { access: "financial",       enabled: true  },
            aiAssistant:                  { access: "financial_queries", enabled: true },
            festivalCollectionManagement: { access: "financial",       enabled: true  },
        },
    },
    {
        roleKey:      "resident_owner",
        roleName:     "Resident (Owner)",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "view",      enabled: true  },
            billingAccounts:              { access: "view_pay_own", enabled: true },
            visitorManagement:            { access: "approve_own", enabled: true },
            complaintsHelpdesk:           { access: "raise_own", enabled: true  },
            noticeBoardPolls:             { access: "vote",       enabled: true  },
            amenityBooking:               { access: "book_own",   enabled: true  },
            parkingManagement:            { access: "manage",     enabled: true  },
            vendorManagement:             { access: "none",       enabled: false },
            staffManagement:              { access: "none",       enabled: false },
            documentsManager:             { access: "view",       enabled: true  },
            reportsDashboard:             { access: "view",       enabled: true  },
            aiAssistant:                  { access: "full",       enabled: true  },
            festivalCollectionManagement: { access: "pay_own",    enabled: true  },
        },
    },
    {
        roleKey:      "resident_tenant",
        roleName:     "Resident (Tenant)",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "view",            enabled: true  },
            billingAccounts:              { access: "view_pay_own",    enabled: true  },
            visitorManagement:            { access: "approve_own",     enabled: true  },
            complaintsHelpdesk:           { access: "raise_own",       enabled: true  },
            noticeBoardPolls:             { access: "vote",            enabled: true  },
            amenityBooking:               { access: "book_own",        enabled: true  },
            parkingManagement:            { access: "manage",          enabled: true  },
            vendorManagement:             { access: "none",            enabled: false },
            staffManagement:              { access: "none",            enabled: false },
            documentsManager:             { access: "view_restricted", enabled: true  }, // No ownership/legal docs
            reportsDashboard:             { access: "view",            enabled: true  },
            aiAssistant:                  { access: "full",            enabled: true  },
            festivalCollectionManagement: { access: "pay_own",         enabled: true  },
        },
    },
    {
        roleKey:      "security_guard",
        roleName:     "Security Guard",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "none",  enabled: false },
            billingAccounts:              { access: "none",  enabled: false },
            visitorManagement:            { access: "full",  enabled: true  }, // Entry logging only (guard interface)
            complaintsHelpdesk:           { access: "none",  enabled: false },
            noticeBoardPolls:             { access: "view",  enabled: true  },
            amenityBooking:               { access: "none",  enabled: false },
            parkingManagement:            { access: "manage", enabled: true  },
            vendorManagement:             { access: "none",  enabled: false },
            staffManagement:              { access: "none",  enabled: false },
            documentsManager:             { access: "none",  enabled: false },
            reportsDashboard:             { access: "none",  enabled: false },
            aiAssistant:                  { access: "none",  enabled: false },
            festivalCollectionManagement: { access: "none",  enabled: false },
        },
    },
    {
        roleKey:      "facility_manager",
        roleName:     "Facility Manager",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "view",             enabled: true  },
            billingAccounts:              { access: "none",             enabled: false },
            visitorManagement:            { access: "view",             enabled: true  },
            complaintsHelpdesk:           { access: "manage",           enabled: true  },
            noticeBoardPolls:             { access: "view",             enabled: true  },
            amenityBooking:               { access: "manage",           enabled: true  },
            parkingManagement:            { access: "manage",           enabled: true  },
            vendorManagement:             { access: "view",             enabled: true  },
            staffManagement:              { access: "full",             enabled: true  },
            documentsManager:             { access: "view",             enabled: true  },
            reportsDashboard:             { access: "facility_queries", enabled: true  },
            aiAssistant:                  { access: "facility_queries", enabled: true  },
            festivalCollectionManagement: { access: "view",             enabled: true  },
        },
    },
    {
        roleKey:      "vendor",
        roleName:     "Vendor",
        isSystemRole: true,
        isEditable:   true,
        permissions: {
            societyFlatSetup:             { access: "none",             enabled: false },
            billingAccounts:              { access: "none",             enabled: false },
            visitorManagement:            { access: "none",             enabled: false },
            complaintsHelpdesk:           { access: "manage_assigned",  enabled: true  }, // Assigned complaints only
            noticeBoardPolls:             { access: "none",             enabled: false },
            amenityBooking:               { access: "none",             enabled: false },
            parkingManagement:            { access: "none",             enabled: false },
            vendorManagement:             { access: "view_own_profile", enabled: true  },
            staffManagement:              { access: "none",             enabled: false },
            documentsManager:             { access: "none",             enabled: false },
            reportsDashboard:             { access: "none",             enabled: false },
            aiAssistant:                  { access: "none",             enabled: false },
            festivalCollectionManagement: { access: "none",             enabled: false },
        },
    },
];

// ─── Main Seed Function ────────────────────────────────────────────────────────
async function seed() {
    try {
        await connectMasterDB();
        const masterDb = getMasterConnection();

        const Permission = masterDb.model("Permission");
        const Role       = masterDb.model("Role");

        console.log("\n🌱 Seeding Permission Catalog (13 modules)...");
        for (const perm of PERMISSION_CATALOG) {
            await Permission.updateOne(
                { moduleKey: perm.moduleKey },
                { $set: perm },
                { upsert: true }
            );
            console.log(`   ✅  ${perm.moduleKey}`);
        }

        console.log("\n🌱 Seeding GLOBAL Role Templates (7 roles)...");
        // Remove legacy roleKey from earlier seeds
        await Role.deleteOne({ societyId: "GLOBAL", roleKey: "committee_admin" });

        for (const role of GLOBAL_ROLES) {
            await Role.updateOne(
                { societyId: "GLOBAL", roleKey: role.roleKey },
                {
                    $set: {
                        societyId:    "GLOBAL",
                        roleKey:      role.roleKey,
                        roleName:     role.roleName,
                        isSystemRole: role.isSystemRole,
                        isEditable:   role.isEditable,
                        permissions:  role.permissions,
                        updatedAt:    new Date(),
                        updatedBy:    null,
                    },
                },
                { upsert: true }
            );
            console.log(`   ✅  ${role.roleKey} (${role.roleName})`);
        }

        console.log("\n✅ RBAC seed complete.\n");
    } catch (err) {
        console.error("❌ Seed failed:", err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

seed();
