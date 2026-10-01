"use strict";

const XLSX = require("xlsx");
const AppError = require("../../common/AppError");
const { RESIDENT_TYPE, ROLES } = require("../../common/constants");
const { canonicalPhone } = require("../../common/loginIdentifier");
const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");
const ResidentRepository = require("./resident.repository");
const emailService = require("../../services/email.service");
const { FRONTEND_URL } = require("../../config/env");

const generateResidentBulkUploadTemplate = () => {
    const headers = [
        "Name",
        "Email",
        "Mobile",
        "Wing",
        "Flat",
        "Resident Type",
        "Move In Date",
    ];

    const worksheet = XLSX.utils.aoa_to_sheet([headers]);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Residents");

    return XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
    });
};

const processResidentBulkUpload = async (societyId, fileBuffer) => {
    if (!fileBuffer || !fileBuffer.length) {
        throw new AppError("The uploaded file is empty.", 400);
    }

    let workbook;
    try {
        workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
    } catch (_) {
        throw new AppError("Failed to parse Excel file. Please ensure it is a valid .xlsx file.", 400);
    }

    const sheetNames = workbook.SheetNames || [];
    if (sheetNames.length === 0) {
        throw new AppError("The Excel file contains no worksheets.", 400);
    }

    const worksheet = workbook.Sheets[sheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

    if (!rawRows || rawRows.length === 0) {
        throw new AppError("The uploaded Excel sheet is empty.", 400);
    }

    // 1. Validate and map header row
    const headerRow = (rawRows[0] || []).map((h) => String(h || "").trim().toLowerCase());
    const getColIndex = (aliases) => headerRow.findIndex((h) => aliases.includes(h));

    const nameIndex = getColIndex(["name", "full name"]);
    const emailIndex = getColIndex(["email", "email address"]);
    const mobileIndex = getColIndex(["mobile", "phone", "mobile number", "phone number"]);
    const wingIndex = getColIndex(["wing", "wing / block", "block", "wing/block"]);
    const flatIndex = getColIndex(["flat", "flat number", "flat no", "flatno"]);
    const residentTypeIndex = getColIndex(["resident type", "residenttype", "type"]);
    const moveInDateIndex = getColIndex(["move in date", "moveindate", "move-in date"]);

    const missingHeaders = [];
    if (nameIndex === -1) missingHeaders.push("Name");
    if (emailIndex === -1) missingHeaders.push("Email");
    if (mobileIndex === -1) missingHeaders.push("Mobile");
    if (wingIndex === -1) missingHeaders.push("Wing");
    if (flatIndex === -1) missingHeaders.push("Flat");
    if (residentTypeIndex === -1) missingHeaders.push("Resident Type");
    if (moveInDateIndex === -1) missingHeaders.push("Move In Date");

    if (missingHeaders.length > 0) {
        throw new AppError(
            `Invalid Excel template. Missing required column(s): ${missingHeaders.join(", ")}`,
            400
        );
    }

    // 2. Parse data rows (1-based row index in Excel starts from row 2)
    const dataRows = [];
    for (let i = 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        const isBlank = row.every((c) => String(c ?? "").trim() === "");
        if (isBlank) continue;

        dataRows.push({
            excelRow: i + 1,
            name: String(row[nameIndex] ?? "").trim(),
            email: String(row[emailIndex] ?? "").trim(),
            mobile: String(row[mobileIndex] ?? "").trim(),
            wing: String(row[wingIndex] ?? "").trim(),
            flat: String(row[flatIndex] ?? "").trim(),
            residentTypeRaw: String(row[residentTypeIndex] ?? "").trim(),
            moveInDateRaw: row[moveInDateIndex],
        });
    }

    if (dataRows.length === 0) {
        throw new AppError("The uploaded Excel file contains no resident records.", 400);
    }

    // 3. Pre-fetch society data from database
    const opsDb = getOperationsConnection();
    const masterDb = getMasterConnection();
    const Block = opsDb.model("Block");
    const Flat = opsDb.model("Flat");
    const Resident = opsDb.model("Resident");
    const User = opsDb.model("User");
    const UserSocietyMapping = masterDb.model("UserSocietyMapping");

    const [blockDoc, flats, activeResidents] = await Promise.all([
        Block.findOne({ societyId }).lean(),
        Flat.find({ societyId }).lean(),
        Resident.find({ societyId, isActive: true }).lean(),
    ]);

    const wings = blockDoc?.wings || [];

    // Pre-fetch matching existing users and mappings
    const candidateEmails = [
        ...new Set(
            dataRows
                .map((r) => r.email.toLowerCase())
                .filter((e) => e && e.includes("@"))
        ),
    ];
    const candidateMobiles = [
        ...new Set(
            dataRows
                .map((r) => r.mobile.replace(/[\s-]/g, ""))
                .filter((m) => m.length >= 8)
        ),
    ];

    const existingSocietyUsers = await User.find({
        societyId,
        $or: [
            ...(candidateEmails.length > 0 ? [{ email: { $in: candidateEmails } }] : []),
            ...(candidateMobiles.length > 0 ? [{ mobile: { $in: candidateMobiles } }] : []),
        ],
    }).lean();

    const existingSocietyEmails = new Set(
        existingSocietyUsers.map((u) => (u.email || "").toLowerCase()).filter(Boolean)
    );
    const existingSocietyMobiles = new Set();
    existingSocietyUsers.forEach((u) => {
        if (u.mobile) {
            existingSocietyMobiles.add(u.mobile);
            const canon = canonicalPhone(u.mobile);
            if (canon) existingSocietyMobiles.add(canon);
        }
    });

    const lookupIdentifiers = [
        ...candidateEmails,
        ...candidateMobiles,
        ...candidateMobiles.map((m) => canonicalPhone(m)).filter(Boolean),
    ];

    const existingMappings = lookupIdentifiers.length > 0
        ? await UserSocietyMapping.find({
            identifier: { $in: [...new Set(lookupIdentifiers)] },
        }).lean()
        : [];

    const existingPlatformIdentifiers = new Set(
        existingMappings.map((m) => (m.identifier || "").toLowerCase()).filter(Boolean)
    );

    // 4. In-file duplicate frequencies count
    const emailCount = new Map();
    const mobileCount = new Map();
    const flatOwnerCount = new Map();
    const flatTenantCount = new Map();

    for (const r of dataRows) {
        if (r.email) {
            const em = r.email.toLowerCase();
            emailCount.set(em, (emailCount.get(em) || 0) + 1);
        }
        if (r.mobile) {
            const cleanMob = r.mobile.replace(/[\s-]/g, "");
            const canon = canonicalPhone(cleanMob) || cleanMob;
            mobileCount.set(canon, (mobileCount.get(canon) || 0) + 1);
        }
        const normType = r.residentTypeRaw.toLowerCase().replace(/[\s-]+/g, "_");
        if (r.wing && r.flat) {
            const key = `${r.wing.toLowerCase()}:::${r.flat.toLowerCase()}`;
            if (normType === "owner") {
                flatOwnerCount.set(key, (flatOwnerCount.get(key) || 0) + 1);
            } else if (normType === "tenant") {
                flatTenantCount.set(key, (flatTenantCount.get(key) || 0) + 1);
            }
        }
    }

    // 5. Validation phase (Pass 1)
    const validRows = [];
    const failedRows = [];

    for (const r of dataRows) {
        const rowErrors = [];

        // 1. Name
        if (!r.name) {
            rowErrors.push("Name is required");
        }

        // 2. Email
        let normalizedEmail = null;
        if (!r.email) {
            rowErrors.push("Email is required");
        } else {
            const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!EMAIL_REGEX.test(r.email)) {
                rowErrors.push("Invalid email format");
            } else {
                normalizedEmail = r.email.toLowerCase();
            }
        }

        // 3. Mobile
        let normalizedMobile = null;
        let canonMobile = null;
        if (!r.mobile) {
            rowErrors.push("Mobile number is required");
        } else {
            const cleanMob = r.mobile.replace(/[\s-]/g, "");
            const MOBILE_REGEX = /^\+?[0-9]{10,15}$/;
            if (!MOBILE_REGEX.test(cleanMob)) {
                rowErrors.push("Mobile number must be a valid 10-digit number");
            } else {
                normalizedMobile = cleanMob;
                canonMobile = canonicalPhone(cleanMob) || cleanMob;
            }
        }

        // 4. Wing
        let matchedWing = null;
        if (!r.wing) {
            rowErrors.push("Wing is required");
        } else {
            matchedWing = wings.find(
                (w) =>
                    w.name?.toLowerCase() === r.wing.toLowerCase() ||
                    w.code?.toLowerCase() === r.wing.toLowerCase()
            );
            if (!matchedWing) {
                rowErrors.push(`Wing '${r.wing}' does not exist in this society`);
            }
        }

        // 5. Flat (Bulk upload must NOT automatically create a missing flat)
        let matchedFlat = null;
        if (!r.flat) {
            rowErrors.push("Flat number is required");
        } else if (matchedWing) {
            matchedFlat = flats.find(
                (f) =>
                    String(f.blockId) === String(matchedWing._id) &&
                    f.flatNumber?.toLowerCase() === r.flat.toLowerCase()
            );
            if (!matchedFlat) {
                rowErrors.push(`Flat '${r.flat}' does not exist in Wing '${r.wing}'`);
            }
        }

        // 6. Resident Type
        let resolvedResidentType = null;
        let resolvedRole = null;
        if (!r.residentTypeRaw) {
            rowErrors.push("Resident Type is required");
        } else {
            const normType = r.residentTypeRaw.toLowerCase().replace(/[\s-]+/g, "_");
            if (normType === "owner") {
                resolvedResidentType = RESIDENT_TYPE.OWNER;
                resolvedRole = ROLES.RESIDENT_OWNER;
            } else if (normType === "tenant") {
                resolvedResidentType = RESIDENT_TYPE.TENANT;
                resolvedRole = ROLES.RESIDENT_TENANT;
            } else if (
                normType === "family_member" ||
                normType === "family" ||
                normType === "familymember"
            ) {
                resolvedResidentType = RESIDENT_TYPE.FAMILY_MEMBER;
                resolvedRole = ROLES.RESIDENT;
            } else {
                rowErrors.push("Invalid resident type. Allowed values: Owner, Tenant, Family Member");
            }
        }

        // 7. Move In Date
        let resolvedMoveInDate = new Date();
        if (
            r.moveInDateRaw !== undefined &&
            r.moveInDateRaw !== null &&
            String(r.moveInDateRaw).trim() !== ""
        ) {
            let parsedDate = null;
            if (r.moveInDateRaw instanceof Date) {
                if (!isNaN(r.moveInDateRaw.getTime())) {
                    parsedDate = r.moveInDateRaw;
                }
            } else if (typeof r.moveInDateRaw === "number") {
                try {
                    const dateObj = XLSX.SSF.parse_date_code(r.moveInDateRaw);
                    if (dateObj) {
                        parsedDate = new Date(Date.UTC(dateObj.y, dateObj.m - 1, dateObj.d));
                    }
                } catch (_) {}
            } else {
                const dateStr = String(r.moveInDateRaw).trim();
                const ddmmyyyy = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
                if (ddmmyyyy) {
                    const day = parseInt(ddmmyyyy[1], 10);
                    const month = parseInt(ddmmyyyy[2], 10);
                    const year = parseInt(ddmmyyyy[3], 10);
                    const testDate = new Date(year, month - 1, day);
                    if (
                        testDate.getFullYear() === year &&
                        testDate.getMonth() === month - 1 &&
                        testDate.getDate() === day
                    ) {
                        parsedDate = testDate;
                    }
                } else {
                    const testDate = new Date(dateStr);
                    if (!isNaN(testDate.getTime())) {
                        parsedDate = testDate;
                    }
                }
            }

            if (!parsedDate || isNaN(parsedDate.getTime())) {
                rowErrors.push("Invalid Move In Date format");
            } else {
                resolvedMoveInDate = parsedDate;
            }
        }

        // 8. In-File Duplicate Checks
        if (normalizedEmail && (emailCount.get(normalizedEmail) || 0) > 1) {
            rowErrors.push(`Duplicate email '${r.email}' found in multiple rows in uploaded file`);
        }
        if (canonMobile && (mobileCount.get(canonMobile) || 0) > 1) {
            rowErrors.push(`Duplicate mobile number '${r.mobile}' found in multiple rows in uploaded file`);
        }
        if (r.wing && r.flat) {
            const key = `${r.wing.toLowerCase()}:::${r.flat.toLowerCase()}`;
            if (resolvedResidentType === RESIDENT_TYPE.OWNER && (flatOwnerCount.get(key) || 0) > 1) {
                rowErrors.push(
                    `Multiple owners specified for Flat '${r.flat}' in Wing '${r.wing}' in uploaded file`
                );
            }
            if (resolvedResidentType === RESIDENT_TYPE.TENANT && (flatTenantCount.get(key) || 0) > 1) {
                rowErrors.push(
                    `Multiple tenants specified for Flat '${r.flat}' in Wing '${r.wing}' in uploaded file`
                );
            }
        }

        // 9. Database Duplicate Checks
        if (normalizedEmail) {
            if (existingSocietyEmails.has(normalizedEmail)) {
                rowErrors.push("A user with this email already exists in this society");
            } else if (existingPlatformIdentifiers.has(normalizedEmail)) {
                rowErrors.push("This email is already registered on the platform");
            }
        }
        if (canonMobile) {
            if (
                existingSocietyMobiles.has(canonMobile) ||
                existingSocietyMobiles.has(normalizedMobile)
            ) {
                rowErrors.push("A user with this mobile number already exists in this society");
            } else if (
                existingPlatformIdentifiers.has(canonMobile) ||
                existingPlatformIdentifiers.has(normalizedMobile)
            ) {
                rowErrors.push("This mobile number is already registered on the platform");
            }
        }

        // 10. Database Flat Occupancy Rules
        if (matchedFlat) {
            const flatIdStr = String(matchedFlat._id);
            if (resolvedResidentType === RESIDENT_TYPE.OWNER) {
                const hasDbOwner = activeResidents.some(
                    (res) =>
                        String(res.flatId) === flatIdStr &&
                        res.residentType === RESIDENT_TYPE.OWNER
                );
                if (hasDbOwner) {
                    rowErrors.push(`Flat '${r.flat}' in Wing '${r.wing}' already has an active owner`);
                }
            } else if (resolvedResidentType === RESIDENT_TYPE.TENANT) {
                const hasDbTenant = activeResidents.some(
                    (res) =>
                        String(res.flatId) === flatIdStr &&
                        res.residentType === RESIDENT_TYPE.TENANT
                );
                if (hasDbTenant) {
                    rowErrors.push(`Flat '${r.flat}' in Wing '${r.wing}' already has an active tenant`);
                }
            }
        }

        if (rowErrors.length > 0) {
            failedRows.push({
                row: r.excelRow,
                name: r.name || "—",
                errors: rowErrors,
            });
        } else {
            validRows.push({
                ...r,
                normalizedEmail,
                normalizedMobile,
                matchedWing,
                matchedFlat,
                resolvedResidentType,
                resolvedRole,
                resolvedMoveInDate,
            });
        }
    }

    // 6. Processing / Saving Valid Rows (Pass 2)
    // Reuse existing resident creation logic and capture plainToken for Phase 3 invitation emails
    const successfulRows = [];
    const invitationQueue = [];

    for (const r of validRows) {
        try {
            const created = await ResidentRepository.createResidentWithInvite(societyId, {
                name: r.name,
                email: r.normalizedEmail,
                phone: r.normalizedMobile,
                flatId: r.matchedFlat._id,
                flatNumber: r.matchedFlat.flatNumber,
                blockId: r.matchedWing._id,
                wingCode: r.matchedWing.code,
                residentType: r.resolvedResidentType,
                role: r.resolvedRole,
                moveInDate: r.resolvedMoveInDate,
            });

            // Keep track of freshly created identifiers and flat assignments to prevent conflicts within batch
            existingSocietyEmails.add(r.normalizedEmail);
            const canonMob = canonicalPhone(r.normalizedMobile);
            if (canonMob) existingSocietyMobiles.add(canonMob);
            existingPlatformIdentifiers.add(r.normalizedEmail);
            existingPlatformIdentifiers.add(r.normalizedMobile);

            successfulRows.push({
                row: r.excelRow,
                name: r.name,
                email: r.normalizedEmail,
                mobile: r.normalizedMobile,
                wing: r.matchedWing.name,
                flat: r.matchedFlat.flatNumber,
                residentType: r.resolvedResidentType,
            });

            if (created?.plainToken && r.normalizedEmail) {
                invitationQueue.push({
                    row: r.excelRow,
                    email: r.normalizedEmail,
                    recipientName: r.name,
                    inviteLink: `${FRONTEND_URL}/activate-account?token=${created.plainToken}`,
                });
            }
        } catch (saveError) {
            failedRows.push({
                row: r.excelRow,
                name: r.name,
                errors: [saveError.message || "Failed to create resident record"],
            });
        }
    }

    // 7. Bulk Email Invitation Dispatch (Phase 3)
    // Send invitations in batches of maximum 50 residents using Promise.allSettled().
    // Email failures are isolated: no rollback, no halting of subsequent emails/batches.
    const BATCH_SIZE = 50;
    const emailSummary = {
        totalQueued: invitationQueue.length,
        sent: 0,
        failed: 0,
        skipped: 0,
        failures: [],
    };

    for (let i = 0; i < invitationQueue.length; i += BATCH_SIZE) {
        const batch = invitationQueue.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map((item) =>
            emailService.sendInviteEmail({
                to: item.email,
                recipientName: item.recipientName,
                roleLabel: "Resident",
                inviteLink: item.inviteLink,
            })
        );

        const results = await Promise.allSettled(batchPromises);

        for (let j = 0; j < results.length; j++) {
            const outcome = results[j];
            const item = batch[j];

            if (outcome.status === "fulfilled") {
                const res = outcome.value;
                if (res && res.sent === true) {
                    emailSummary.sent++;
                } else if (res && res.skipped === true) {
                    emailSummary.skipped++;
                } else {
                    emailSummary.failed++;
                    emailSummary.failures.push({
                        row: item.row,
                        email: item.email,
                        error: res?.error || "Failed to send invitation email",
                    });
                }
            } else {
                emailSummary.failed++;
                emailSummary.failures.push({
                    row: item.row,
                    email: item.email,
                    error: outcome.reason?.message || "Failed to send invitation email",
                });
            }
        }
    }

    failedRows.sort((a, b) => a.row - b.row);
    successfulRows.sort((a, b) => a.row - b.row);
    emailSummary.failures.sort((a, b) => a.row - b.row);

    return {
        totalRows: dataRows.length,
        successfulCount: successfulRows.length,
        failedCount: failedRows.length,
        successfulRows,
        failedRows,
        emailSummary,
    };
};

module.exports = {
    generateResidentBulkUploadTemplate,
    processResidentBulkUpload,
};