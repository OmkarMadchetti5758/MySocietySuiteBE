const { connectMasterDB, getMasterConnection } = require('./src/config/masterDb');
const { connectOperationsDB, getOperationsConnection } = require('./src/config/operationsDb');
const DESIGNATION_TO_ROLE = { security_guard: 'security_guard', security: 'security_guard', guard: 'security_guard', guard_manager: 'guard_manager', facility_manager: 'facility_manager', accountant: 'accountant', vendor_manager: 'vendor_manager' };
async function run() {
    await connectMasterDB(); await connectOperationsDB();
    const masterDb = getMasterConnection(); const opsDb = getOperationsConnection();
    const Staff = opsDb.model('Staff'); const User = opsDb.model('User'); const Mapping = masterDb.model('UserSocietyMapping');
    const fixableDesignations = Object.keys(DESIGNATION_TO_ROLE);
    const staffToFix = await Staff.find({ role: { $in: fixableDesignations } }).lean();
    console.log('Found ' + staffToFix.length + ' staff records to check');
    let fixed = 0;
    for (const s of staffToFix) {
        const correctRole = DESIGNATION_TO_ROLE[s.role.toLowerCase()];
        if (!correctRole || !s.userId) continue;
        const user = await User.findOne({ _id: s.userId });
        if (!user || user.role === correctRole) { console.log('  SKIP ' + s.name); continue; }
        console.log('  FIX ' + user.name + ': ' + user.role + ' -> ' + correctRole);
        await User.updateOne({ _id: s.userId }, { role: correctRole });
        await Mapping.updateMany({ userId: s.userId, societyId: s.societyId }, { $set: { roleKeys: [correctRole] } });
        fixed++;
    }
    console.log('Done! Fixed ' + fixed + ' user(s).'); process.exit(0);
}
run().catch(err => { console.error('Migration failed:', err); process.exit(1); });
