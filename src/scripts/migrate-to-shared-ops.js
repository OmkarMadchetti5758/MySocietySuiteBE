"use strict";

require("dotenv").config({ path: __dirname + "/../../.env" });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const MONGODB_URI = process.env.MONGODB_URI;
const MASTER_DB_NAME = process.env.MASTER_DB_NAME || "mysociety_master";
const OPERATIONS_DB_NAME = process.env.OPERATIONS_DB_NAME || "mysociety_operations";

const ERROR_LOG_PATH = path.join(__dirname, "migration_errors.json");

/**
 * Migration Script: Database-per-tenant to Shared-Collection model.
 * 
 * Strategy:
 * 1. Connect to Master DB. Find all active societies that have a databaseName.
 * 2. Connect to the shared Operations DB.
 * 3. For each society:
 *    a. Connect to their specific tenant DB.
 *    b. Get all collections in that DB.
 *    c. For each collection, fetch all documents.
 *    d. Inject `societyId = society._id` into every document.
 *    e. Bulk insert into the matching collection in Operations DB.
 * 4. We DO NOT drop the original per-society DBs. They remain as a fallback.
 */

async function runMigration() {
    console.log(`🚀 Starting migration from per-tenant DBs to shared Operations DB (${OPERATIONS_DB_NAME})`);
    
    if (!MONGODB_URI) {
        console.error("❌ MONGODB_URI is not defined in .env");
        process.exit(1);
    }

    const errors = [];
    let masterConn, opsConn;

    try {
        // 1. Connect to Master and Ops
        masterConn = await mongoose.createConnection(MONGODB_URI, { dbName: MASTER_DB_NAME }).asPromise();
        opsConn = await mongoose.createConnection(MONGODB_URI, { dbName: OPERATIONS_DB_NAME }).asPromise();
        console.log("✅ Connected to Master and Operations DBs.");

        // 2. Fetch societies
        // Note: we're using raw mongoose driver connections here for pure data migration
        const societiesColl = masterConn.collection("societies");
        const societies = await societiesColl.find({ databaseName: { $exists: true, $ne: null } }).toArray();

        console.log(`📋 Found ${societies.length} societies to migrate.`);

        // 3. Process each society
        for (const society of societies) {
            console.log(`\n⏳ Migrating society: ${society.name} (DB: ${society.databaseName})`);
            
            let tenantConn;
            try {
                tenantConn = await mongoose.createConnection(MONGODB_URI, { dbName: society.databaseName }).asPromise();
                
                // Get all collections in this tenant's DB
                const collections = await tenantConn.db.listCollections().toArray();
                
                for (const collInfo of collections) {
                    const collName = collInfo.name;
                    if (collName === "system.indexes") continue;

                    const tenantColl = tenantConn.collection(collName);
                    const opsColl = opsConn.collection(collName);
                    
                    const documents = await tenantColl.find({}).toArray();
                    
                    if (documents.length === 0) {
                        console.log(`   - ⏭️  Skipped ${collName} (0 documents)`);
                        continue;
                    }

                    // Stamp each doc with societyId. Preserve original _id.
                    const docsToInsert = documents.map(doc => {
                        return {
                            ...doc,
                            societyId: society._id // Stamping the society ID
                        };
                    });

                    try {
                        // Use ordered: false so one bad document (e.g. unique constraint violation) 
                        // doesn't fail the whole batch.
                        const result = await opsColl.insertMany(docsToInsert, { ordered: false });
                        console.log(`   - ✅ Migrated ${result.insertedCount} documents from ${collName}`);
                    } catch (bulkError) {
                        // If it's a BulkWriteError, some might have succeeded
                        if (bulkError.code === 11000) {
                            console.warn(`   - ⚠️  Duplicate key error in ${collName}. Inserted: ${bulkError.result?.nInserted || 0}. See errors file for details.`);
                            errors.push({
                                society: society.name,
                                database: society.databaseName,
                                collection: collName,
                                errorType: "DuplicateKey",
                                details: bulkError.message
                            });
                        } else {
                            console.error(`   - ❌ Failed to migrate ${collName}: ${bulkError.message}`);
                            errors.push({
                                society: society.name,
                                database: society.databaseName,
                                collection: collName,
                                errorType: "InsertFailed",
                                details: bulkError.message
                            });
                        }
                    }
                }
            } catch (err) {
                console.error(`❌ Failed to process society ${society.name}: ${err.message}`);
                errors.push({
                    society: society.name,
                    errorType: "SocietyMigrationFailed",
                    details: err.message
                });
            } finally {
                if (tenantConn) {
                    await tenantConn.close();
                }
            }
        }

        console.log(`\n🎉 Migration dry-run/copy complete!`);
        
        if (errors.length > 0) {
            console.log(`⚠️  Encountered ${errors.length} errors. Writing to ${ERROR_LOG_PATH}`);
            fs.writeFileSync(ERROR_LOG_PATH, JSON.stringify(errors, null, 2));
        } else {
            console.log(`✅ Zero errors encountered.`);
            // Clean up old log file if it exists
            if (fs.existsSync(ERROR_LOG_PATH)) fs.unlinkSync(ERROR_LOG_PATH);
        }

        console.log(`\n🚨 IMPORTANT: The original per-society databases have NOT been deleted.`);
        console.log(`   Verify the data in '${OPERATIONS_DB_NAME}' before manually dropping them.`);

    } catch (err) {
        console.error("❌ Fatal migration error:", err);
    } finally {
        if (masterConn) await masterConn.close();
        if (opsConn) await opsConn.close();
        process.exit(0);
    }
}

runMigration();
