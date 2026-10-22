"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const mongoose = require("mongoose");
const { connectMasterDB } = require("../config/masterDb");
const { MODULE_REGISTRY } = require("../common/moduleRegistry");

async function seedPlansAndModules() {
    console.log("=================================================");
    console.log("=== SEEDING MODULES & PLANS INTO MASTER DB ===");
    console.log("=================================================");

    const masterDb = await connectMasterDB();
    const Module = masterDb.model("Module");
    const SubscriptionPlan = masterDb.model("SubscriptionPlan");

    let modulesCreated = 0;
    let modulesUpdated = 0;
    let plansCreated = 0;
    let plansUpdated = 0;

    const moduleKeyMap = new Map();

    // 1. Upsert Modules from MODULE_REGISTRY
    console.log(`\nUpserting ${MODULE_REGISTRY.length} modules from canonical registry...`);

    for (let i = 0; i < MODULE_REGISTRY.length; i++) {
        const item = MODULE_REGISTRY[i];
        const existing = await Module.findOne({ key: item.key });

        const savedModule = await Module.findOneAndUpdate(
            { key: item.key },
            {
                $set: {
                    name: item.name,
                    category: item.category || "Core",
                    sortOrder: i + 1,
                    isActive: item.isActive !== undefined ? item.isActive : true,
                },
                $setOnInsert: {
                    description: `${item.name} management module`,
                    icon: item.key,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (existing) {
            modulesUpdated++;
        } else {
            modulesCreated++;
        }

        moduleKeyMap.set(savedModule.key, savedModule._id);
        moduleKeyMap.set(savedModule.name, savedModule._id);
    }

    console.log(`✓ Modules: ${modulesCreated} created, ${modulesUpdated} updated.`);

    // 2. Canonical module assignments for each plan
    // Basic: Society & Flats, Residents, Notices, Events, Staff, Visitors, Helpdesk, Settings
    const basicKeys = [
        "society_flat_setup",
        "residents",
        "notices",
        "community_events",
        "staff_management",
        "visitor_management",
        "complaints_helpdesk",
        "settings",
    ];

    // Premium (OWN modules): Festivals, Polls, Vendors, Amenities, Parking, Documents
    const premiumKeys = [
        "festivals",
        "polls",
        "vendor_management",
        "amenity_booking",
        "parking_management",
        "documents_manager",
    ];

    // Advanced (OWN modules): Billing & Accounts, Reports, AI Assistant
    const advancedKeys = [
        "billing_accounts",
        "reports_dashboard",
        "ai_assistant",
    ];

    const getModuleIds = (keys) => {
        return keys
            .map((k) => moduleKeyMap.get(k))
            .filter((id) => Boolean(id));
    };

    // 3. Upsert Basic Plan
    console.log("\nUpserting Basic Plan...");
    const basicExisting = await SubscriptionPlan.findOne({
        $or: [{ slug: "basic" }, { name: "Basic" }],
    });

    const basicPlanData = {
        name: "Basic",
        slug: "basic",
        badge: "FREE / TRIAL",
        badgeType: "green",
        description: "Core essentials for society management.",
        price: 0,
        durationInMonths: 12,
        maxFlats: 100,
        maxUsers: 500,
        modules: getModuleIds(basicKeys),
        inheritsFrom: null,
        sortOrder: 1,
        isActive: true,
    };

    const basicPlan = await SubscriptionPlan.findOneAndUpdate(
        { $or: [{ slug: "basic" }, { name: "Basic" }] },
        { $set: basicPlanData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (basicExisting) plansUpdated++; else plansCreated++;

    // 4. Upsert Premium Plan (inherits Basic)
    console.log("Upserting Premium Plan (inherits Basic)...");
    const premiumExisting = await SubscriptionPlan.findOne({
        $or: [{ slug: "premium" }, { name: "Premium" }],
    });

    const premiumPlanData = {
        name: "Premium",
        slug: "premium",
        badge: "POPULAR",
        badgeType: "purple",
        description: "Everything in Basic, plus community and operations tools.",
        price: 4999,
        durationInMonths: 12,
        maxFlats: 500,
        maxUsers: 2500,
        modules: getModuleIds(premiumKeys),
        inheritsFrom: basicPlan._id,
        sortOrder: 2,
        isActive: true,
    };

    const premiumPlan = await SubscriptionPlan.findOneAndUpdate(
        { $or: [{ slug: "premium" }, { name: "Premium" }] },
        { $set: premiumPlanData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (premiumExisting) plansUpdated++; else plansCreated++;

    // 5. Upsert Advanced Plan (inherits Premium)
    console.log("Upserting Advanced Plan (inherits Premium)...");
    const advancedExisting = await SubscriptionPlan.findOne({
        $or: [{ slug: "advanced" }, { name: "Advanced" }],
    });

    const advancedPlanData = {
        name: "Advanced",
        slug: "advanced",
        badge: "FULL SUITE",
        badgeType: "amber",
        description: "Full suite with financial accounts, reports, and AI assistant.",
        price: 9999,
        durationInMonths: 12,
        maxFlats: 2000,
        maxUsers: 10000,
        modules: getModuleIds(advancedKeys),
        inheritsFrom: premiumPlan._id,
        sortOrder: 3,
        isActive: true,
    };

    await SubscriptionPlan.findOneAndUpdate(
        { $or: [{ slug: "advanced" }, { name: "Advanced" }] },
        { $set: advancedPlanData },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (advancedExisting) plansUpdated++; else plansCreated++;

    console.log(`✓ Plans: ${plansCreated} created, ${plansUpdated} updated.`);

    console.log("\n=================================================");
    console.log("=== SEEDING COMPLETED SUCCESSFULLY ===");
    console.log(`Modules -> Created: ${modulesCreated}, Updated: ${modulesUpdated}`);
    console.log(`Plans   -> Created: ${plansCreated}, Updated: ${plansUpdated}`);
    console.log("=================================================\n");

    await masterDb.close();
    process.exit(0);
}

seedPlansAndModules().catch((err) => {
    console.error("❌ Seed failed with error:", err);
    process.exit(1);
});
