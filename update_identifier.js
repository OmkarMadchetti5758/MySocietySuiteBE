require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const db = mongoose.connection.useDb(process.env.MASTER_DB_NAME);
        const result = await db.collection('usersocietymappings').updateOne(
            { role: 'security_guard' },
            { $set: { identifier: '9999999999' } }
        );
        console.log(result);
    } catch(err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
