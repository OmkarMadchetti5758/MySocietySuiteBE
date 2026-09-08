"use strict";

const { S3Client } = require("@aws-sdk/client-s3");
const env = require("./env");

const spacesClient = new S3Client({
    endpoint: env.DO_SPACES_ENDPOINT,
    region: env.DO_SPACE_REGION || "us-east-1",
    forcePathStyle: false,
    credentials: {
        accessKeyId: env.DO_SPACES_KEY,
        secretAccessKey: env.DO_SPACES_SECRET,
    },
});

module.exports = spacesClient;
