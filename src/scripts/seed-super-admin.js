"use strict";

require("dotenv").config({ path: __dirname + "/../../.env" });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { getMasterConnection } = require("../config/masterDb");
const SuperAdmin = require("../modules/superAdmin/superAdmin.model");

async function seedSuperAdmin() {
    console.log("🌱 Starting Super Admin seed process...");
    
    if (!process.env.MONGODB_URI) {
        console.error("❌ MONGODB_URI is missing from .env");
        process.exit(1);
    }

    let masterDb;
    try {
        masterDb = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: process.env.MASTER_DB_NAME || "mysociety_master" }).asPromise();
        masterDb.model("SuperAdmin", SuperAdmin);
        
        const SuperAdminModel = masterDb.model("SuperAdmin");
        
        const email = "admin@mysocietysuite.com";
        const password = "Admin@123";
        
        const existingAdmin = await SuperAdminModel.findOne({ email });
        if (existingAdmin) {
            console.log(`⚠️ Super Admin ${email} already exists. Deleting to re-seed...`);
            await SuperAdminModel.deleteOne({ email });
        }
        
        await SuperAdminModel.create({
            name: "Master Admin",
            email: email,
            password: password, // The pre-save hook will hash this
            role: "super_admin"
        });
        
        console.log(`🎉 Super Admin created successfully!`);
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${password}`);
        
    } catch (error) {
        console.error("❌ Failed to seed Super Admin:", error);
    } finally {
        if (masterDb) {
            await masterDb.close();
        }
        process.exit(0);
    }
}

seedSuperAdmin();
