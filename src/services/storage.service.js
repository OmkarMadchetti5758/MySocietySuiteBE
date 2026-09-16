"use strict";

const path = require("path");
const { randomUUID } = require("crypto");
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const env = require("../config/env");
const spacesClient = require("../config/spaces");

const BUCKET = env.DO_SPACE_BUCKET;
const REGION = env.DO_SPACE_REGION;
const ENDPOINT = env.DO_SPACES_ENDPOINT;
const CDN_BASE = env.DO_SPACES_CDN;

const STORAGE_FOLDERS = {
    AMENITIES: "amenities",
    NOTICES: "notices",
    FESTIVALS: "festivals",
    HELPDESK: "helpdesk",
    SOCIETY: "society",
    PARKING: "parking",
};

const ALLOWED_FOLDERS = new Set(Object.values(STORAGE_FOLDERS));

const MIME_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/bmp": ".bmp",
    "image/svg+xml": ".svg",
};

const assertConfigured = () => {
    if (!BUCKET || !env.DO_SPACES_KEY || !env.DO_SPACES_SECRET || !ENDPOINT) {
        throw new Error("DigitalOcean Spaces is not configured. Check DO_SPACE_* environment variables.");
    }
};

const assertFolder = (folder) => {
    if (!ALLOWED_FOLDERS.has(folder)) {
        throw new Error(`Invalid storage folder "${folder}". Allowed: ${[...ALLOWED_FOLDERS].join(", ")}`);
    }
};

const sanitizeSocietyId = (societyId) => {
    if (!societyId) return "";
    return String(societyId).replace(/[^a-zA-Z0-9_-]/g, "");
};

const extensionFromFile = (originalName, contentType) => {
    const fromName = path.extname(originalName || "").toLowerCase();
    if (fromName && fromName.length <= 6) return fromName;
    return MIME_EXTENSIONS[contentType] || ".jpg";
};

const buildObjectKey = (folder, originalName, societyId, contentType) => {
    assertFolder(folder);
    const ext = extensionFromFile(originalName, contentType);
    const societyPart = sanitizeSocietyId(societyId);
    const unique = `${Date.now()}-${randomUUID()}`;
    return societyPart
        ? `${folder}/${societyPart}/${unique}${ext}`
        : `${folder}/${unique}${ext}`;
};

const getPublicUrl = (key) => {
    if (!key) return null;
    if (CDN_BASE) return `${CDN_BASE}/${key}`;
    if (BUCKET && REGION) {
        return `https://${BUCKET}.${REGION}.digitaloceanspaces.com/${key}`;
    }
    return `${ENDPOINT}/${BUCKET}/${key}`;
};

const extractKeyFromUrl = (urlOrKey) => {
    if (!urlOrKey || typeof urlOrKey !== "string") return null;
    const trimmed = urlOrKey.trim();
    if (!trimmed || trimmed.startsWith("/uploads/") || trimmed.startsWith("blob:")) return null;

    if (!/^https?:\/\//i.test(trimmed)) {
        return trimmed.replace(/^\//, "");
    }

    try {
        const parsed = new URL(trimmed);
        const host = parsed.hostname.toLowerCase();
        let pathname = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

        let cdnHost = "";
        if (CDN_BASE) {
            try {
                cdnHost = new URL(CDN_BASE).hostname.toLowerCase();
            } catch {
                cdnHost = "";
            }
        }

        const isSpacesHost =
            host.includes("digitaloceanspaces.com") ||
            (BUCKET && (host === BUCKET.toLowerCase() || host.startsWith(`${BUCKET.toLowerCase()}.`))) ||
            (cdnHost && host === cdnHost);

        if (!isSpacesHost) return null;

        let endpointHost = "";
        if (ENDPOINT) {
            try {
                endpointHost = new URL(ENDPOINT).hostname.toLowerCase();
            } catch {
                endpointHost = "";
            }
        }

        if (BUCKET && endpointHost && host === endpointHost) {
            if (pathname === BUCKET || pathname.startsWith(`${BUCKET}/`)) {
                pathname = pathname.slice(BUCKET.length).replace(/^\//, "");
            }
        }

        return pathname || null;
    } catch {
        return null;
    }
};

const uploadFile = async ({ buffer, key, contentType, isPublic = true }) => {
    assertConfigured();

    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buffer,
        ContentLength: buffer?.length,
        ContentType: contentType || "application/octet-stream",
        ACL: isPublic ? "public-read" : undefined,
        CacheControl: "public, max-age=31536000",
    });

    await spacesClient.send(command);

    return {
        key,
        url: getPublicUrl(key),
    };
};

const uploadMulterFile = async (file, folder, societyId) => {
    if (!file) return null;
    assertFolder(folder);
    const key = buildObjectKey(folder, file.originalname, societyId, file.mimetype);
    return uploadFile({
        buffer: file.buffer,
        key,
        contentType: file.mimetype,
    });
};

const uploadMulterFiles = async (files, folder, societyId) => {
    if (!files || files.length === 0) return [];
    assertFolder(folder);
    return Promise.all(files.map((file) => uploadMulterFile(file, folder, societyId)));
};

const deleteFile = async (key) => {
    if (!key) return;
    assertConfigured();

    const command = new DeleteObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });

    await spacesClient.send(command);
};

const deleteStoredFile = async (urlOrKey) => {
    const key = extractKeyFromUrl(urlOrKey);
    if (!key) return;
    try {
        await deleteFile(key);
    } catch (err) {
        console.error("Failed to delete Spaces object:", key, err.message);
    }
};

const deleteStoredFiles = async (urlsOrKeys = []) => {
    await Promise.all((urlsOrKeys || []).map((item) => deleteStoredFile(item)));
};

const getFileUrl = async (key, expiresIn = 3600) => {
    assertConfigured();

    const command = new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
    });

    return getSignedUrl(spacesClient, command, { expiresIn });
};

module.exports = {
    STORAGE_FOLDERS,
    uploadFile,
    uploadMulterFile,
    uploadMulterFiles,
    deleteFile,
    deleteStoredFile,
    deleteStoredFiles,
    getFileUrl,
    getPublicUrl,
    extractKeyFromUrl,
    buildObjectKey,
};
