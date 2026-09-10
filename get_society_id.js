require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const masterDb = mongoose.connection.useDb(process.env.MASTER_DB_NAME);
        const Society = masterDb.collection('societies');
        const society = await Society.findOne({});
        if (society) {
            console.log(`FOUND_SOCIETY_ID:${society._id}`);
            console.log(`FOUND_SOCIETY_NAME:${society.name}`);
        } else {
            console.log('NO_SOCIETY_FOUND');
        }
        
        // Let's create a dummy guard so they can test
        const opsDb = mongoose.connection.useDb(process.env.OPERATIONS_DB_NAME);
        const User = opsDb.collection('users');
        const UserSocietyMapping = masterDb.collection('usersocietymappings');
        
        const guardMobile = '9999999999';
        const guardExists = await User.findOne({ mobile: guardMobile, societyId: society._id });
        if (!guardExists) {
            const result = await User.insertOne({
                name: 'Test Guard',
                mobile: guardMobile,
                role: 'security_guard',
                societyId: society._id,
                status: 'active',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            await UserSocietyMapping.insertOne({
                userId: result.insertedId,
                societyId: society._id,
                role: 'security_guard',
                roleKeys: ['security_guard'],
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('CREATED_GUARD_WITH_MOBILE:9999999999');
        } else {
            console.log('GUARD_ALREADY_EXISTS_WITH_MOBILE:9999999999');
        }
        
    } catch (err) {
        console.error(err);
    } finally {
        await mongoose.disconnect();
    }
}
run();
