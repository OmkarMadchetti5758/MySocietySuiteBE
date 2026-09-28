"use strict";

const AppError = require("../../common/AppError");
const { getOperationsConnection } = require("../../config/operationsDb");
const { searchKnowledgeBase } = require("./aiKnowledgeBase.service");
const { generateAnswer } = require("./aiProvider.service");

const LANGUAGE_FIELDS = Object.freeze({
    en: "en",
    hi: "hi",
    mr: "mr",
});

const MARATHI_MARKERS = ["आहे", "मध्ये", "साठी", "काय", "करा", "आणि", "माहिती"];
const HINDI_MARKERS = ["है", "में", "के", "की", "क्या", "कैसे", "और", "जानकारी"];

function detectLanguage(query) {
    const devanagariQuery = query.match(/[\u0900-\u097F]/g)?.join("") || "";

    if (!devanagariQuery) {
        return LANGUAGE_FIELDS.en;
    }

    const hasMarathiMarker = MARATHI_MARKERS.some((marker) => query.includes(marker));
    const hasHindiMarker = HINDI_MARKERS.some((marker) => query.includes(marker));

    if (hasMarathiMarker && !hasHindiMarker) {
        return LANGUAGE_FIELDS.mr;
    }

    return LANGUAGE_FIELDS.hi;
}

function validateQuery(query) {
    if (typeof query !== "string" || !query.trim()) {
        throw new AppError(
            "AI Assistant query must be a non-empty string.",
            400,
            "INVALID_AI_QUERY"
        );
    }

    return query.trim();
}

function buildContext(searchResults) {
    return searchResults.map((result) => ({
        title: result.title,
        category: result.category,
        topic: result.topic,
        content: result.content,
        relevanceScore: result.relevance?.score || 0,
    }));
}

function buildSources(context, language) {
    return context.map((item) => ({
        title: item.title,
        category: item.category,
        topic: item.topic,
        content: item.content,
        relevanceScore: item.relevanceScore,
        selectedLanguage: language,
    }));
}

function buildUnavailableAnswer(language) {
    const messages = {
        en: "This information is not available in the current Knowledge Base.",
        hi: "यह जानकारी वर्तमान Knowledge Base में उपलब्ध नहीं है।",
        mr: "ही माहिती सध्याच्या Knowledge Base मध्ये उपलब्ध नाही.",
    };

    return messages[language];
}

/**
 * Answers an assistant query from static, role-filtered Knowledge Base content.
 */
async function answerQuery({ query, userRole, societyId, userId }, operationsDb = getOperationsConnection()) {
    const normalizedQuery = validateQuery(query);
    const language = detectLanguage(normalizedQuery);

    // These identifiers are accepted for the future controller and live-data phase.
    // This phase intentionally searches only static Knowledge Base content.
    void societyId;
    void userId;

    const searchResults = await searchKnowledgeBase(
        normalizedQuery,
        userRole,
        operationsDb
    );
    const context = buildContext(searchResults);
    const knowledgeBaseUsed = context.length > 0;

    if (!knowledgeBaseUsed) {
        return {
            answer: buildUnavailableAnswer(language),
            sources: [],
            language,
            knowledgeBaseUsed: false,
        };
    }

    const providerResult = await generateAnswer({
        query: normalizedQuery,
        language,
        context,
    });

    return {
        answer: providerResult.answer,
        sources: buildSources(context, language),
        language,
        knowledgeBaseUsed: true,
        model: providerResult.model,
        tokensUsed: providerResult.tokensUsed,
    };
}

module.exports = {
    answerQuery,
    detectLanguage,
    validateQuery,
};
