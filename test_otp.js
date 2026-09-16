require('dotenv').config();
const mongoose = require('mongoose');
const { getMasterConnection } = require('./src/config/masterDb');
const OtpService = require('./src/modules/otp/otp.service');
const AuthService = require('./src/modules/auth/auth.service');

async function test() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        getMasterConnection(); // Init
        console.log("Testing guardSendOtp...");
        await AuthService.guardSendOtp('9999999999');
        console.log("Success!");
    } catch (err) {
        console.error("ERROR:");
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
test();
