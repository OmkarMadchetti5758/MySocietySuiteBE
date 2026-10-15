"use strict";

const path = require("path");
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");
const env = require("./env");

const options = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "MySocietySuite API",
            version: "1.0.0",
            description:
                "Multi-Tenant Society Management SaaS Backend REST API documentation. Includes detailed authentication and account management endpoints.",
            contact: {
                name: "MySocietySuite Team",
            },
        },
        servers: [
            {
                url: "/api/v1",
                description: "API V1 Base Path (Relative)",
            },
            {
                url: `http://localhost:${env.PORT}/api/v1`,
                description: "Local Development Server",
            },
        ],
        tags: [
            {
                name: "Auth",
                description: "Authentication, onboarding invites, and session token management",
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Enter your Bearer JWT token in the format: Bearer <token>",
                },
                tenantHeader: {
                    type: "apiKey",
                    in: "header",
                    name: "x-tenant-id",
                    description: "MongoDB ObjectId of the Society / Tenant context",
                },
            },
            schemas: {
                ErrorResponse: {
                    type: "object",
                    properties: {
                        status: { type: "string", example: "fail" },
                        message: { type: "string", example: "Error message description" },
                        errorCode: { type: "string", example: "INVALID_CREDENTIALS" },
                    },
                },
                SuccessResponse: {
                    type: "object",
                    properties: {
                        status: { type: "string", example: "success" },
                        message: { type: "string", example: "Operation completed successfully" },
                        data: { type: "object" },
                    },
                },
            },
        },
    },
    apis: [
        path.join(__dirname, "../modules/**/*.swagger.js").replace(/\\/g, "/"),
        path.join(__dirname, "../modules/**/*.routes.js").replace(/\\/g, "/"),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

const swaggerUiOptions = {
    customSiteTitle: "MySocietySuite API Docs",
    customCss: `
        .swagger-ui .topbar { display: none; }
        .swagger-ui .info { margin: 20px 0; }
        .swagger-ui .info .title { font-family: sans-serif; color: #1e293b; }
        .swagger-ui .opblock-tag { font-size: 1.1rem; border-bottom: 2px solid #e2e8f0; }
    `,
    swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        docExpansion: "list",
        filter: true,
    },
};

module.exports = {
    swaggerUi,
    swaggerSpec,
    swaggerUiOptions,
};
