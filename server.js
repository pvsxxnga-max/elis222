const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer'); // สำหรับการส่งอีเมลแบบเรียลไทม์เมื่อเปลี่ยนสถานะ
const app = express();

app.use(express.json());
app.use(cors());

// ฐานข้อมูลในหน่วยความจำชั่วคราว (In-Memory Repository Design)
let loanProducts = [
    {
        id: "LIS-2026-001",
        name: "สินเชื่อเพื่อการประกอบอาชีพรุ่นใหม่ 2026",
        amount: 500000,
        description: "สินเชื่อสนับสนุนผู้ประกอบการ SME ยุคใหม่",
        criteria: "อายุ 20-35 ปี",
        startTime: new Date("2026-01-01T00:00:00Z"),
        endTime: new Date("2026-12-31T23:59:59Z"),
        requireGps: true,
        customFields: [{ title: "แนบรูปสลิปเงินเดือน", type: "image" }]
    }
];

let loanSubmissions = [];

// ฟังก์ชันจำลองการทำงานส่งเมลแจ้งเตือนแบบเรียลไทม์
async function sendRealtimeEmailNotification(userEmail, loanName, currentStep, remark) {
    console.log(`[SMTP Mail Client Dispatcher] ส่งข้อมูลสถานะเรียบร้อยถึง: ${userEmail}`);
    console.log(`[Content] รายงานความคืบหน้าสินเชื่อ ${loanName}: อยู่ในสถานะขั้นตอนที่ ${currentStep} | หมายเหตุ: ${remark}`);
    // การทำงานเชิงปฏิบัติจริง:
    // let transporter = nodemailer.createTransport({...});
    // await transporter.sendMail({ from: '"e-LIS System" <noreply@elis.go.th>', to: userEmail, ... });
}

// ----------------------------------------------------
// 1. ROUTE สำหรับผู้ขอสินเชื่อ (BORROWER CONTROLLER)
// ----------------------------------------------------

// ดึงรายการสินเชื่อไปแสดงผลบนหน้าจอพร้อมจัดการเงื่อนไขเวลา
app.get('/api/loans', (req, res) => {
    const now = new Date();
    
    // กรองและแปรสภาพข้อมูลสำหรับส่งให้หน้าบ้านใช้งาน
    const ActiveLoans = loanProducts.filter(loan => {
        const endTime = new Date(loan.endTime);
        const timeDifferenceInHours = (now - endTime) / (1000 * 60 * 60);
        
        // กฎระเบียบข้อที่ 7: สินเชื่อจะไม่หายไปทันทีเมื่อหมดเวลา แต่จะคงค้างให้เห็นแบบกดปุ่มไม่ได้ และหายไปสมบูรณ์ใน 24 ชม.
        return timeDifferenceInHours <= 24;
    }).map(loan => {
        const startTime = new Date(loan.startTime);
        const endTime = new Date(loan.endTime);
        
        let availabilityStatus = 'AVAILABLE';
        if (now < startTime) {
            availabilityStatus = 'EARLY'; // ยังไม่ถึงระยะเวลา
        } else if (now > endTime) {
            availabilityStatus = 'EXPIRED'; // หมดเขตการยื่นสินเชื่อ
        }

        return {
            ...loan,
            availabilityStatus
        };
    });

    res.json({ success: true, data: ActiveLoans });
});

// ยื่นคำขอรับสินเชื่อทางการเงิน (ยื่นฟอร์ม)
app.post('/api/submissions/apply', (req, res) => {
    const { loanId, applicantName, applicantEmail, gpsPosition, customFieldAnswers } = req.body;
    
    // ค้นหาสินเชื่อหลักเพื่อตรวจทานเกณฑ์ความปลอดภัย
    const targetLoan = loanProducts.find(l => l.id === loanId);
    if (!targetLoan) {
        return res.status(440).json({ success: false, message: "ไม่พบข้อมูลประเภทสินเชื่อที่ระบุในคลัง e-LIS" });
    }

    // ตรวจสอบความปลอดภัยระดับ Back-end Gate (หากสินเชื่อบังคับใช้พิกัดตำแหน่งทางภูมิศาสตร์)
    if (targetLoan.requireGps && (!gpsPosition || gpsPosition === '')) {
        return res.status(400).json({ success: false, message: "การทำธุรกรรมถูกระงับเนื่องจากตรวจไม่พบพิกัดตำแหน่งสิทธิ์ความปลอดภัยในอุปกรณ์" });
    }

    const reviewDeadlineDate = new Date();
    reviewDeadlineDate.setDate(reviewDeadlineDate.getDate() + 7); // กำหนดส่งงานพิจารณาภายใน 7 วัน

    const newSubmission = {
        id: "SUB-" + Date.now().toString().slice(-6),
        loanId: targetLoan.id,
        loanName: targetLoan.name,
        applicantName,
        applicantEmail,
        gpsPosition,
        customFieldAnswers,
        appliedDate: new Date(),
        statusStep: 1, // 1: ส่งคำขอพิจารณาแล้ว
        reviewDeadline: reviewDeadlineDate,
        statusMove: true, // ค่าสถานะการเคลื่อนไหวของงานปกติ
        remark: "ได้รับชุดเอกสารเข้าระบบข้อมูลสินเชื่อดิจิทัลเรียบร้อยแล้ว"
    };

    loanSubmissions.push(newSubmission);
    
    // ส่งอีเมลเรียลไทม์ทันทีเมื่อยื่นคำขอรับสิทธิ์
    sendRealtimeEmailNotification(applicantEmail, targetLoan.name, 1, newSubmission.remark);

    res.status(201).json({ success: true, message: "นำส่งแบบคำขอเข้าฐานข้อมูลพิจารณาเรียบร้อย", data: newSubmission });
});


// ----------------------------------------------------
// 2. ROUTE สำหรับงานบริหารระบบเจ้าหน้าที่ (STAFF OPERATIONS CONTROLLER)
// ----------------------------------------------------

// เพิ่มรายการสินเชื่อใหม่เข้าระบบสารสนเทศ
app.post('/api/staff/loans/create', (req, res) => {
    const { name, configuredCode, amount, description, criteria, startTime, endTime, requireGps, customFields } = req.body;

    // รันรหัสอัตโนมัติในกรณีไม่มีการตั้งค่าแต่งเติมเข้ามาจากเจ้าหน้าที่
    let finalCode = configuredCode;
    if(!finalCode) {
        const currentCount = loanProducts.length + 1;
        finalCode = `LIS-2026-${String(currentCount).padStart(3, '0')}`;
    }

    const newLoanProduct = {
        id: finalCode,
        name,
        amount: parseFloat(amount),
        description,
        criteria,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        requireGps: requireGps || false,
        customFields: customFields || [] // สคีมาฟอร์มเพิ่มเติม
    };

    loanProducts.push(newLoanProduct);
    res.status(201).json({ success: true, message: "บันทึกและประกาศใช้โครงสร้างสินเชื่อสำเร็จ", data: newLoanProduct });
});

// เจ้าหน้าที่ปรับปรุงความคืบหน้าคำขอสินเชื่อและบันทึกหมายเหตุสถานะ
app.put('/api/staff/submissions/update-status', (req, res) => {
    const { submissionId, nextStep, isStatusMoving, staffRemark } = req.body;

    const submission = loanSubmissions.find(s => s.id === submissionId);
    if (!submission) {
        return res.status(404).json({ success: false, message: "ไม่พบคำขอเงินกู้ที่ระบุในตารางจัดลำดับงานพิจารณา" });
    }

    // กำหนดค่าการทำงานให้กับเอกสารคำขอ
    submission.statusStep = parseInt(nextStep);
    submission.statusMove = isStatusMoving !== undefined ? isStatusMoving : true;
    submission.remark = staffRemark || "อยู่ระหว่างขั้นตอนการดำเนินการพิจารณาประวัติเครดิตบูโรแห่งชาติ";

    // จัดยิงส่งอีเมลอัปเดตแบบเรียลไทม์ส่งตรงไปยังบัญชีผู้กู้ทันที
    sendRealtimeEmailNotification(submission.applicantEmail, submission.loanName, submission.statusStep, submission.remark);

    res.json({
        success: true,
        message: "ระบบปรับปรุงขั้นตอนการดำเนินงานสำเร็จ พร้อมกระจายอีเมลเรียลไทม์แล้ว",
        data: submission
    });
});

// รันและผูกพอร์ตระบบเซิร์ฟเวอร์หลักของเครือข่าย e-LIS
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`e-Lending Information System Server กำลังทำงานที่พอร์ตเครือข่ายความปลอดภัยหลัก หมายเลข : ${PORT}`);
});
