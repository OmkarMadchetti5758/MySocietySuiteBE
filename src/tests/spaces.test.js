"use strict";

require("dotenv").config();
const { uploadFile, deleteStoredFile, getPublicUrl } = require("../services/storage.service");

const testUpload = async () => {
    const key = `test/healthcheck-${Date.now()}.txt`;
    try {
        const uploaded = await uploadFile({
            buffer: Buffer.from("Hello from MySocietySuite!"),
            key,
            contentType: "text/plain",
        });

        console.log("Spaces upload OK");
        console.log("Key:", uploaded.key);
        console.log("URL:", uploaded.url || getPublicUrl(key));

        await deleteStoredFile(uploaded.key);
        console.log("Spaces delete OK");
    } catch (error) {
        console.error("Spaces upload failed");
        console.error(error.message);
        process.exitCode = 1;
    }
};

testUpload();
