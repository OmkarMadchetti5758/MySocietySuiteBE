"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { connectMasterDB, getMasterConnection } = require("../config/masterDb");

const BASIC_MODULES = [
    "society_flat_setup", "societyFlatSetup",
    "residents",
    "notices", "notice_board_polls", "noticeBoardPolls",
    "events", "community_events",
    "staff", "staff_management", "staffManagement",
    "visitors", "visitor_management", "visitorManagement",
    "helpdesk", "complaints_helpdesk", "complaintsHelpdesk",
];

const PREMIUM_MODULES = [
    ...BASIC_MODULES,
    "festivals", "festival_collection", "festivalCollectionManagement",
    "polls",
    "vendors", "vendor_management", "vendorManagement",
    "amenities", "amenity_booking", "amenityBooking",
    "parking", "parking_management", "parkingManagement",
    "documents", "documents_manager", "documentsManager",
];

const ADVANCED_MODULES = [
    ...PREMIUM_MODULES,
    "billing", "billing_accounts", "billingAccounts",
    "reports", "reports_dashboard", "reportsDashboard",
    "ai", "ai_assistant", "aiAssistant",
    "settings",
];

const PLANS = [
    {
        name: "Basic",
        slug: "basic",
        tagline: "Core essentials for society management",
        price: 0,
        durationInMonths: 12,
        maxFlats: 1000,
        maxUsers: 5000,
        modules: BASIC_MODULES,
        features: [
            "Society & Flats",
            "Residents",
            "Notices",
            "Events",
            "Staff",
            "Visitors",
            "Helpdesk"
        ],
        isActive: true,
    },
    {
        name: "Premium",
        slug: "premium",
        tagline: "Everything in Basic, plus community & operations tools",
        price: 4999,
        durationInMonths: 12,
        maxFlats: 2500,
        maxUsers: 10000,
        modules: PREMIUM_MODULES,
        features: [
            "Everything in Basic",
            "Festivals",
            "Polls",
            "Vendors",
            "Amenities",
            "Parking",
            "Documents"
        ],
        isActive: true,
    },
    {
        name: "Advanced",
        slug: "advanced",
        tagline: "Full suite with financial accounts, reports, and AI assistant",
        price: 9999,
        durationInMonths: 12,
        maxFlats: 10000,
        maxUsers: 50000,
        modules: ADVANCED_MODULES,
        features: [
            "Everything in Premium",
            "Billing & Accounts",
            "Reports",
            "AI Assistant",
            "Settings"
        ],
        isActive: true,
    },
];

async function seedSubscriptionPlans() {
    console.log("\n🌱 [SEED] Starting Subscription Plans Seeding...");
    await connectMasterDB();
    const masterDb = getMasterConnection();
    const SubscriptionPlan = masterDb.model("SubscriptionPlan");
    const Society = masterDb.model("Society");

    const planMap = {};

    for (const planData of PLANS) {
        const plan = await SubscriptionPlan.findOneAndUpdate(
            { slug: planData.slug },
            { $set: planData },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        planMap[plan.slug] = plan;
        console.log(`✅ Seeded/Updated Plan: ${plan.name} (${plan.slug}) [${plan._id}]`);
    }

    // Assign 'Advanced' plan to existing societies if they don't have a subscriptionPlanId
    const advancedPlan = planMap["advanced"];
    if (advancedPlan) {
        const result = await Society.updateMany(
            { $or: [{ subscriptionPlanId: { $exists: false } }, { subscriptionPlanId: null }] },
            { $set: { subscriptionPlanId: advancedPlan._id } }
        );
        if (result.modifiedCount > 0) {
            console.log(`🔄 Updated ${result.modifiedCount} existing societies to default '${advancedPlan.name}' plan.`);
        }
    }

    console.log("🎉 [SEED] Subscription Plans Seeding Complete.\n");
    return planMap;
}

if (require.main === module) {
    seedSubscriptionPlans()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("❌ Seed failed:", err);
            process.exit(1);
        });
}

module.exports = seedSubscriptionPlans;
