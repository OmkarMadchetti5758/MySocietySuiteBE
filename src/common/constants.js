"use strict";

const ROLES = Object.freeze({
    // MSquare platform-level
    SUPER_ADMIN: "super_admin",

    // Society-level management
    ADMIN: "admin",
    COMMITTEE_MEMBER: "committee_member",

    // Finance
    ACCOUNTANT: "accountant",

    // Residents
    RESIDENT_OWNER: "resident_owner",
    RESIDENT_TENANT: "resident_tenant",
    RESIDENT: "resident",

    // Operations
    SECURITY_GUARD: "security_guard",
    SECURITY: "security",
    GUARD_MANAGER: "guard_manager",
    FACILITY_MANAGER: "facility_manager",

    // External
    VENDOR: "vendor",
    VENDOR_MANAGER: "vendor_manager",
    STAFF: "staff",
    GENERAL_STAFF: "general_staff",
});

// Separate enum/lookup table for what the job actually is — display, filtering, reporting only
const STAFF_DESIGNATIONS = Object.freeze({
    HOUSEKEEPING: "housekeeping",
    GARDENER: "gardener",
    ELECTRICIAN: "electrician",
    PLUMBER: "plumber",
    CARPENTER: "carpenter",
    PEST_CONTROL: "pest_control",
    LIFT_TECHNICIAN: "lift_technician",
    SWEEPER: "sweeper",
    OTHER: "other",
});

// ─── Modules (13 platform modules) ────────────────────────────────────────────
const MODULES = Object.freeze({
    SOCIETY_FLAT_SETUP: "society_flat_setup",
    BILLING_ACCOUNTS: "billing_accounts",
    VISITOR_MANAGEMENT: "visitor_management",
    COMPLAINTS_HELPDESK: "complaints_helpdesk",
    NOTICE_BOARD_POLLS: "notice_board_polls",
    AMENITY_BOOKING: "amenity_booking",
    PARKING_MANAGEMENT: "parking_management",
    VENDOR_MANAGEMENT: "vendor_management",
    STAFF_MANAGEMENT: "staff_management",
    DOCUMENTS_MANAGER: "documents_manager",
    REPORTS_DASHBOARD: "reports_dashboard",
    AI_ASSISTANT: "ai_assistant",
    FESTIVAL_COLLECTION: "festival_collection",
    COMMUNITY_EVENTS: "community_events",
    SETTINGS: "settings",
});

const PERMISSION_LEVELS = Object.freeze({
    NO_ACCESS: 0,
    VIEW: 1,
    MANAGE: 2, // Read + update/process assigned items
    FULL: 3, // Create, Read, Update, Delete
});

const PERMISSION_SCOPE = Object.freeze({
    ALL: "all",        // Platform-wide or society-wide
    SOCIETY: "society",    // Restricted to the user's society
    PLATFORM: "platform",   // Super Admin — cross-society platform view
    OWN: "own",        // Only the user's own records / flat
    ASSIGNED: "assigned",   // Only records explicitly assigned to this user
    FINANCIAL: "financial",  // Only financial reports / queries
    FACILITY: "facility",   // Facility-related reports/operations only
    RESTRICTED: "restricted", // View permitted, but certain categories blocked
    NONE: null,
});

// ─── Role → Module Permission Matrix ──────────────────────────────────────────
// Each cell: { level: PERMISSION_LEVELS.*, scope: PERMISSION_SCOPE.* }
// Level drives the BE gate; scope drives the FE filter and query filter.
const ROLE_PERMISSIONS = Object.freeze({

    // ── 1. Super Admin (MSquare) ──────────────────────────────────────────────
    [ROLES.SUPER_ADMIN]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.PLATFORM },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.PLATFORM },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.PLATFORM },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.PLATFORM },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.PLATFORM },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.PLATFORM },
    },

    // ── 2. Committee / Society Admin ─────────────────────────────────────────
    [ROLES.ADMIN]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
    },

    // ── 3. Accountant ────────────────────────────────────────────────────────
    [ROLES.ACCOUNTANT]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.FINANCIAL },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.FINANCIAL },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.FINANCIAL },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    // ── 4. Resident (Owner) ───────────────────────────────────────────────────
    [ROLES.RESIDENT_OWNER]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.OWN },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },   // View & pay own
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },   // Approve own
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },   // Raise & track own
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY }, // View & vote
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },   // Book own
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY }, // View permitted
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.OWN },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.OWN },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },   // Pay own
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY }, // View published
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    // Identical to Owner except Documents Manager scope is RESTRICTED
    [ROLES.RESIDENT_TENANT]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.OWN },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.RESTRICTED }, // No ownership/legal docs
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.OWN },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.OWN },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.OWN },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY }, // View published
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.SECURITY_GUARD]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.SOCIETY }, // Guards can report violations & manage visitor parking
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.FACILITY_MANAGER]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.FACILITY },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.VENDOR]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.ASSIGNED },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.OWN },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.GUARD_MANAGER]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.ASSIGNED },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.ASSIGNED },  // Manage security staff
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.ASSIGNED },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.VENDOR_MANAGER]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.ASSIGNED },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.FULL, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.MANAGE, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.ASSIGNED },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },

    [ROLES.GENERAL_STAFF]: {
        [MODULES.SOCIETY_FLAT_SETUP]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.BILLING_ACCOUNTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VISITOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMPLAINTS_HELPDESK]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.NOTICE_BOARD_POLLS]: { level: PERMISSION_LEVELS.VIEW, scope: PERMISSION_SCOPE.SOCIETY },
        [MODULES.AMENITY_BOOKING]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.PARKING_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.VENDOR_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.STAFF_MANAGEMENT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.DOCUMENTS_MANAGER]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.REPORTS_DASHBOARD]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.AI_ASSISTANT]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.FESTIVAL_COLLECTION]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.COMMUNITY_EVENTS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
        [MODULES.SETTINGS]: { level: PERMISSION_LEVELS.NO_ACCESS, scope: PERMISSION_SCOPE.NONE },
    },
});

// Used in getRolePermissions() for backward compatibility
const ROLE_ALIAS_MAP = Object.freeze({
    [ROLES.COMMITTEE_MEMBER]: ROLES.ADMIN,
    committee_admin: ROLES.ADMIN,
    [ROLES.RESIDENT]: ROLES.RESIDENT_OWNER,
    [ROLES.SECURITY]: ROLES.SECURITY_GUARD,
    [ROLES.STAFF]: ROLES.FACILITY_MANAGER,
});

const getRolePermissions = (role) => {
    const resolvedRole = ROLE_ALIAS_MAP[role] || role;
    return ROLE_PERMISSIONS[resolvedRole] || null;
};

const SOCIETY_STATUS = Object.freeze({
    ACTIVE: "active",
    INACTIVE: "inactive",
    SUSPENDED: "suspended",
    TRIAL: "trial",
    PENDING_VERIFICATION: "pending_verification",
});

const USER_STATUS = Object.freeze({
    INVITED: "invited",
    ACTIVE: "active",
    INACTIVE: "inactive",
    SUSPENDED: "suspended",
});

const SUBSCRIPTION_STATUS = Object.freeze({
    ACTIVE: "active",
    EXPIRED: "expired",
    CANCELLED: "cancelled",
    TRIAL: "trial",
});

const FLAT_STATUS = Object.freeze({
    OCCUPIED: "occupied",
    VACANT: "vacant",
    UNDER_RENOVATION: "under_renovation",
});

const FLAT_TYPE = Object.freeze({
    OWNED: "owned",
    RENTED: "rented",
});

const RESIDENT_TYPE = Object.freeze({
    OWNER: "owner",
    TENANT: "tenant",
    FAMILY_MEMBER: "family_member",
});

const VISITOR_STATUS = Object.freeze({
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
    CHECKED_IN: "checked_in",
    CHECKED_OUT: "checked_out",
});

const COMPLAINT_STATUS = Object.freeze({
    OPEN: "open",
    IN_PROGRESS: "in_progress",
    RESOLVED: "resolved",
    CLOSED: "closed",
    REJECTED: "rejected",
});

const COMPLAINT_PRIORITY = Object.freeze({
    LOW: "low",
    MEDIUM: "medium",
    HIGH: "high",
    URGENT: "urgent",
});

const MAINTENANCE_STATUS = Object.freeze({
    PENDING: "pending",
    PAID: "paid",
    OVERDUE: "overdue",
    WAIVED: "waived",
});

const PAYMENT_METHOD = Object.freeze({
    CASH: "cash",
    ONLINE: "online",
    CHEQUE: "cheque",
    UPI: "upi",
    NEFT: "neft",
    BANK_TRANSFER: "bank_transfer",
});

const PAYMENT_STATUS = Object.freeze({
    PENDING: "pending",
    SUCCESS: "success",
    FAILED: "failed",
    REFUNDED: "refunded",
});

const BOOKING_STATUS = Object.freeze({
    PENDING: "pending",
    CONFIRMED: "confirmed",
    CANCELLED: "cancelled",
    COMPLETED: "completed",
    REJECTED: "rejected",
});

const NOTICE_TYPE = Object.freeze({
    GENERAL: "general",
    MAINTENANCE: "maintenance",
    EMERGENCY: "emergency",
    EVENT: "event",
    CIRCULAR: "circular",
});

const POLL_STATUS = Object.freeze({
    ACTIVE: "active",
    CLOSED: "closed",
    DRAFT: "draft",
});

const FESTIVAL_STATUS = Object.freeze({
    DRAFT: "DRAFT",
    PUBLISHED: "PUBLISHED",
    CANCELLED: "CANCELLED",
    COMPLETED: "COMPLETED",
});

const VEHICLE_TYPE = Object.freeze({
    CAR: "car",
    BIKE: "bike",
    SCOOTER: "scooter",
    BICYCLE: "bicycle",
    TRUCK: "truck",
    AUTO: "auto",
    OTHER: "other",
    FOUR_WHEELER: "FOUR_WHEELER",
    TWO_WHEELER: "TWO_WHEELER",
    EV_CHARGING: "EV_CHARGING",
    EV: "EV",
});

const PARKING_TYPE = Object.freeze({
    OPEN: "open",
    COVERED: "covered",
    BASEMENT: "basement",
    REGULAR: "regular",
    EV: "ev",
    VISITOR: "visitor",
    HANDICAPPED: "handicapped",
    FOUR_WHEELER: "FOUR_WHEELER",
    TWO_WHEELER: "TWO_WHEELER",
    EV_CHARGING: "EV_CHARGING",
    DISABLED: "DISABLED",
});

const PARKING_STATUS = Object.freeze({
    AVAILABLE: "available",
    OCCUPIED: "occupied",    // legacy alias
    ALLOCATED: "allocated",   // preferred term
    RESERVED: "reserved",
    MAINTENANCE: "maintenance",
    INACTIVE: "inactive",
});

const PARKING_ASSIGNMENT_STATUS = Object.freeze({
    ACTIVE: "active",
    RELEASED: "released",
    TRANSFERRED: "transferred",
});

const PARKING_ASSIGNMENT_TYPE = Object.freeze({
    PERMANENT: "permanent",
    TEMPORARY: "temporary",
    VISITOR: "visitor",
});

const VISITOR_PARKING_STATUS = Object.freeze({
    ACTIVE: "active",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
    EXPIRED: "expired",
});

const PARKING_REQUEST_STATUS = Object.freeze({
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
    CANCELLED: "cancelled",
});

const PARKING_VIOLATION_TYPE = Object.freeze({
    UNAUTHORIZED_PARKING: "unauthorized_parking",
    WRONG_SLOT: "wrong_slot",
    BLOCKING_ENTRY: "blocking_entry",
    PARKING_IN_VISITOR_SLOT: "parking_in_visitor_slot",
    PARKING_IN_RESERVED_SLOT: "parking_in_reserved_slot",
    OTHER: "other",
});

const PARKING_VIOLATION_STATUS = Object.freeze({
    OPEN: "open",
    RESOLVED: "resolved",
    DISMISSED: "dismissed",
});

const ATTENDANCE_STATUS = Object.freeze({
    PRESENT: "present",
    ABSENT: "absent",
    HALF_DAY: "half_day",
    ON_LEAVE: "on_leave",
});

const STAFF_TYPE = Object.freeze({
    SECURITY: "security",
    HOUSEKEEPING: "housekeeping",
    PLUMBER: "plumber",
    ELECTRICIAN: "electrician",
    GARDENER: "gardener",
    LIFT_OPERATOR: "lift_operator",
    WATCHMAN: "watchman",
    OTHER: "other",
});

const DOCUMENT_TYPE = Object.freeze({
    AGREEMENT: "agreement",
    NOC: "noc",
    CIRCULAR: "circular",
    MINUTES: "minutes",
    AUDIT_REPORT: "audit_report",
    OTHER: "other",
});

const NOTIFICATION_TYPE = Object.freeze({
    INFO: "info",
    WARNING: "warning",
    ALERT: "alert",
    PAYMENT: "payment",
    VISITOR: "visitor",
    COMPLAINT: "complaint",
    BOOKING: "booking",
    GENERAL: "general",
});

const AUDIT_ACTION = Object.freeze({
    CREATE: "create",
    UPDATE: "update",
    DELETE: "delete",
    LOGIN: "login",
    LOGOUT: "logout",
    APPROVE: "approve",
    REJECT: "reject",
    EXPORT: "export",
});

const TOKEN_TYPE = Object.freeze({
    ACCESS: "access",
    REFRESH: "refresh",
    OTP: "otp",
});

const PAGINATION = Object.freeze({
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
});

const DEPARTMENT_HEAD_ROLES = Object.freeze([
    {
        roleKey: ROLES.ACCOUNTANT,
        roleName: "Accountant",
        department: "Finance",
        allowMultiple: false,
    },
    {
        roleKey: ROLES.GUARD_MANAGER,
        roleName: "Guard Manager",
        department: "Security",
        allowMultiple: false,
    },
    {
        roleKey: ROLES.FACILITY_MANAGER,
        roleName: "Facility Manager",
        department: "Facility",
        allowMultiple: false,
    },
    {
        roleKey: ROLES.VENDOR_MANAGER,
        roleName: "Vendor Manager",
        department: "Procurement",
        allowMultiple: false,
    },
]);

module.exports = {
    ROLES,
    DEPARTMENT_HEAD_ROLES,
    SOCIETY_STATUS,
    USER_STATUS,
    SUBSCRIPTION_STATUS,
    FLAT_STATUS,
    FLAT_TYPE,
    RESIDENT_TYPE,
    VISITOR_STATUS,
    COMPLAINT_STATUS,
    COMPLAINT_PRIORITY,
    MAINTENANCE_STATUS,
    PAYMENT_METHOD,
    PAYMENT_STATUS,
    BOOKING_STATUS,
    NOTICE_TYPE,
    POLL_STATUS,
    FESTIVAL_STATUS,
    VEHICLE_TYPE,
    PARKING_TYPE,
    PARKING_STATUS,
    PARKING_ASSIGNMENT_STATUS,
    PARKING_ASSIGNMENT_TYPE,
    VISITOR_PARKING_STATUS,
    PARKING_REQUEST_STATUS,
    PARKING_VIOLATION_TYPE,
    PARKING_VIOLATION_STATUS,
    ATTENDANCE_STATUS,
    STAFF_TYPE,
    DOCUMENT_TYPE,
    NOTIFICATION_TYPE,
    AUDIT_ACTION,
    TOKEN_TYPE,
    PAGINATION,
    MODULES,
    PERMISSION_LEVELS,
    PERMISSION_SCOPE,
    ROLE_PERMISSIONS,
    ROLE_ALIAS_MAP,
    getRolePermissions,
    STAFF_DESIGNATIONS,
};
