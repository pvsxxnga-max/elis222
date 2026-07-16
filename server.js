const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ฐานข้อมูล Mock ใน Memory
let loanProducts = [
    {
        id: "LIS-2026-001",
        name: "สินเชื่อธุรกิจ SME รุ่นใหม่ 2026",
        amount: 500000,
        description: "สินเชื่อสนับสนุนผู้ประกอบการ SME ยุคใหม่",
        criteria: "อายุ 20-35 ปี",
        startTime: new Date("2026-01-01T00:00:00Z"),
        endTime: new Date("2026-12-31T23:59:59Z"),
        requireGps: true,
        // เก็บโครงสร้าง JSON Schema (Form Builder) ของฝั่งเจ้าหน้าที่
        customFields: [
            { fieldId: "f_1", type: "text", title: "ชื่อธุรกิจ", required: true, options: [] },
            { fieldId: "f_2", type: "dropdown", title: "ประเภทธุรกิจ", required: true, options: [{label:"ค้าขาย", value:"ค้าขาย"}] }
        ]
    }
];

let loanSubmissions = [];

// ฟังก์ชันจำลองส่งอีเมลเรียลไทม์ (Real-time Email Event)
async function sendEmailNotification(email, loanName, step, remark) {
    console.log(`[SMTP Mail] ส่งอีเมลแจ้งเตือนลูกค้า ${email} | ขั้นที่ ${step} | หมายเหตุ: ${remark}`);
}

// ---------------------------------------------------------
// 1. API: ดึงข้อมูลสินเชื่อทั้งหมด (ฝั่งผู้กู้)
// ---------------------------------------------------------
app.get('/api/loans', (req, res) => {
    const now = new Date();
    // กรองและส่งกลับเฉพาะสินเชื่อที่หมดอายุไม่เกิน 24 ชั่วโมง
    const activeLoans = loanProducts.filter(loan => {
        const timeDiff = (now - new Date(loan.endTime)) / 3600000;
        return timeDiff <= 24; 
    });
    res.json({ success: true, data: activeLoans });
});

// ---------------------------------------------------------
// 2. API: ผู้กู้ส่งฟอร์มคำขอสินเชื่อ (รับค่า Dynamic Form)
// ---------------------------------------------------------
app.post('/api/submissions/apply', (req, res) => {
    const { loanId, applicantName, applicantEmail, gpsPosition, customFieldAnswers } = req.body;
    
    const targetLoan = loanProducts.find(l => l.id === loanId);
    if (!targetLoan) return res.status(404).json({ success: false, message: "ไม่พบสินเชื่อ" });

    // Gate Check: บังคับพิกัด GPS
    if (targetLoan.requireGps && !gpsPosition) {
        return res.status(400).json({ success: false, message: "ต้องระบุพิกัด GPS" });
    }

    const reviewDeadline = new Date();
    reviewDeadline.setDate(reviewDeadline.getDate() + 7);

    const newSubmission = {
        id: "SUB-" + Date.now().toString().slice(-6),
        loanId: targetLoan.id,
        loanName: targetLoan.name,
        applicantName,
        applicantEmail,
        gpsPosition,
        customFieldAnswers, // อาร์เรย์เก็บคำตอบของฟอร์มไดนามิก
        appliedDate: new Date(),
        statusStep: 1,
        reviewDeadline: reviewDeadline,
        statusMove: true,
        remark: "ได้รับคำขอและเอกสารดิจิทัลเข้าระบบเรียบร้อย"
    };

    loanSubmissions.push(newSubmission);
    sendEmailNotification(applicantEmail, targetLoan.name, 1, newSubmission.remark);

    res.status(201).json({ success: true, message: "ส่งคำขอสำเร็จ", data: newSubmission });
});

// ---------------------------------------------------------
// 3. API: เจ้าหน้าที่สร้างสินเชื่อใหม่พร้อมคำถามเสริม
// ---------------------------------------------------------
app.post('/api/staff/loans/create', (req, res) => {
    const { id, name, amount, description, criteria, startTime, endTime, requireGps, customFields } = req.body;

    const newLoan = {
        id: id || `LIS-${Date.now().toString().slice(-4)}`,
        name,
        amount: parseFloat(amount),
        description,
        criteria,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        requireGps: requireGps || false,
        customFields: customFields || [] // จัดเก็บ JSON Schema ลง Database
    };

    loanProducts.push(newLoan);
    res.status(201).json({ success: true, message: "สร้างสินเชื่อสำเร็จ", data: newLoan });
});

// ---------------------------------------------------------
// 4. API: เจ้าหน้าที่อัปเดตสถานะ (แจ้งเตือนเรียลไทม์)
// ---------------------------------------------------------
app.put('/api/staff/submissions/update-status', (req, res) => {
    const { submissionId, nextStep, isStatusMoving, remark } = req.body;

    const submission = loanSubmissions.find(s => s.id === submissionId);
    if (!submission) return res.status(404).json({ success: false, message: "ไม่พบคำขอ" });

    submission.statusStep = parseInt(nextStep);
    submission.statusMove = isStatusMoving;
    submission.remark = remark || "มีการเคลื่อนไหวจากเจ้าหน้าที่";

    sendEmailNotification(submission.applicantEmail, submission.loanName, submission.statusStep, submission.remark);
    res.json({ success: true, message: "อัปเดตสถานะและส่งอีเมลเรียบร้อย" });
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`[e-LIS Backend] รันเซิร์ฟเวอร์สมบูรณ์แบบที่พอร์ต: ${PORT}`);
});
// ในไฟล์ server.js (เพิ่มส่วนตรวจสอบเจ้าหน้าที่)
const STAFF_CREDENTIALS = {
    username: "admin_lis",
    passwordHash: "a665a45920422f9d417e4867efdc4fb8" // ใช้ Hashed Password เสมอ
};

app.post('/api/auth/staff', (req, res) => {
    const { username, password } = req.body;
    
    // ตรวจสอบใน Database แทนการ Hardcode
    if (username === STAFF_CREDENTIALS.username && hash(password) === STAFF_CREDENTIALS.passwordHash) {
        res.json({ success: true, token: "eyJhbGciOiJIUzI1Ni..." });
    } else {
        res.status(401).json({ success: false, message: "รหัสเจ้าหน้าที่หรือรหัสผ่านไม่ถูกต้อง" });
    }
});
