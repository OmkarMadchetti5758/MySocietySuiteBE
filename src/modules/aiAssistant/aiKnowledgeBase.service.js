"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");

const SEARCH_FIELDS = [
    "title",
    "topic",
    "keywords",
    "category",
    "content.en",
    "content.hi",
    "content.mr",
];

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeQuery(query) {
    return typeof query === "string" ? query.trim() : "";
}

function getSearchTerms(query) {
    return [...new Set(query.split(/\s+/).filter(Boolean))];
}

function buildSearchFilter(query, userRole) {
    const roleFilter = {
        $or: [
            { allowedRoles: { $exists: false } },
            { allowedRoles: { $size: 0 } },
        ],
    };

    if (userRole) {
        roleFilter.$or.push({ allowedRoles: userRole });
    }

    const filter = {
        status: "active",
        ...roleFilter,
    };

    if (!query) {
        return filter;
    }

    const searchRegex = new RegExp(escapeRegex(query), "i");
    const termRegexes = getSearchTerms(query).map(
        (term) => new RegExp(escapeRegex(term), "i")
    );

    filter.$and = [
        {
            $or: [
                ...SEARCH_FIELDS.map((field) => ({ [field]: searchRegex })),
                ...termRegexes.flatMap((regex) =>
                    SEARCH_FIELDS.map((field) => ({ [field]: regex }))
                ),
            ],
        },
    ];

    return filter;
}

function getFieldValue(entry, field) {
    return field.split(".").reduce((value, key) => value?.[key], entry);
}

function containsMatch(value, regex) {
    if (Array.isArray(value)) {
        return value.some((item) => regex.test(String(item)));
    }

    return typeof value === "string" && regex.test(value);
}

function calculateRelevance(entry, query) {
    if (!query) {
        return { score: 0, matchedFields: [] };
    }

    const searchRegex = new RegExp(escapeRegex(query), "i");
    const termRegexes = getSearchTerms(query).map(
        (term) => new RegExp(escapeRegex(term), "i")
    );
    const matchedFields = SEARCH_FIELDS.filter((field) => {
        const value = getFieldValue(entry, field);
        return containsMatch(value, searchRegex) || termRegexes.some((regex) => containsMatch(value, regex));
    });

    const weights = {
        title: 5,
        topic: 4,
        keywords: 3,
        category: 2,
        "content.en": 1,
        "content.hi": 1,
        "content.mr": 1,
    };
    const score = matchedFields.reduce((total, field) => total + weights[field], 0);

    return { score, matchedFields };
}

function toSearchResult(entry, query) {
    const relevance = calculateRelevance(entry, query);

    return {
        title: entry.title,
        category: entry.category,
        topic: entry.topic,
        content: entry.content,
        allowedRoles: entry.allowedRoles,
        relevance,
    };
}

async function searchKnowledgeBase(query, userRole, operationsDb = getOperationsConnection()) {
    const normalizedQuery = normalizeQuery(query);
    const KnowledgeBase = operationsDb.model("AIKnowledgeBase");
    const filter = buildSearchFilter(normalizedQuery, userRole);
    const entries = await KnowledgeBase.find(filter).lean();

    return entries
        .map((entry) => toSearchResult(entry, normalizedQuery))
        .sort((first, second) => second.relevance.score - first.relevance.score);
}

module.exports = {
    searchKnowledgeBase,
    buildSearchFilter,
    calculateRelevance,
};
