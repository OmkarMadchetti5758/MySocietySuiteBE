"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { connectOperationsDB, getOperationsConnection } = require("../config/operationsDb");
const { ROLES } = require("../common/constants");

const ALLOWED_ROLES = Object.values(ROLES);

const KNOWLEDGE_BASE_ENTRIES = [
    {
        category: "application_overview",
        topic: "mysociety_suite",
        title: "What is MySocietySuite?",
        content: {
            en: "MySocietySuite is a multi-tenant society management application. It helps residential societies manage residents, flats, visitors, parking, complaints, staff, amenities, communication, billing, payments, accounts, and community activities.",
            hi: "MySocietySuite एक मल्टी-टेनेंट सोसाइटी मैनेजमेंट एप्लिकेशन है। यह आवासीय सोसाइटियों को निवासी, फ्लैट, आगंतुक, पार्किंग, शिकायत, स्टाफ, सुविधाएं, संचार, बिलिंग, भुगतान, खाते और सामुदायिक गतिविधियां प्रबंधित करने में मदद करता है।",
            mr: "MySocietySuite हे मल्टी-टेनंट सोसायटी मॅनेजमेंट अॅप्लिकेशन आहे. हे निवासी सोसायट्यांना रहिवासी, फ्लॅट, अभ्यागत, पार्किंग, तक्रारी, कर्मचारी, सुविधा, संवाद, बिलिंग, पेमेंट, खाती आणि सामुदायिक उपक्रम व्यवस्थापित करण्यास मदत करते.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["MySocietySuite", "society management", "residential society", "application"],
        status: "active",
    },
    {
        category: "modules",
        topic: "available_modules",
        title: "Available MySocietySuite Modules",
        content: {
            en: "The application includes society and flat setup, residents, visitors, parking, complaints and helpdesk, amenities and bookings, vendors, staff and attendance, notices, polls, festivals, documents, billing, payments, reconciliation, reports, settings, and an AI Assistant entry in the dashboard.",
            hi: "एप्लिकेशन में सोसाइटी और फ्लैट सेटअप, निवासी, आगंतुक, पार्किंग, शिकायत और हेल्पडेस्क, सुविधाएं और बुकिंग, वेंडर, स्टाफ और उपस्थिति, नोटिस, पोल, त्योहार, दस्तावेज, बिलिंग, भुगतान, रिकन्सिलिएशन, रिपोर्ट, सेटिंग्स और डैशबोर्ड में AI Assistant एंट्री शामिल हैं।",
            mr: "अॅप्लिकेशनमध्ये सोसायटी आणि फ्लॅट सेटअप, रहिवासी, अभ्यागत, पार्किंग, तक्रारी आणि हेल्पडेस्क, सुविधा आणि बुकिंग, विक्रेते, कर्मचारी आणि उपस्थिती, नोटिस, मतदान, सण, कागदपत्रे, बिलिंग, पेमेंट, रिकन्सिलिएशन, रिपोर्ट, सेटिंग्ज आणि डॅशबोर्डमधील AI Assistant एंट्री समाविष्ट आहे.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["modules", "features", "dashboard", "application features"],
        status: "active",
    },
    {
        category: "roles_permissions",
        topic: "permission_levels",
        title: "Roles and Permission Levels",
        content: {
            en: "MySocietySuite uses roles and module permissions. Permission levels are NO_ACCESS, VIEW, MANAGE, and FULL. Permissions can also have scopes such as society, own, assigned, financial, facility, platform, or restricted. The backend remains the authority for access decisions.",
            hi: "MySocietySuite में भूमिकाओं और मॉड्यूल अनुमतियों का उपयोग होता है। अनुमति स्तर NO_ACCESS, VIEW, MANAGE और FULL हैं। अनुमतियों का स्कोप society, own, assigned, financial, facility, platform या restricted हो सकता है। एक्सेस के निर्णय के लिए बैकएंड अंतिम प्राधिकरण है।",
            mr: "MySocietySuite मध्ये भूमिका आणि मॉड्यूल परवानग्या वापरल्या जातात. परवानगी स्तर NO_ACCESS, VIEW, MANAGE आणि FULL आहेत. परवानग्यांना society, own, assigned, financial, facility, platform किंवा restricted असे स्कोप असू शकतात. प्रवेशाच्या निर्णयांसाठी बॅकएंड अंतिम प्राधिकरण आहे.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["roles", "permissions", "VIEW", "MANAGE", "FULL", "access"],
        status: "active",
    },
    {
        category: "visitors",
        topic: "visitor_management",
        title: "Visitor Management",
        content: {
            en: "Guards can register walk-in visitors. The entry starts as pending, and residents of the target flat can approve it. Approval changes the entry to checked_in. The system also supports visitor history, QR passes, QR scanning, pass expiry, pass revocation, and one-time pass reuse prevention.",
            hi: "गार्ड वॉक-इन आगंतुकों का पंजीकरण कर सकते हैं। एंट्री pending स्थिति से शुरू होती है और लक्षित फ्लैट के निवासी इसे मंजूर कर सकते हैं। मंजूरी के बाद एंट्री checked_in हो जाती है। सिस्टम आगंतुक इतिहास, QR पास, QR स्कैनिंग, पास समाप्ति, पास रद्द करना और वन-टाइम पास के दोबारा उपयोग को रोकना भी सपोर्ट करता है।",
            mr: "गार्ड वॉक-इन अभ्यागतांची नोंद करू शकतात. एंट्री pending स्थितीत सुरू होते आणि लक्ष्य फ्लॅटचे रहिवासी ती मंजूर करू शकतात. मंजुरीनंतर एंट्री checked_in होते. सिस्टम अभ्यागत इतिहास, QR पास, QR स्कॅनिंग, पासची मुदत संपणे, पास रद्द करणे आणि एकदाच वापरता येणाऱ्या पासचा पुन्हा वापर रोखणे यांना देखील सपोर्ट करते.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["visitor", "guest", "walk-in", "visitor approval", "QR pass"],
        status: "active",
    },
    {
        category: "parking",
        topic: "parking_management",
        title: "Parking Management",
        content: {
            en: "Parking supports slot management, vehicle records, resident parking requests, approvals, assignments, visitor parking, and violations. Slot states include available, allocated, reserved, maintenance, and inactive. A slot or vehicle with an active assignment cannot be deactivated.",
            hi: "पार्किंग मॉड्यूल स्लॉट प्रबंधन, वाहन रिकॉर्ड, निवासी पार्किंग अनुरोध, मंजूरी, आवंटन, विजिटर पार्किंग और उल्लंघनों को सपोर्ट करता है। स्लॉट की स्थितियां available, allocated, reserved, maintenance और inactive हैं। सक्रिय आवंटन वाले स्लॉट या वाहन को निष्क्रिय नहीं किया जा सकता।",
            mr: "पार्किंग मॉड्यूल स्लॉट व्यवस्थापन, वाहन नोंदी, रहिवासी पार्किंग विनंत्या, मंजुरी, वाटप, अभ्यागत पार्किंग आणि उल्लंघने यांना सपोर्ट करते. स्लॉटच्या स्थिती available, allocated, reserved, maintenance आणि inactive आहेत. सक्रिय वाटप असलेला स्लॉट किंवा वाहन निष्क्रिय करता येत नाही.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["parking", "parking slot", "vehicle", "parking request", "parking violation"],
        status: "active",
    },
    {
        category: "complaints",
        topic: "complaint_workflow",
        title: "Complaints and Helpdesk",
        content: {
            en: "Complaints follow the status flow open, in_progress, resolved, and closed. Residents can raise complaints for their flat context. Complaints can be assigned to staff or vendors, and history is recorded. Residents confirm resolution before closure and may reopen resolved complaints. Default SLA windows are 72 hours for Low, 48 hours for Medium, 24 hours for High, and 8 hours for Urgent priority.",
            hi: "शिकायतों का स्टेटस फ्लो open, in_progress, resolved और closed होता है। निवासी अपने फ्लैट के संदर्भ में शिकायत दर्ज कर सकते हैं। शिकायतें स्टाफ या वेंडर को सौंपी जा सकती हैं और उनका इतिहास दर्ज होता है। बंद करने से पहले निवासी समाधान की पुष्टि करते हैं और resolved शिकायतों को फिर से खोल सकते हैं। डिफॉल्ट SLA Low के लिए 72 घंटे, Medium के लिए 48 घंटे, High के लिए 24 घंटे और Urgent के लिए 8 घंटे हैं।",
            mr: "तक्रारींचा स्टेटस फ्लो open, in_progress, resolved आणि closed असा असतो. रहिवासी त्यांच्या फ्लॅटच्या संदर्भात तक्रार नोंदवू शकतात. तक्रारी कर्मचारी किंवा विक्रेत्यांना सोपवता येतात आणि त्यांचा इतिहास नोंदवला जातो. बंद करण्यापूर्वी रहिवासी निराकरणाची पुष्टी करतात आणि resolved तक्रारी पुन्हा उघडू शकतात. डीफॉल्ट SLA Low साठी 72 तास, Medium साठी 48 तास, High साठी 24 तास आणि Urgent साठी 8 तास आहेत.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["complaint", "helpdesk", "ticket", "SLA", "open", "resolved", "reopen"],
        status: "active",
    },
    {
        category: "amenities",
        topic: "amenity_booking",
        title: "Amenity Booking",
        content: {
            en: "Amenities have active slots and availability rules. Bookings cannot be made for past dates, inactive amenities, or inactive slots. Same-day booking is blocked after the slot start time. Some amenities require approval. Conflicting pending or confirmed bookings for the same slot and date are not allowed.",
            hi: "सुविधाओं में सक्रिय स्लॉट और उपलब्धता नियम होते हैं। पिछली तारीख, निष्क्रिय सुविधा या निष्क्रिय स्लॉट के लिए बुकिंग नहीं की जा सकती। स्लॉट शुरू होने के बाद उसी दिन की बुकिंग रोक दी जाती है। कुछ सुविधाओं के लिए मंजूरी आवश्यक होती है। एक ही स्लॉट और तारीख की विरोधी pending या confirmed बुकिंग स्वीकार नहीं होती।",
            mr: "सुविधांमध्ये सक्रिय स्लॉट आणि उपलब्धता नियम असतात. मागील तारखेसाठी, निष्क्रिय सुविधा किंवा निष्क्रिय स्लॉटसाठी बुकिंग करता येत नाही. स्लॉट सुरू झाल्यानंतर त्याच दिवशीची बुकिंग रोखली जाते. काही सुविधांसाठी मंजुरी आवश्यक असते. त्याच स्लॉट आणि तारखेसाठी परस्परविरोधी pending किंवा confirmed बुकिंग स्वीकारली जात नाही.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["amenity", "booking", "facility", "slot", "availability"],
        status: "active",
    },
    {
        category: "billing",
        topic: "billing_and_invoices",
        title: "Billing and Invoices",
        content: {
            en: "Billing supports fixed and per-square-foot charge heads, GST, monthly and quarterly billing, invoice generation, one-time charges, arrears, discounts, credit notes, payments, and dunning. New or changed charge heads require approval, and self-approval is not allowed. Per-square-foot charges use the flat area.",
            hi: "बिलिंग में fixed और per-square-foot charge heads, GST, monthly और quarterly billing, invoice generation, one-time charges, बकाया, discounts, credit notes, payments और dunning शामिल हैं। नए या बदले हुए charge heads के लिए मंजूरी आवश्यक है और self-approval की अनुमति नहीं है। per-square-foot charges में फ्लैट का क्षेत्रफल उपयोग होता है।",
            mr: "बिलिंगमध्ये fixed आणि per-square-foot charge heads, GST, monthly आणि quarterly billing, invoice generation, one-time charges, थकबाकी, discounts, credit notes, payments आणि dunning यांचा समावेश आहे. नवीन किंवा बदललेल्या charge heads साठी मंजुरी आवश्यक आहे आणि self-approval ला परवानगी नाही. per-square-foot charges साठी फ्लॅटचे क्षेत्रफळ वापरले जाते.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["billing", "invoice", "charge head", "GST", "arrears", "dunning"],
        status: "active",
    },
    {
        category: "vendors",
        topic: "vendor_management",
        title: "Vendor Management",
        content: {
            en: "Vendor management supports vendor records, task assignment, reassignment, assignment history, and vendor task updates. A vendor must be active to receive an assignment. Reassignment is blocked for closed or rejected tasks, and assigning the same vendor again is rejected.",
            hi: "वेंडर प्रबंधन में वेंडर रिकॉर्ड, टास्क असाइनमेंट, री-असाइनमेंट, असाइनमेंट इतिहास और वेंडर टास्क अपडेट शामिल हैं। असाइनमेंट पाने के लिए वेंडर active होना चाहिए। closed या rejected टास्क का री-असाइनमेंट रोक दिया जाता है और उसी वेंडर को दोबारा असाइन करना अस्वीकार होता है।",
            mr: "विक्रेता व्यवस्थापनामध्ये विक्रेता नोंदी, टास्क असाइनमेंट, री-असाइनमेंट, असाइनमेंट इतिहास आणि विक्रेता टास्क अपडेट यांचा समावेश आहे. असाइनमेंट मिळण्यासाठी विक्रेता active असणे आवश्यक आहे. closed किंवा rejected टास्कचे री-असाइनमेंट रोखले जाते आणि त्याच विक्रेत्याला पुन्हा असाइन करणे नाकारले जाते.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["vendor", "service provider", "vendor task", "assignment", "reassignment"],
        status: "active",
    },
    {
        category: "staff_attendance",
        topic: "staff_and_attendance",
        title: "Staff and Attendance",
        content: {
            en: "Staff management stores staff records, designations, active status, gate information, and shift information. Attendance supports daily marking, summaries, and monthly reports. Attendance statuses include present, absent, half-day, and on-leave.",
            hi: "स्टाफ प्रबंधन में स्टाफ रिकॉर्ड, designation, active status, गेट जानकारी और शिफ्ट जानकारी रखी जाती है। उपस्थिति मॉड्यूल दैनिक marking, summaries और monthly reports सपोर्ट करता है। उपस्थिति स्थितियां present, absent, half-day और on-leave हैं।",
            mr: "कर्मचारी व्यवस्थापनामध्ये कर्मचारी नोंदी, designation, active status, गेटची माहिती आणि शिफ्टची माहिती ठेवली जाते. उपस्थिती मॉड्यूल दैनिक marking, summaries आणि monthly reports ला सपोर्ट करते. उपस्थितीच्या स्थिती present, absent, half-day आणि on-leave आहेत.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["staff", "attendance", "shift", "gate", "monthly report"],
        status: "active",
    },
    {
        category: "notices_polls",
        topic: "notices_and_polls",
        title: "Notices and Polls",
        content: {
            en: "The Notice module supports society notices, announcements, attachments, creation, editing, and deletion. The Poll module supports poll creation, voting, result viewing, and poll closure. Notices and polls can be targeted according to the configured application workflow.",
            hi: "Notice मॉड्यूल सोसाइटी नोटिस, घोषणाएं, attachments, creation, editing और deletion सपोर्ट करता है। Poll मॉड्यूल poll creation, voting, results देखने और poll closure सपोर्ट करता है। नोटिस और पोल को एप्लिकेशन के configured workflow के अनुसार target किया जा सकता है।",
            mr: "Notice मॉड्यूल सोसायटी नोटिस, घोषणा, attachments, creation, editing आणि deletion ला सपोर्ट करते. Poll मॉड्यूल poll creation, voting, निकाल पाहणे आणि poll closure ला सपोर्ट करते. नोटिस आणि पोल अॅप्लिकेशनच्या configured workflow नुसार target करता येतात.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["notice", "announcement", "poll", "vote", "poll results"],
        status: "active",
    },
    {
        category: "documents",
        topic: "document_management",
        title: "Document Management",
        content: {
            en: "The Documents area supports document search, category filtering, upload, metadata and file editing, deletion, and pagination. Document categories include minutes, circulars, compliance, financial, agreements, NOCs, audit reports, and other documents.",
            hi: "Documents क्षेत्र में document search, category filtering, upload, metadata और file editing, deletion और pagination सपोर्ट होते हैं। दस्तावेज श्रेणियों में minutes, circulars, compliance, financial, agreements, NOCs, audit reports और other documents शामिल हैं।",
            mr: "Documents विभागात document search, category filtering, upload, metadata आणि file editing, deletion आणि pagination यांना सपोर्ट आहे. दस्तऐवजांच्या श्रेणींमध्ये minutes, circulars, compliance, financial, agreements, NOCs, audit reports आणि other documents समाविष्ट आहेत.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["documents", "document upload", "circular", "compliance", "NOC", "audit report"],
        status: "active",
    },
    {
        category: "festivals",
        topic: "festivals_and_events",
        title: "Festivals and Community Events",
        content: {
            en: "The Festivals module supports creating and editing events, searching and filtering events, viewing event details and media, and managing draft, published, cancelled, and completed states. Events can be published, unpublished, cancelled, or deleted according to permissions.",
            hi: "Festivals मॉड्यूल events बनाना और edit करना, events search और filter करना, event details और media देखना तथा draft, published, cancelled और completed states प्रबंधित करना सपोर्ट करता है। अनुमतियों के अनुसार events को publish, unpublish, cancel या delete किया जा सकता है।",
            mr: "Festivals मॉड्यूल events तयार करणे आणि edit करणे, events search आणि filter करणे, event details आणि media पाहणे तसेच draft, published, cancelled आणि completed states व्यवस्थापित करणे यांना सपोर्ट करते. परवानग्यांनुसार events publish, unpublish, cancel किंवा delete करता येतात.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["festival", "event", "community event", "published", "cancelled"],
        status: "active",
    },
    {
        category: "reconciliation",
        topic: "financial_reconciliation",
        title: "Bank and Cash Reconciliation",
        content: {
            en: "Reconciliation supports financial account management, account transactions, bank statement import, bank transaction retrieval, manual matching, account transfers, adjustments, cash counts, reconciliation history, and finalization.",
            hi: "Reconciliation मॉड्यूल financial account management, account transactions, bank statement import, bank transaction retrieval, manual matching, account transfers, adjustments, cash counts, reconciliation history और finalization सपोर्ट करता है।",
            mr: "Reconciliation मॉड्यूल financial account management, account transactions, bank statement import, bank transaction retrieval, manual matching, account transfers, adjustments, cash counts, reconciliation history आणि finalization यांना सपोर्ट करते.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["reconciliation", "bank statement", "account transaction", "cash count", "matching"],
        status: "active",
    },
    {
        category: "help_faq",
        topic: "static_and_live_information",
        title: "Static Knowledge and Live Society Information",
        content: {
            en: "The Knowledge Base contains general product information, features, roles, workflows, and business rules. Personal records, current bills, payments, visitors, complaints, residents, bookings, and other society-specific information must come from authenticated live application data and must follow the user's permissions.",
            hi: "Knowledge Base में सामान्य product information, features, roles, workflows और business rules होते हैं। व्यक्तिगत रिकॉर्ड, वर्तमान bills, payments, visitors, complaints, residents, bookings और अन्य society-specific information authenticated live application data से आनी चाहिए और user की permissions का पालन करना चाहिए।",
            mr: "Knowledge Base मध्ये सामान्य product information, features, roles, workflows आणि business rules असतात. वैयक्तिक नोंदी, सध्याची bills, payments, visitors, complaints, residents, bookings आणि इतर society-specific माहिती authenticated live application data मधून यायला हवी आणि user च्या permissions चे पालन करायला हवे.",
        },
        allowedRoles: ALLOWED_ROLES,
        keywords: ["FAQ", "knowledge base", "live data", "static information", "permissions", "privacy"],
        status: "active",
    },
];

async function seedAIKnowledgeBase() {
    await connectOperationsDB();

    const operationsDb = getOperationsConnection();
    const KnowledgeBase = operationsDb.model("AIKnowledgeBase");
    let createdCount = 0;
    let updatedCount = 0;

    for (const entry of KNOWLEDGE_BASE_ENTRIES) {
        const result = await KnowledgeBase.updateOne(
            { category: entry.category, topic: entry.topic },
            { $set: entry },
            { upsert: true }
        );

        if (result.upsertedCount > 0) {
            createdCount += 1;
        } else if (result.matchedCount > 0) {
            updatedCount += 1;
        }
    }

    console.log(`[SEED] AI Knowledge Base completed. Created: ${createdCount}, updated: ${updatedCount}.`);
    return { createdCount, updatedCount, total: KNOWLEDGE_BASE_ENTRIES.length };
}

module.exports = { KNOWLEDGE_BASE_ENTRIES, seedAIKnowledgeBase };

if (require.main === module) {
    (async () => {
        try {
            await seedAIKnowledgeBase();
            await getOperationsConnection().close();
            process.exit(0);
        } catch (error) {
            console.error("[SEED ERROR] AI Knowledge Base:", error);
            process.exit(1);
        }
    })();
}
