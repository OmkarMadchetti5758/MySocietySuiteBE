"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { getMasterConnection } = require("../../config/masterDb");

/**
 * Get comprehensive dynamic dashboard statistics for a society.
 * @param {string} societyId
 */
const getAdminDashboardStats = async (societyId) => {
    const masterDb = getMasterConnection();
    const opsDb = getOperationsConnection();

    // Models
    const Society = masterDb.model("Society");
    const Resident = opsDb.model("Resident");
    const Flat = opsDb.model("Flat");
    const VisitorEntry = opsDb.model("VisitorEntry");
    const Staff = opsDb.model("Staff");
    const Attendance = opsDb.model("Attendance");
    const Complaint = opsDb.model("Complaint");
    const MaintenanceBill = opsDb.model("MaintenanceBill");
    const AmenityBooking = opsDb.model("AmenityBooking");
    const ParkingSlot = opsDb.model("ParkingSlot");
    const Vehicle = opsDb.model("Vehicle");
    const Vendor = opsDb.model("Vendor");
    const Notice = opsDb.model("Notice");
    const Festival = opsDb.model("Festival");
    const FestivalCollection = opsDb.model("FestivalCollection");

    // Fetch Society Info
    let society = null;
    if (societyId) {
        society = await Society.findById(societyId).select("name city code").lean();
    }

    const societyFilter = societyId ? { societyId } : {};

    // 1. Resident & Flat Stats
    const [totalResidents, totalFlats, occupiedFlats] = await Promise.all([
        Resident.countDocuments(societyFilter),
        Flat.countDocuments(societyFilter),
        Flat.countDocuments({ ...societyFilter, status: { $in: ["OCCUPIED", "occupied"] } })
    ]);

    // 2. Visitors & Vehicles Today
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const startOfTodayUTC = new Date();
    startOfTodayUTC.setUTCHours(0, 0, 0, 0);
    const endOfTodayUTC = new Date();
    endOfTodayUTC.setUTCHours(23, 59, 59, 999);

    const earliestDate = new Date(Math.min(startOfToday.getTime(), startOfTodayUTC.getTime()));
    const latestDate = new Date(Math.max(endOfToday.getTime(), endOfTodayUTC.getTime()));

    const todayFilter = {
        ...societyFilter,
        createdAt: { $gte: startOfToday, $lte: endOfToday }
    };

    const [visitorsToday, vehiclesToday] = await Promise.all([
        VisitorEntry.countDocuments(todayFilter),
        Vehicle.countDocuments(societyFilter)
    ]);

    // 3. Staff & Attendance
    const totalStaff = await Staff.countDocuments(societyFilter);
    const attendanceToday = await Attendance.find({
        ...societyFilter,
        date: { $gte: earliestDate, $lte: latestDate }
    }).lean();

    const staffPresent = attendanceToday.filter(a => {
        const s = String(a.status || '').toLowerCase();
        return s === "present" || s === "checked_in" || s === "checked-in";
    }).length;

    const staffAbsent = attendanceToday.filter(a => {
        const s = String(a.status || '').toLowerCase();
        return s === "absent";
    }).length;

    const staffOnLeave = attendanceToday.filter(a => {
        const s = String(a.status || '').toLowerCase();
        return s === "on-leave" || s === "on_leave" || s === "leave";
    }).length;

    // 4. Complaints
    const [openComplaintsCount, inProgressComplaintsCount, newComplaintsCount, escalatedComplaintsCount, totalComplaints] = await Promise.all([
        Complaint.countDocuments({ ...societyFilter, status: { $in: ["OPEN", "open", "IN_PROGRESS", "in_progress", "ASSIGNED", "assigned", "ESCALATED", "escalated"] } }),
        Complaint.countDocuments({ ...societyFilter, status: { $in: ["IN_PROGRESS", "in_progress"] } }),
        Complaint.countDocuments({ ...societyFilter, status: { $in: ["OPEN", "open"] } }),
        Complaint.countDocuments({ ...societyFilter, status: { $in: ["ESCALATED", "escalated"] } }),
        Complaint.countDocuments(societyFilter)
    ]);

    // 5. Financials (Bills & Dues)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [paidBillsThisMonth, pendingBills] = await Promise.all([
        MaintenanceBill.aggregate([
            {
                $match: {
                    ...(societyId ? { societyId } : {}),
                    status: { $in: ["PAID", "paid"] },
                    paidAt: { $gte: startOfMonth }
                }
            },
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]),
        MaintenanceBill.aggregate([
            {
                $match: {
                    ...(societyId ? { societyId } : {}),
                    status: { $in: ["UNPAID", "unpaid", "PARTIALLY_PAID", "partially_paid", "OVERDUE", "overdue", "PENDING", "pending"] }
                }
            },
            { $group: { _id: null, total: { $sum: "$dueAmount" }, count: { $addToSet: "$flatId" } } }
        ])
    ]);

    const collectionThisMonth = paidBillsThisMonth[0]?.total || 0;
    const pendingDues = pendingBills[0]?.total || 0;
    const pendingUnitsCount = pendingBills[0]?.count?.length || 0;

    // 6. Amenities & Parking & Vendors & Festival Collections
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const [amenityBookingsToday, upcomingAmenityBookings, totalParkingSlots, occupiedParkingSlots, carsCount, twoWheelersCount, activeVendors, expiringVendors, activeFestivalCollectionsCount] = await Promise.all([
        AmenityBooking.countDocuments({
            ...societyFilter,
            bookingDate: { $gte: earliestDate, $lte: latestDate },
            status: { $nin: ["cancelled", "CANCELLED", "rejected", "REJECTED"] }
        }),
        AmenityBooking.countDocuments({
            ...societyFilter,
            bookingDate: { $gt: latestDate },
            status: { $nin: ["cancelled", "CANCELLED", "rejected", "REJECTED"] }
        }),
        ParkingSlot.countDocuments(societyFilter),
        ParkingSlot.countDocuments({
            ...societyFilter,
            $or: [
                { isOccupied: true },
                { status: { $in: ["occupied", "OCCUPIED", "allocated", "ALLOCATED", "reserved", "RESERVED"] } }
            ]
        }),
        Vehicle.countDocuments({ ...societyFilter, vehicleType: { $in: ["CAR", "car", "FOUR_WHEELER", "four_wheeler"] } }),
        Vehicle.countDocuments({ ...societyFilter, vehicleType: { $in: ["TWO_WHEELER", "two_wheeler", "BIKE", "bike", "SCOOTER", "scooter", "BICYCLE", "bicycle"] } }),
        Vendor.countDocuments({ ...societyFilter, status: { $in: ["ACTIVE", "active"] } }),
        Vendor.countDocuments({
            ...societyFilter,
            status: { $in: ["ACTIVE", "active"] },
            contractEndDate: { $gte: startOfToday, $lte: sevenDaysFromNow }
        }),
        FestivalCollection.countDocuments({
            ...societyFilter,
            status: { $in: ["active", "ACTIVE", "published", "PUBLISHED", "open", "OPEN"] }
        }).catch(() => 0)
    ]);

    const parkingOccupancyPct = totalParkingSlots > 0
        ? Math.round((occupiedParkingSlots / totalParkingSlots) * 100)
        : 0;

    // 7. Festivals & Upcoming Events & Notices
    let displayFestivals = await Festival.find({
        ...societyFilter,
        status: { $nin: ["CANCELLED", "cancelled"] },
        $or: [
            { date: { $gte: startOfToday } },
            { date: { $gte: earliestDate } }
        ]
    }).sort({ date: 1 }).limit(5).lean();

    if (displayFestivals.length === 0) {
        displayFestivals = await Festival.find({
            ...societyFilter,
            status: { $nin: ["CANCELLED", "cancelled"] }
        }).sort({ createdAt: -1 }).limit(5).lean();
    }

    const activeNotices = await Notice.find({
        ...societyFilter,
        isArchived: { $ne: true }
    }).sort({ createdAt: -1 }).limit(5).lean();

    // Prepare response payload
    return {
        societyName: society?.name || "My Society",
        topStats: {
            totalResidents: totalResidents || 0,
            residentSubtitle: `${occupiedFlats || 0} Occupied Units`,
            totalFlats: totalFlats || 0,
            occupiedFlats: occupiedFlats || 0,
            visitorsToday: visitorsToday || 0,
            vehiclesToday: vehiclesToday || 0,
            staffPresent: staffPresent || 0,
            staffTotal: totalStaff || 0,
            staffDutyPct: totalStaff > 0 ? Math.round((staffPresent / totalStaff) * 100) : 0,
            openComplaints: openComplaintsCount || 0,
            inProgressComplaints: inProgressComplaintsCount || 0,
            collectionThisMonth: collectionThisMonth || 0,
            collectionFormatted: `₹${(collectionThisMonth || 0).toLocaleString("en-IN")}`,
            pendingDues: pendingDues || 0,
            pendingDuesFormatted: `₹${(pendingDues || 0).toLocaleString("en-IN")}`,
            pendingUnitsCount: pendingUnitsCount || 0,
            upcomingEventsCount: displayFestivals.length
        },
        priorityOverview: {
            security: {
                statusText: totalStaff > 0 ? "Operational" : "No Staff",
                statusType: totalStaff > 0 ? "success" : "warning",
                visitorsToday: visitorsToday || 0,
                vehiclesToday: vehiclesToday || 0,
                staffPresent: `${staffPresent} / ${totalStaff}`
            },
            cleaning: {
                statusText: staffPresent > 0 ? "On Track" : "Attention Required",
                statusType: staffPresent > 0 ? "success" : "warning",
                completedAreas: `${staffPresent}`,
                pendingAreas: Math.max(0, totalStaff - staffPresent),
                staffPresent: `${staffPresent} / ${totalStaff}`
            },
            staffAttendance: {
                percentage: totalStaff > 0 ? Math.round((staffPresent / totalStaff) * 100) : 0,
                present: staffPresent,
                absent: staffAbsent,
                onLeave: staffOnLeave
            },
            festivals: {
                title: displayFestivals[0]?.title || displayFestivals[0]?.name || "No Upcoming Events",
                date: displayFestivals[0]?.date ? new Date(displayFestivals[0].date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-",
                upcomingEventsCount: displayFestivals.length,
                activeCollectionsCount: activeFestivalCollectionsCount || 0,
                newAnnouncements: activeNotices.length
            }
        },
        operationsSummary: {
            complaints: {
                total: totalComplaints || 0,
                newCount: newComplaintsCount || 0,
                inProgressCount: inProgressComplaintsCount || 0,
                escalatedCount: escalatedComplaintsCount || 0
            },
            maintenance: {
                openRequests: pendingUnitsCount || openComplaintsCount || 0,
                pendingCount: pendingUnitsCount || 0,
                inProgressCount: inProgressComplaintsCount || 0,
                onHoldCount: 0
            },
            amenities: {
                bookingsToday: amenityBookingsToday || 0,
                upcoming: upcomingAmenityBookings || 0,
                inProgress: amenityBookingsToday || 0
            },
            parking: {
                occupiedPercentage: parkingOccupancyPct || 0,
                carsCount: carsCount || 0,
                twoWheelersCount: twoWheelersCount || 0
            },
            vendors: {
                activeCount: activeVendors || 0,
                expiringSoon: expiringVendors || 0,
                pendingPayments: 0
            }
        },
        alerts: [
            ...(openComplaintsCount > 0 ? [{
                id: "c1",
                type: "warning",
                message: `${openComplaintsCount} complaints awaiting resolution`,
                subtext: "Helpdesk ticket update required",
                time: "Recent"
            }] : []),
            ...(pendingUnitsCount > 0 ? [{
                id: "m1",
                type: "info",
                message: `${pendingUnitsCount} units have pending maintenance dues`,
                subtext: "Billing reminders scheduled",
                time: "Today"
            }] : []),
            ...(activeNotices.slice(0, 3).map((notice, idx) => ({
                id: `n_${notice._id || idx}`,
                type: "info",
                message: notice.title,
                subtext: notice.category || "Announcement",
                time: new Date(notice.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
            })))
        ],
        events: displayFestivals.map(fest => {
            const festDate = fest.date ? new Date(fest.date) : new Date();
            return {
                id: fest._id,
                date: festDate.getDate(),
                month: festDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
                title: fest.title || fest.name || "Festival Event",
                location: fest.venue || fest.location || "Community Hall",
                time: fest.startTime ? `${fest.startTime}${fest.endTime ? ` - ${fest.endTime}` : ''}` : (fest.time || "All Day"),
                image: fest.image || "https://cdn-icons-png.flaticon.com/512/3884/3884632.png"
            };
        })
    };
};

/**
 * Get dynamic dashboard statistics for a Resident.
 * @param {string} userId
 * @param {string} societyId
 */
const getResidentDashboardStats = async (userId, societyId) => {
    const masterDb = getMasterConnection();
    const opsDb = getOperationsConnection();

    // Models
    const User = opsDb.model("User");
    const Society = masterDb.model("Society");
    const Resident = opsDb.model("Resident");
    const Flat = opsDb.model("Flat");
    const VisitorEntry = opsDb.model("VisitorEntry");
    const MaintenanceBill = opsDb.model("MaintenanceBill");
    const Notice = opsDb.model("Notice");
    const FestivalCollection = opsDb.model("FestivalCollection");
    const UserSocietyMapping = masterDb.model("UserSocietyMapping");
    const Staff = opsDb.model("Staff");

    // 1. Fetch User Info
    const user = await User.findById(userId).select("firstName lastName name email mobile").lean();
    const userName = user?.name || (user?.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : "Resident");

    // 2. Fetch Society Info
    let societyName = "Society";
    if (societyId) {
        const society = await Society.findById(societyId).select("name").lean();
        if (society?.name) societyName = society.name;
    }

    // 3. Fetch Resident's Flat Details
    let flatId = null;
    let flatDetails = "";

    const residentRecord = await Resident.findOne({ userId, ...(societyId ? { societyId } : {}) })
        .populate({ path: "flatId", select: "flatNumber wing block floor" })
        .lean();

    if (residentRecord?.flatId) {
        flatId = residentRecord.flatId._id;
        const flatObj = residentRecord.flatId;
        const wingOrBlock = flatObj.wing || flatObj.block || "";
        const number = flatObj.flatNumber || "";
        const prefix = wingOrBlock ? ((wingOrBlock.startsWith("Building") || wingOrBlock.startsWith("Tower") || wingOrBlock.startsWith("Block"))
            ? wingOrBlock
            : `Building ${wingOrBlock}`) : "";
        flatDetails = [prefix, number ? `Flat ${number}` : ""].filter(Boolean).join(", ");
    } else {
        const mapping = await UserSocietyMapping.findOne({ userId, ...(societyId ? { societyId } : {}) }).lean();
        if (mapping?.flatId) {
            flatId = mapping.flatId;
            const flatDoc = await Flat.findById(flatId).select("flatNumber wing block").lean();
            if (flatDoc) {
                const wingOrBlock = flatDoc.wing || flatDoc.block || "";
                const prefix = wingOrBlock ? ((wingOrBlock.startsWith("Building") || wingOrBlock.startsWith("Tower") || wingOrBlock.startsWith("Block"))
                    ? wingOrBlock
                    : `Building ${wingOrBlock}`) : "";
                flatDetails = [prefix, flatDoc.flatNumber ? `Flat ${flatDoc.flatNumber}` : ""].filter(Boolean).join(", ");
            }
        }
    }

    if (!flatDetails) {
        flatDetails = "Flat unassigned";
    }

    // 4. Visitors Today Count for Resident's Flat Only
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    let visitorsTodayCount = 0;
    if (flatId) {
        visitorsTodayCount = await VisitorEntry.countDocuments({
            ...(societyId ? { societyId } : {}),
            flatId,
            createdAt: { $gte: startOfToday, $lte: endOfToday }
        });
    } else if (userId) {
        visitorsTodayCount = await VisitorEntry.countDocuments({
            ...(societyId ? { societyId } : {}),
            $or: [{ approvedBy: userId }, { hostUserId: userId }],
            createdAt: { $gte: startOfToday, $lte: endOfToday }
        });
    }

    // 5. Maintenance Bills & Dues for Resident's Flat Only
    let totalDuesAmount = 0;
    let unpaidBillsCount = 0;

    if (flatId) {
        const duesQuery = {
            ...(societyId ? { societyId } : {}),
            flatId,
            paymentStatus: { $in: ["UNPAID", "PARTIALLY_PAID", "OVERDUE", "unpaid", "pending"] }
        };
        const pendingBills = await MaintenanceBill.find(duesQuery).lean();
        unpaidBillsCount = pendingBills.length;
        totalDuesAmount = pendingBills.reduce((acc, bill) => acc + (bill.amount || 0), 0);
    }

    // 6. Security Status
    const societyFilter = societyId ? { societyId } : {};
    const securityStaffCount = await Staff.countDocuments({ ...societyFilter, role: { $regex: /security|guard/i } });
    const securityStatus = securityStaffCount > 0 ? "Active" : "Active";

    // 7. Notices Count & Important Updates
    const activeNotices = await Notice.find({ ...societyFilter, isActive: true })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

    const noticesCount = activeNotices.length;

    const importantUpdates = activeNotices.map((n, idx) => ({
        id: n._id || idx,
        title: n.title,
        desc: n.description || n.content || "",
        date: new Date(n.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
        type: n.type || "general"
    }));

    // 8. Upcoming Event
    let upcomingEvent = null;
    const festivalEvent = await FestivalCollection.findOne({ ...societyFilter, status: { $ne: "CLOSED" } })
        .sort({ createdAt: -1 })
        .lean();

    if (festivalEvent) {
        const festDate = festivalEvent.targetDate || festivalEvent.createdAt || new Date();
        const d = new Date(festDate);
        upcomingEvent = {
            id: festivalEvent._id,
            month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
            day: d.getDate(),
            dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
            title: festivalEvent.title || festivalEvent.name || "Community Event",
            location: festivalEvent.venue || "Community Hall",
            time: festivalEvent.time || "Event Day",
            icon: "🎉"
        };
    } else {
        const eventNotice = activeNotices.find(n => n.type === "event");
        if (eventNotice) {
            const d = new Date(eventNotice.createdAt);
            upcomingEvent = {
                id: eventNotice._id,
                month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
                day: d.getDate(),
                dayName: d.toLocaleDateString("en-US", { weekday: "short" }),
                title: eventNotice.title,
                location: "Society Premises",
                time: "As per notice",
                icon: "🎉"
            };
        }
    }

    return {
        userInfo: {
            userName,
            societyName,
            flatDetails,
            weather: { temp: "28°C", condition: "Partly Cloudy" }
        },
        metrics: {
            visitors: { value: String(visitorsTodayCount), label: "Visitors", subtext: "Today" },
            cleaning: { value: "85%", label: "Cleaning", subtext: "Completed" },
            security: { value: securityStatus, label: "Security", subtext: "Active" },
            notices: { value: String(noticesCount), label: "Notices", subtext: "New" },
            dues: { value: `₹${totalDuesAmount.toLocaleString("en-IN")}`, label: "Dues", subtext: "View", unpaidCount: unpaidBillsCount }
        },
        quickActions: {
            unpaidBillsCount
        },
        importantUpdates,
        upcomingEvent
    };
};


module.exports = {
    getAdminDashboardStats,
    getResidentDashboardStats
};

