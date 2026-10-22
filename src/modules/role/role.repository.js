"use strict";

const { getMasterConnection } = require("../../config/masterDb");
const { getOperationsConnection } = require("../../config/operationsDb");
const { bustPermissionsVersionCache } = require("../../common/permissionsVersionCache");

const MODULE_ALIASES_MAP = Object.freeze({
    society_flat_setup: ["societyFlatSetup", "society_flat_setup", "society_setup"],
    societyFlatSetup: ["society_flat_setup", "societyFlatSetup", "society_setup"],
    residents: ["residents", "societyFlatSetup", "society_flat_setup"],
    visitor_management: ["visitorManagement", "visitor_management", "visitors"],
    visitorManagement: ["visitor_management", "visitorManagement", "visitors"],
    complaints_helpdesk: ["complaintsHelpdesk", "complaints_helpdesk", "helpdesk"],
    complaintsHelpdesk: ["complaints_helpdesk", "complaintsHelpdesk", "helpdesk"],
    notices: ["notices", "noticeBoardPolls", "notice_board_polls"],
    polls: ["polls", "noticeBoardPolls", "notice_board_polls"],
    notice_board_polls: ["noticeBoardPolls", "notice_board_polls", "notices", "polls"],
    noticeBoardPolls: ["notice_board_polls", "noticeBoardPolls", "notices", "polls"],
    amenity_booking: ["amenityBooking", "amenity_booking", "amenities"],
    amenityBooking: ["amenity_booking", "amenityBooking", "amenities"],
    parking_management: ["parkingManagement", "parking_management", "parking"],
    parkingManagement: ["parking_management", "parkingManagement", "parking"],
    vendor_management: ["vendorManagement", "vendor_management", "vendors"],
    vendorManagement: ["vendor_management", "vendorManagement", "vendors"],
    staff_management: ["staffManagement", "staff_management", "staff"],
    staffManagement: ["staff_management", "staffManagement", "staff"],
    documents_manager: ["documentsManager", "documents_manager", "documents"],
    documentsManager: ["documents_manager", "documentsManager", "documents"],
    reports_dashboard: ["reportsDashboard", "reports_dashboard", "reports"],
    reportsDashboard: ["reports_dashboard", "reportsDashboard", "reports"],
    ai_assistant: ["aiAssistant", "ai_assistant", "ai"],
    aiAssistant: ["ai_assistant", "aiAssistant", "ai"],
    festivals: ["festivals", "festivalCollectionManagement", "festival_collection"],
    festival_collection: ["festivalCollectionManagement", "festival_collection", "festivals"],
    festivalCollectionManagement: ["festival_collection", "festivalCollectionManagement", "festivals"],
    community_events: ["community_events", "communityEvents", "events"],
    communityEvents: ["community_events", "communityEvents", "events"],
    events: ["community_events", "communityEvents", "events"],
    settings: ["settings"],
    billing_accounts: ["billingAccounts", "billing_accounts", "billing"],
    billingAccounts: ["billing_accounts", "billingAccounts", "billing"],
});

class RoleRepository {
    _masterDb() { return getMasterConnection(); }
    _opsDb() { return getOperationsConnection(); }

    async _resolvePlanModules(plan) {
        if (!plan) return null;
        const mongoose = require("mongoose");
        const masterDb = this._masterDb();
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");

        let allModuleIds = [];
        let curr = plan;
        const visitedPlanIds = new Set();

        while (curr && curr._id && !visitedPlanIds.has(String(curr._id))) {
            visitedPlanIds.add(String(curr._id));
            if (Array.isArray(curr.modules)) {
                allModuleIds.push(...curr.modules);
            }
            if (curr.inheritsFrom) {
                curr = await SubscriptionPlan.findById(curr.inheritsFrom).lean();
            } else {
                curr = null;
            }
        }

        const objectIds = allModuleIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
        const rawStrings = allModuleIds.filter((id) => typeof id === "string" && !mongoose.Types.ObjectId.isValid(id));

        const resolvedKeys = new Set(rawStrings);

        if (objectIds.length > 0) {
            try {
                const moduleDocs = await masterDb.collection("modules").find({
                    _id: { $in: objectIds.map((id) => new mongoose.Types.ObjectId(id)) }
                }).toArray();

                for (const doc of moduleDocs) {
                    if (doc.key) resolvedKeys.add(doc.key);
                }
            } catch (_) {}
        }

        const MODULE_ALIASES = {
            festivals: ["festivals", "festival_collection", "festivalCollectionManagement", "community_events"],
            festival_collection: ["festivals", "festival_collection", "festivalCollectionManagement", "community_events"],
            community_events: ["events", "community_events", "festivals", "festival_collection"],
            notices: ["notices", "notice_board_polls", "noticeBoardPolls"],
            polls: ["polls", "notice_board_polls", "noticeBoardPolls"],
            notice_board_polls: ["notices", "polls", "notice_board_polls", "noticeBoardPolls"],
            society_flat_setup: ["society_flat_setup", "societyFlatSetup", "residents"],
            residents: ["society_flat_setup", "societyFlatSetup", "residents"],
            billing_accounts: ["billing_accounts", "billingAccounts", "billing"],
            visitor_management: ["visitor_management", "visitorManagement", "visitors"],
            complaints_helpdesk: ["complaints_helpdesk", "complaintsHelpdesk", "helpdesk"],
            amenity_booking: ["amenity_booking", "amenityBooking", "amenities"],
            parking_management: ["parking_management", "parkingManagement", "parking"],
            vendor_management: ["vendor_management", "vendorManagement", "vendors"],
            staff_management: ["staff_management", "staffManagement", "staff"],
            documents_manager: ["documents_manager", "documentsManager", "documents"],
            reports_dashboard: ["reports_dashboard", "reportsDashboard", "reports"],
            ai_assistant: ["ai_assistant", "aiAssistant", "ai"],
            settings: ["settings"],
        };

        const expanded = new Set(resolvedKeys);
        for (const key of resolvedKeys) {
            if (MODULE_ALIASES[key]) {
                MODULE_ALIASES[key].forEach((alias) => expanded.add(alias));
            }
        }

        return {
            ...plan,
            modules: Array.from(expanded),
        };
    }

    async getSocietyPlan(societyId) {
        if (!societyId || societyId === "GLOBAL") return null;
        const masterDb = this._masterDb();
        const Society = masterDb.model("Society");
        const SubscriptionPlan = masterDb.model("SubscriptionPlan");

        let society = null;
        const mongoose = require("mongoose");
        if (mongoose.Types.ObjectId.isValid(societyId)) {
            society = await Society.findById(societyId).populate("subscriptionPlanId").lean();
        }
        if (!society) {
            society = await Society.findOne({
                $or: [{ societyCode: societyId }, { name: societyId }]
            }).populate("subscriptionPlanId").lean();
        }

        let plan = society?.subscriptionPlanId;
        if (!plan) {
            plan = await SubscriptionPlan.findOne({ slug: "advanced" }).lean();
        }

        return this._resolvePlanModules(plan);
    }

    async getPermissionCatalog() {
        const Permission = this._masterDb().model("Permission");
        return Permission.find({ isDeprecated: { $ne: true } })
            .sort({ sortOrder: 1 })
            .lean();
    }

    async getRolesForSociety(societyId) {
        const Role = this._masterDb().model("Role");

        // Fetch both society-specific overrides and GLOBAL docs in one query
        const all = await Role.find({
            societyId: { $in: [societyId, "GLOBAL"] },
            roleKey: { $ne: "super_admin" },          // Super Admin is never shown
        }).lean();

        // Group by roleKey - society-specific wins over GLOBAL
        const map = new Map();
        for (const doc of all) {
            const key = doc.roleKey;
            if (!map.has(key)) {
                map.set(key, doc);
            } else {
                // If we already have a doc for this key, prefer the society-specific one
                const existing = map.get(key);
                if (doc.societyId !== "GLOBAL") {
                    map.set(key, doc); // society-specific overrides GLOBAL
                } else if (existing.societyId === "GLOBAL") {
                    // keep existing (both are GLOBAL, shouldn't happen but guard)
                }
            }
        }

        return Array.from(map.values());
    }

    async getRoleByKey(societyId, roleKey) {
        const Role = this._masterDb().model("Role");

        // Try society-specific first
        let doc = await Role.findOne({ societyId, roleKey }).lean();
        if (doc) return { ...doc, _isOverride: true };

        // Fall back to GLOBAL
        doc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
        if (doc) return { ...doc, _isOverride: false };

        return null;
    }

    async getGlobalRole(roleKey) {
        const Role = this._masterDb().model("Role");
        return Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
    }

    async upsertRolePermissions(societyId, roleKey, permDiff, actorId, actorName) {
        const Role = this._masterDb().model("Role");

        // Find or seed the society-specific doc
        let doc = await Role.findOne({ societyId, roleKey });

        if (!doc) {
            // Copy-on-write: clone the GLOBAL template
            const globalDoc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
            if (!globalDoc) {
                throw new Error(`No GLOBAL template found for role: ${roleKey}`);
            }

            // Create a new society-specific doc from GLOBAL
            doc = new Role({
                societyId,
                roleKey: globalDoc.roleKey,
                roleName: globalDoc.roleName,
                isSystemRole: globalDoc.isSystemRole,
                isEditable: globalDoc.isEditable,
                permissions: new Map(Object.entries(globalDoc.permissions || {})),
                updatedAt: new Date(),
                updatedBy: actorId,
            });
        }

        // Snapshot before-state for audit
        const before = Object.fromEntries(doc.permissions || new Map());

        // Apply diff - only update moduleKeys present in the diff
        for (const [moduleKey, patch] of Object.entries(permDiff)) {
            const existing = doc.permissions.get(moduleKey) || {};
            doc.permissions.set(moduleKey, {
                access: patch.access !== undefined ? patch.access : existing.access,
                enabled: patch.enabled !== undefined ? patch.enabled : existing.enabled,
            });
        }

        doc.updatedAt = new Date();
        doc.updatedBy = actorId;
        doc.markModified("permissions"); // Mongoose requires this for Map fields

        await doc.save();

        // Snapshot after-state for audit
        const after = Object.fromEntries(doc.permissions);

        // Write audit log
        await this._writeAudit({
            societyId,
            roleKey,
            changedBy: actorId,
            changedByName: actorName,
            before,
            after,
            action: "update",
        });

        return doc.toObject();
    }

    async deleteSocietyOverride(societyId, roleKey, actorId, actorName) {
        const Role = this._masterDb().model("Role");

        const doc = await Role.findOne({ societyId, roleKey }).lean();
        if (!doc) return null; // Nothing to reset - already at GLOBAL

        const before = doc.permissions || {};

        await Role.deleteOne({ societyId, roleKey });

        // Fetch GLOBAL to capture "after" state for audit
        const globalDoc = await Role.findOne({ societyId: "GLOBAL", roleKey }).lean();
        const after = globalDoc ? (globalDoc.permissions || {}) : {};

        await this._writeAudit({
            societyId,
            roleKey,
            changedBy: actorId,
            changedByName: actorName,
            before,
            after,
            action: "reset",
        });

        return true;
    }

    /**
     * Bump the permissionsVersion counter on the Society doc.
     * Called after every successful role write.
     */
    async bumpPermissionsVersion(societyId) {
        const masterDb = this._masterDb();
        const Society = masterDb.model("Society");
        await Society.updateOne(
            { _id: societyId },
            { $inc: { permissionsVersion: 1 } }
        );
        bustPermissionsVersionCache(societyId);
    }

    /**
     * Fetch the latest audit entry for a role (for "last changed by X on Y" UI).
     */
    async getLatestAudit(societyId, roleKey) {
        if (!societyId || societyId === "GLOBAL") return null;
        const opsDb = this._opsDb();
        const Audit = opsDb.model("RolePermissionAudit");
        return Audit.findOne({ societyId, roleKey })
            .sort({ changedAt: -1 })
            .lean();
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    async _writeAudit({ societyId, roleKey, changedBy, changedByName, before, after, action }) {
        const Audit = this._opsDb().model("RolePermissionAudit");
        await Audit.create({
            societyId,
            roleKey,
            changedBy,
            changedByName,
            changedAt: new Date(),
            diff: { before, after },
            action,
        });
    }
}

module.exports = new RoleRepository();
