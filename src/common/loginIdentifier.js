"use strict";

/**
 * Canonical login identifiers.
 * Emails are lowercased. Phones are stored/looked up as digits (last 10 when longer).
 * Staff UI often sends "+91 98765 43210"; login is usually "9876543210".
 */
function isEmail(value) {
    return typeof value === "string" && value.includes("@");
}

function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}

function canonicalPhone(value) {
    const digits = digitsOnly(value);
    if (!digits) return null;
    return digits.length > 10 ? digits.slice(-10) : digits;
}

function canonicalIdentifier(value) {
    if (!value || typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isEmail(trimmed)) return trimmed.toLowerCase();
    return canonicalPhone(trimmed);
}

/**
 * All forms that might exist in UserSocietyMapping or User.mobile for this login input.
 */
function identifierLookupValues(value) {
    if (!value || typeof value !== "string") return [];
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return [];
    if (isEmail(trimmed)) return [trimmed];

    const digits = digitsOnly(trimmed);
    const last10 = digits.length > 10 ? digits.slice(-10) : digits;
    return [...new Set([trimmed, digits, last10].filter(Boolean))];
}

function phoneRegexForLookup(value) {
    const last10 = canonicalPhone(value);
    if (!last10 || last10.length < 8) return null;
    return new RegExp(`${last10}$`);
}

module.exports = {
    isEmail,
    digitsOnly,
    canonicalPhone,
    canonicalIdentifier,
    identifierLookupValues,
    phoneRegexForLookup,
};
