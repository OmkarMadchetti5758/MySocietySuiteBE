"use strict";

const { getMasterConnection } = require("../config/masterDb");

/**
 * In-process cache for Society.permissionsVersion to avoid a DB hit on every request.
 * TTL: 30 seconds — a short delay is acceptable; changes propagate quickly enough.
 */
const _permVersionCache = new Map();
const PERM_CACHE_TTL_MS = 30_000;

async function getSocietyPermissionsVersion(societyId) {
    const cached = _permVersionCache.get(String(societyId));
    if (cached && cached.expiresAt > Date.now()) {
        return cached.version;
    }

    const Society = getMasterConnection().model("Society");
    const society = await Society.findById(societyId).select("permissionsVersion").lean();
    const version = society ? (society.permissionsVersion ?? 1) : 1;

    _permVersionCache.set(String(societyId), {
        version,
        expiresAt: Date.now() + PERM_CACHE_TTL_MS,
    });

    return version;
}

function bustPermissionsVersionCache(societyId) {
    _permVersionCache.delete(String(societyId));
}

module.exports = {
    getSocietyPermissionsVersion,
    bustPermissionsVersionCache,
};
