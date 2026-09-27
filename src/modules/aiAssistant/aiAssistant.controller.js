"use strict";

const { sendSuccess } = require("../../utils/response.utils");
const env = require("../../config/env");
const { answerQuery } = require("./aiAssistant.service");

const QUERY_LOG_MODEL = "AIAssistantQueryLog";

function getSafeQuery(query) {
    if (typeof query !== "string") {
        return "";
    }

    return query
        .trim()
        .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "[REDACTED_TOKEN]")
        .replace(/(password|passwd|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

async function logAssistantQuery(opsDb, data) {
    try {
        const QueryLog = opsDb.model(QUERY_LOG_MODEL);
        await QueryLog.create(data);
    } catch (loggingError) {
        console.error("[AI Assistant] Query logging failed:", loggingError.message);
    }
}

class AIAssistantController {
    async askAssistant(req, res, next) {
        const startedAt = Date.now();
        const query = getSafeQuery(req.body?.query);

        try {
            const { id: userId, role, societyId } = req.user;

            const result = await answerQuery({
                query,
                userRole: role,
                societyId,
                userId,
            }, req.opsDb);

            await logAssistantQuery(req.opsDb, {
                societyId,
                userId,
                query,
                response: result.answer,
                timestamp: new Date(),
                durationMs: Date.now() - startedAt,
                model: result.model || env.OPEN_ROUTER_MODEL,
                tokensUsed: result.tokensUsed || 0,
                context: result.sources,
                successful: true,
            });

            return sendSuccess(
                res,
                200,
                "AI Assistant response generated successfully.",
                result
            );
        } catch (error) {
            const userId = req.user?.id;
            const societyId = req.user?.societyId;

            if (userId && societyId && query) {
                await logAssistantQuery(req.opsDb, {
                    societyId,
                    userId,
                    query,
                    timestamp: new Date(),
                    durationMs: Date.now() - startedAt,
                    model: env.OPEN_ROUTER_MODEL,
                    tokensUsed: 0,
                    context: [],
                    successful: false,
                    errorMessage: error.message || "Assistant request failed",
                });
            }

            next(error);
        }
    }
}

module.exports = new AIAssistantController();
