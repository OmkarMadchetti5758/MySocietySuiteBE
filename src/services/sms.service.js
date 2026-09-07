"use strict";

/**
 * SmsService
 *
 * Provides a thin, reusable wrapper around the SMSGatewayCenter HTTP API
 * (https://unify.smsgateway.center/SMSApi/send).
 *
 * Design decisions
 * ──────────────────────────────────────────────────────────────────────────
 * • All SMS logic lives here — controllers / other services MUST NOT build
 *   raw HTTP calls to the SMS gateway.
 * • In development mode the SMS is NOT sent; the OTP is printed to the
 *   console instead (safe for local dev / CI).
 * • The service throws a structured AppError on unrecoverable failures so
 *   the caller can propagate it to the global error handler.
 * • One lightweight retry (with exponential back-off) is attempted on
 *   transient network/5xx errors before giving up.
 * • Phone numbers are normalised to E.164 India format (91XXXXXXXXXX)
 *   automatically.
 */

const AppError = require("../common/AppError");

// ── Config ──────────────────────────────────────────────────────────────────

const SMS_API_URL = "https://unify.smsgateway.center/SMSApi/send";

const SMS_USERID      = process.env.SMS_USERID;
const SMS_PASSWORD    = process.env.SMS_PASSWORD;
const SMS_SENDERID    = process.env.SMS_SENDERID;
const SMS_ENTITY_ID   = process.env.SMS_DLT_ENTITY_ID;
const SMS_TEMPLATE_ID = process.env.SMS_DLT_TEMPLATE_ID;
const NODE_ENV        = process.env.NODE_ENV || "development";

/** Maximum retries on transient failures (network / 5xx). */
const MAX_RETRIES   = 2;
/** Base delay in ms for exponential back-off (100 ms → 200 ms). */
const RETRY_BASE_MS = 100;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalise a mobile number to the E.164 India format expected by the
 * SMSGatewayCenter API: `91XXXXXXXXXX` (12 digits, no +, no spaces).
 *
 * Accepts:
 *   +91XXXXXXXXXX  →  91XXXXXXXXXX
 *   91XXXXXXXXXX   →  91XXXXXXXXXX
 *   0XXXXXXXXXX    →  91XXXXXXXXXX  (leading zero stripped)
 *   XXXXXXXXXX     →  91XXXXXXXXXX  (bare 10-digit number)
 */
function normalizePhone(raw) {
    if (typeof raw !== "string" || !raw.trim()) {
        throw new AppError("SMS recipient phone number is required.", 400, "SMS_INVALID_PHONE");
    }

    // Strip all non-digit characters (spaces, dashes, parentheses, +)
    let digits = raw.replace(/\D/g, "");

    // Strip leading zero (domestic Indian format: 09XXXXXXXXX)
    if (digits.startsWith("0")) {
        digits = digits.slice(1);
    }

    // Prepend country code if needed
    if (digits.length === 10) {
        digits = "91" + digits;
    }

    if (digits.length !== 12 || !digits.startsWith("91")) {
        throw new AppError(
            `Invalid phone number format: "${raw}". Expected a 10-digit Indian mobile number.`,
            400,
            "SMS_INVALID_PHONE"
        );
    }

    return digits;
}

/**
 * Build the OTP message body.
 * Must match your DLT-registered template exactly.
 *
 * Registered Template:
 *   "Your OTP for MySocietySuite is {#var#}. Valid for 10 minutes. Do not share with anyone."
 */
function buildOtpMessage(otp) {
    return `Your OTP for MySocietySuite is ${otp}. Valid for 10 minutes. Do not share with anyone.`;
}

/**
 * Sleep for `ms` milliseconds (used for retry back-off).
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single HTTP POST to the SMSGatewayCenter API using the native
 * `fetch` API (available in Node >= 18; no extra dependency required).
 *
 * @param {string} mobile  - Normalised 12-digit number.
 * @param {string} message - SMS body text.
 * @returns {Promise<object>} Parsed JSON response from the gateway.
 */
async function callGateway(mobile, message) {
    const params = new URLSearchParams({
        userid:        SMS_USERID,
        password:      SMS_PASSWORD,
        senderid:      SMS_SENDERID,
        mobile,
        msg:           message,
        entityid:      SMS_ENTITY_ID,
        dlttemplateid: SMS_TEMPLATE_ID,
        output:        "json",
    });

    const response = await fetch(SMS_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    params.toString(),
        // Abort if the gateway takes more than 10 seconds
        signal:  AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
        // Treat non-2xx HTTP status codes as transient (will be retried for 5xx)
        const err = new Error(`SMS gateway returned HTTP ${response.status}`);
        err.isTransient = response.status >= 500;
        throw err;
    }

    const data = await response.json();
    return data;
}

/**
 * Validate the parsed gateway JSON response.
 * SMSGatewayCenter returns `{ Status: "Success", ... }` on success.
 *
 * @param {object} data - Parsed response body.
 * @throws AppError if the gateway reports a business-level failure.
 */
function validateGatewayResponse(data) {
    // The API returns Status = "Success" on success
    if (!data || (data.Status !== "Success" && data.ErrorCode !== "000")) {
        const reason = data?.Description || data?.Message || JSON.stringify(data);
        throw new AppError(
            `SMS delivery failed: ${reason}`,
            502,
            "SMS_GATEWAY_ERROR"
        );
    }
}

// ── SmsService ───────────────────────────────────────────────────────────────

class SmsService {
    /**
     * Verify that all required SMS environment variables are set.
     * Called lazily on the first real SMS attempt so that missing config
     * is caught early with a clear error message.
     */
    _assertConfig() {
        const missing = [];
        if (!SMS_USERID)      missing.push("SMS_USERID");
        if (!SMS_PASSWORD)    missing.push("SMS_PASSWORD");
        if (!SMS_SENDERID)    missing.push("SMS_SENDERID");
        if (!SMS_ENTITY_ID)   missing.push("SMS_DLT_ENTITY_ID");
        if (!SMS_TEMPLATE_ID) missing.push("SMS_DLT_TEMPLATE_ID");

        if (missing.length) {
            throw new AppError(
                `SMS service misconfigured — missing env vars: ${missing.join(", ")}`,
                500,
                "SMS_CONFIG_ERROR"
            );
        }
    }

    /**
     * Send an OTP via SMS to the given phone number.
     *
     * In development / test the message is printed to the console and NO
     * HTTP request is made to the gateway.
     *
     * In production the gateway is called with automatic retry on transient
     * failures (network errors, 5xx responses).
     *
     * @param {string} phone - Raw phone number (any reasonable format).
     * @param {string} otp   - 6-digit OTP code to deliver.
     * @returns {Promise<{ sent: boolean, mobile: string, devMode?: boolean }>}
     */
    async sendOtpSms(phone, otp) {
        // Always normalise so validation errors surface immediately.
        const mobile  = normalizePhone(phone);
        const message = buildOtpMessage(otp);

        // ── Development: log only, no real HTTP call ─────────────────────────
        if (NODE_ENV !== "production") {
            console.log(`[SmsService] DEV MODE — SMS not sent to gateway (${mobile})`);
            return { sent: false, mobile, devMode: true };
        }

        // ── Production: call the gateway with retry ──────────────────────────
        this._assertConfig();

        let lastError;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const data = await callGateway(mobile, message);
                validateGatewayResponse(data);

                console.info(
                    `[SmsService] OTP SMS sent successfully to ${mobile} ` +
                    `(msgId: ${data.MessageId || data.MsgId || "N/A"})`
                );
                return { sent: true, mobile };

            } catch (err) {
                lastError = err;

                // Non-transient errors (e.g. template mismatch, invalid phone)
                // will fail again immediately — do NOT retry.
                const isTransient =
                    err.isTransient === true  ||   // set explicitly above for 5xx
                    err.name === "AbortError"  ||   // timeout
                    err.name === "TypeError";       // fetch network-level error

                if (!isTransient || attempt === MAX_RETRIES) {
                    break;
                }

                const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                console.warn(
                    `[SmsService] Attempt ${attempt} failed (${err.message}). ` +
                    `Retrying in ${delay}ms…`
                );
                await sleep(delay);
            }
        }

        // All attempts exhausted.
        console.error(
            "[SmsService] Failed to send OTP SMS after retries:",
            lastError?.message
        );

        // Re-throw AppErrors (e.g. gateway validation failures) as-is.
        if (lastError instanceof AppError) throw lastError;

        throw new AppError(
            "We could not deliver the OTP via SMS at this time. Please try again shortly.",
            503,
            "SMS_DELIVERY_FAILED"
        );
    }
}

module.exports = new SmsService();
