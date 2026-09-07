"use strict";

/**
 * EmailService
 *
 * Sends transactional email (OTP codes and invite links) via SMTP.
 * Credentials come from env (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS).
 *
 * If SMTP_USER / SMTP_PASS are missing, the message is logged to the console
 * instead of throwing — so local setups without mail still work.
 */

const nodemailer = require("nodemailer");
const AppError = require("../common/AppError");
const env = require("../config/env");

const BRAND = "MySocietySuite";
const OTP_TTL_MINUTES = env.OTP_EXPIRES_IN_MINUTES || 10;

const PURPOSE_LABELS = {
    manager_invite:  "manager onboarding",
    resident_invite: "resident onboarding",
    staff_invite:    "staff onboarding",
    vendor_invite:   "vendor onboarding",
};

function looksLikeEmail(value) {
    return typeof value === "string" && value.includes("@");
}

function escapeHtml(str) {
    return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

class EmailService {
    constructor() {
        this._transporter = null;
    }

    _isConfigured() {
        return Boolean(env.SMTP_USER && env.SMTP_PASS);
    }

    _getTransporter() {
        if (this._transporter) return this._transporter;

        const user = env.SMTP_USER;
        const pass = env.SMTP_PASS;
        const host = String(env.SMTP_HOST || "").toLowerCase();
        const isGmail = host.includes("gmail.com") || host === "gmail";

        // Gmail well-known settings (STARTTLS on 587). Port 465 SSL often triggers 534-5.7.14.
        if (isGmail) {
            this._transporter = nodemailer.createTransport({
                service: "gmail",
                auth: { user, pass },
            });
        } else {
            this._transporter = nodemailer.createTransport({
                host: env.SMTP_HOST,
                port: env.SMTP_PORT,
                secure: env.SMTP_SECURE || env.SMTP_PORT === 465,
                requireTLS: env.SMTP_PORT === 587,
                auth: { user, pass },
            });
        }

        return this._transporter;
    }

    _from() {
        return `"${BRAND}" <${env.SMTP_USER}>`;
    }

    _userMessage(err) {
        const msg = String(err && err.message ? err.message : "");
        if (/5\.7\.14|534-|log in via your web browser|Invalid login/i.test(msg)) {
            return (
                "Gmail blocked the SMTP login. Sign in to this Gmail account in a browser, " +
                "enable 2-Step Verification, generate a new App Password for Mail, " +
                "set SMTP_PASS to that 16-character password (quoted) in .env, " +
                "then restart the API."
            );
        }
        return "Failed to send email. Please try again later.";
    }

    async _send({ to, subject, text, html }) {
        if (!looksLikeEmail(to)) {
            return { sent: false, skipped: true };
        }

        if (!this._isConfigured()) {
            console.warn("[EmailService] SMTP not configured — email not sent");
            return { sent: false, to, skipped: true };
        }

        try {
            const info = await this._getTransporter().sendMail({
                from: this._from(),
                to,
                subject,
                text,
                html,
            });
            return { sent: true, to, messageId: info.messageId };
        } catch (err) {
            console.error("[EmailService] SMTP send failed:", err.message);
            throw new AppError(this._userMessage(err), 502, "EMAIL_SEND_FAILED");
        }
    }

    /**
     * Send a 6-digit OTP to an email address.
     */
    async sendOtpEmail(to, code, purpose) {
        const purposeLabel = PURPOSE_LABELS[purpose] || purpose || "verification";
        const subject = `${BRAND} verification code`;
        const text =
            `Your OTP for ${BRAND} (${purposeLabel}) is ${code}. ` +
            `Valid for ${OTP_TTL_MINUTES} minutes. Do not share this code with anyone.`;

        const html = `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
              <h2 style="margin-bottom:8px">${escapeHtml(BRAND)}</h2>
              <p>Your verification code for <strong>${escapeHtml(purposeLabel)}</strong> is:</p>
              <p style="font-size:28px;letter-spacing:6px;font-weight:bold;margin:24px 0">${escapeHtml(code)}</p>
              <p>This code is valid for ${OTP_TTL_MINUTES} minutes. Do not share it with anyone.</p>
              <p style="color:#666;font-size:12px;margin-top:32px">If you did not request this, you can ignore this email.</p>
            </div>
        `;

        return this._send({ to, subject, text, html });
    }

    /**
     * Send an account activation / invite link.
     *
     * @param {object} opts
     * @param {string} opts.to
     * @param {string} [opts.recipientName]
     * @param {string} [opts.roleLabel]     e.g. "Society Manager", "Resident"
     * @param {string} [opts.societyName]
     * @param {string} opts.inviteLink
     */
    async sendInviteEmail({ to, recipientName, roleLabel, societyName, inviteLink }) {
        if (!looksLikeEmail(to)) {
            return { sent: false, skipped: true };
        }

        const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
        const roleBit = roleLabel ? ` as ${roleLabel}` : "";
        const societyBit = societyName ? ` for ${societyName}` : "";

        const subject = `You're invited to ${BRAND}${societyBit}`;
        const text =
            `${greeting}\n\n` +
            `You have been invited to join ${BRAND}${roleBit}${societyBit}.\n\n` +
            `Activate your account using this link:\n${inviteLink}\n\n` +
            `If you were not expecting this invitation, you can ignore this email.`;

        const html = `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
              <h2 style="margin-bottom:8px">${escapeHtml(BRAND)}</h2>
              <p>${escapeHtml(greeting)}</p>
              <p>You have been invited to join <strong>${escapeHtml(BRAND)}</strong>${escapeHtml(roleBit)}${escapeHtml(societyBit)}.</p>
              <p style="margin:28px 0">
                <a href="${escapeHtml(inviteLink)}"
                   style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">
                  Activate your account
                </a>
              </p>
              <p style="font-size:13px;color:#555">Or copy this link into your browser:<br>
                <a href="${escapeHtml(inviteLink)}">${escapeHtml(inviteLink)}</a>
              </p>
              <p style="color:#666;font-size:12px;margin-top:32px">If you were not expecting this invitation, you can ignore this email.</p>
            </div>
        `;

        try {
            return await this._send({ to, subject, text, html });
        } catch (err) {
            // Invite records are already persisted before mail is sent.
            // Do not turn a successful create into 502 because SMTP credentials failed.
            console.error("[EmailService] Invite email failed (record kept):", err.message);
            return { sent: false, to, skipped: false, error: err.message };
        }
    }
}

module.exports = new EmailService();
