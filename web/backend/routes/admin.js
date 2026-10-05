const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const requireAdmin = require("../middleware/require-admin");
const { isRecord, positiveId: recordId } = require("../services/validators");
const { getDatabase } = require("../database/database");
const { authenticateAdmin, createAdminSession, deleteAdminSession } = require("../services/admin-auth-service");
const { safeStudent } = require("../services/student-service");
const { safeScholarship } = require("../services/eligibility-service");
const { deadlineDetails, safeDocument } = require("../services/application-service");

const router = express.Router();
const STATUSES = ["Pending", "Approved", "Rejected"];
const TEXT_LIMITS = {
    name: 149,
    provider: 99,
    description: 499,
    deadline: 19,
    eligible_course: 99,
    eligible_category: 29,
    eligible_state: 59,
    eligible_gender: 19,
    disability_required: 9,
    category: 39
};
const REQUIRED_FIELDS = Object.keys(TEXT_LIMITS);
const NUMERIC_FIELDS = ["amount", "minimum_income", "minimum_cgpa"];
const SCHOLARSHIP_FIELDS = [...REQUIRED_FIELDS, ...NUMERIC_FIELDS];
const BACKUP_DIRECTORY = process.env.SCHOLARSYNC_BACKUP_DIR || path.join(__dirname, "..", "database", "backups");

function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateScholarship(body, { partial = false } = {}) {
    const errors = {};
    const fields = {};
    const unknown = Object.keys(body).filter((key) => !SCHOLARSHIP_FIELDS.includes(key));
    if (unknown.length) errors.fields = `Unsupported scholarship field(s): ${unknown.join(", ")}.`;
    for (const field of REQUIRED_FIELDS) {
        if (!Object.hasOwn(body, field)) {
            if (!partial) errors[field] = "This field is required.";
            continue;
        }
        if (typeof body[field] !== "string") {
            errors[field] = "This field must be text.";
            continue;
        }
        const value = body[field].trim();
        if (Buffer.byteLength(value, "utf8") > TEXT_LIMITS[field]) {
            errors[field] = `Must be at most ${TEXT_LIMITS[field]} bytes.`;
        }
        if (value.includes("|")) errors[field] = "The | character is not allowed.";
        if (["name", "provider", "description", "category"].includes(field) && !value) {
            errors[field] = "This field cannot be blank.";
        }
        const unrestrictedFields = ["eligible_course", "eligible_category", "eligible_state", "eligible_gender", "disability_required"];
        fields[field] = unrestrictedFields.includes(field) && value === "" ? "Any" : value;
    }
    for (const field of NUMERIC_FIELDS) {
        if (!Object.hasOwn(body, field)) {
            if (!partial) errors[field] = "This numeric field is required.";
            continue;
        }
        const value = body[field];
        if (typeof value !== "number" || !Number.isFinite(value)) {
            errors[field] = "Enter a finite number.";
            continue;
        }
        if (field === "amount" && value < 0) errors.amount = "Amount cannot be negative.";
        if (field === "minimum_income" && value < 0 && value !== -1) {
            errors.minimum_income = "Income limit must be -1 or a non-negative number.";
        }
        if (field === "minimum_cgpa" && (value < 0 || value > 10)) {
            errors.minimum_cgpa = "Minimum CGPA must be between 0 and 10.";
        }
        fields[field] = value;
    }
    if (Object.hasOwn(body, "deadline") && typeof body.deadline === "string" && !validDate(body.deadline.trim())) {
        errors.deadline = "Enter a real date in YYYY-MM-DD format.";
    }
    if (Object.hasOwn(fields, "disability_required") &&
        fields.disability_required !== "Any" && fields.disability_required !== "Yes") {
        errors.disability_required = "Use Any or Yes, as supported by the existing C admin workflow.";
    }
    if (partial && Object.keys(body).length === 0) errors.fields = "Provide at least one field to update.";
    return { errors, fields };
}

function profileProjection(row) {
    return safeStudent(row);
}

function applicationProjection(row) {
    return {
        application_id: row.application_id,
        status: row.status,
        applied_on: row.applied_on,
        student: { student_id: row.student_id, name: row.student_name, email: row.student_email },
        scholarship: {
            scholarship_id: row.scholarship_id,
            name: row.scholarship_name,
            provider: row.provider,
            amount: row.amount,
            deadline: row.deadline,
            ...deadlineDetails(row.deadline)
        }
    };
}

async function login(req, res, next) {
    if (!isRecord(req.body) || typeof req.body.username !== "string" ||
        typeof req.body.password !== "string" || !req.body.username.trim() ||
        !req.body.password || Buffer.byteLength(req.body.username.trim(), "utf8") > 99 ||
        Buffer.byteLength(req.body.password, "utf8") > 99 || req.body.username.includes("|")) {
        return res.status(400).json({ success: false, message: "Provide a valid username and password." });
    }
    try {
        const admin = await authenticateAdmin(req.body.username, req.body.password);
        if (!admin) return res.status(401).json({ success: false, message: "Username or password is incorrect." });
        const session = createAdminSession(admin.admin_id);
        return res.json({ success: true, message: "Admin login successful.", admin, token: session.token, token_type: "Bearer", expires_at: session.expires_at });
    } catch (error) {
        return next(error);
    }
}

router.post("/login", login);
router.post("/logout", requireAdmin, (req, res, next) => {
    try {
        deleteAdminSession(req.adminTokenHash);
        return res.json({ success: true, message: "Admin logged out successfully." });
    } catch (error) {
        return next(error);
    }
});
router.use(requireAdmin);

router.get("/dashboard", (req, res, next) => {
    try {
        const db = getDatabase();
        const deadlineRows = db.prepare("SELECT deadline FROM scholarships").all();
        const deadlineCounts = { upcoming: 0, expired: 0, unknown: 0 };
        for (const row of deadlineRows) deadlineCounts[deadlineDetails(row.deadline).deadline_status]++;
        const grouped = db.prepare("SELECT status, COUNT(*) AS count FROM applications GROUP BY status").all();
        const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
        for (const row of grouped) byStatus[row.status] = row.count;
        return res.json({
            success: true,
            statistics: {
                total_students: db.prepare("SELECT COUNT(*) AS count FROM students").get().count,
                total_scholarships: db.prepare("SELECT COUNT(*) AS count FROM scholarships").get().count,
                total_applications: db.prepare("SELECT COUNT(*) AS count FROM applications").get().count,
                applications_by_status: byStatus,
                scholarship_deadlines: deadlineCounts
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/scholarships", (req, res, next) => {
    try {
        const scholarships = getDatabase().prepare("SELECT * FROM scholarships ORDER BY scholarship_id").all().map(safeScholarship);
        return res.json({ success: true, scholarships });
    } catch (error) {
        return next(error);
    }
});

router.post("/scholarships", (req, res, next) => {
    if (!isRecord(req.body)) return res.status(400).json({ success: false, message: "Provide scholarship fields as a JSON object." });
    const { errors, fields } = validateScholarship(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: "Please correct the scholarship data.", errors });
    try {
        const db = getDatabase();
        const result = db.prepare(`
            INSERT INTO scholarships (${SCHOLARSHIP_FIELDS.join(", ")})
            VALUES (${SCHOLARSHIP_FIELDS.map(() => "?").join(", ")})
        `).run(...SCHOLARSHIP_FIELDS.map((field) => fields[field]));
        const scholarship = db.prepare("SELECT * FROM scholarships WHERE scholarship_id = ?").get(Number(result.lastInsertRowid));
        return res.status(201).json({ success: true, scholarship: safeScholarship(scholarship) });
    } catch (error) {
        return next(error);
    }
});

router.put("/scholarships/:id", (req, res, next) => {
    const id = recordId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    if (!isRecord(req.body)) return res.status(400).json({ success: false, message: "Provide scholarship updates as a JSON object." });
    const { errors, fields } = validateScholarship(req.body, { partial: true });
    if (Object.keys(errors).length) return res.status(400).json({ success: false, message: "Please correct the scholarship data.", errors });
    try {
        const db = getDatabase();
        if (!db.prepare("SELECT scholarship_id FROM scholarships WHERE scholarship_id = ?").get(id)) {
            return res.status(404).json({ success: false, message: "Scholarship was not found." });
        }
        const names = Object.keys(fields);
        db.prepare(`UPDATE scholarships SET ${names.map((field) => `${field} = ?`).join(", ")} WHERE scholarship_id = ?`)
            .run(...names.map((field) => fields[field]), id);
        const scholarship = db.prepare("SELECT * FROM scholarships WHERE scholarship_id = ?").get(id);
        return res.json({ success: true, scholarship: safeScholarship(scholarship) });
    } catch (error) {
        return next(error);
    }
});

router.delete("/scholarships/:id", (req, res, next) => {
    const id = recordId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    try {
        const db = getDatabase();
        if (!db.prepare("SELECT scholarship_id FROM scholarships WHERE scholarship_id = ?").get(id)) {
            return res.status(404).json({ success: false, message: "Scholarship was not found." });
        }
        const applications = db.prepare("SELECT COUNT(*) AS count FROM applications WHERE scholarship_id = ?").get(id).count;
        if (applications > 0) {
            return res.status(409).json({ success: false, message: "Scholarship cannot be deleted while applications reference it." });
        }
        const saved = db.prepare("SELECT COUNT(*) AS count FROM saved_scholarships WHERE scholarship_id = ?").get(id).count;
        try {
            db.prepare("DELETE FROM scholarships WHERE scholarship_id = ?").run(id);
        } catch (deleteError) {
            if (/FOREIGN KEY constraint failed/i.test(deleteError.message || "")) {
                return res.status(409).json({
                    success: false,
                    message: "Scholarship still has applications or related records and cannot be deleted."
                });
            }
            throw deleteError;
        }
        return res.json({ success: true, message: "Scholarship deleted.", removed_saved_entries: saved });
    } catch (error) {
        return next(error);
    }
});

router.get("/students", (req, res, next) => {
    if (Object.hasOwn(req.query, "q") && typeof req.query.q !== "string") {
        return res.status(400).json({ success: false, message: "Search text must be a single text value." });
    }
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (Buffer.byteLength(q, "utf8") > 99) {
        return res.status(400).json({ success: false, message: "Search text must be at most 99 bytes." });
    }
    try {
        const db = getDatabase();
        const rows = q
            ? db.prepare(`SELECT student_id,name,email,course,annual_income,category,state,gender,disability,cgpa,created_at FROM students WHERE name LIKE ? OR email LIKE ? OR course LIKE ? ORDER BY student_id`).all(`%${q}%`,`%${q}%`,`%${q}%`)
            : db.prepare("SELECT student_id,name,email,course,annual_income,category,state,gender,disability,cgpa,created_at FROM students ORDER BY student_id").all();
        return res.json({ success: true, students: rows.map(profileProjection) });
    } catch (error) {
        return next(error);
    }
});

router.get("/students/:id", (req, res, next) => {
    const id = recordId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: "Student ID must be a positive integer." });
    try {
        const db = getDatabase();
        const row = db.prepare("SELECT student_id,name,email,course,annual_income,category,state,gender,disability,cgpa,created_at FROM students WHERE student_id = ?").get(id);
        if (!row) return res.status(404).json({ success: false, message: "Student was not found." });
        return res.json({
            success: true,
            student: {
                ...profileProjection(row),
                application_count: db.prepare("SELECT COUNT(*) AS count FROM applications WHERE student_id = ?").get(id).count,
                saved_scholarship_count: db.prepare("SELECT COUNT(*) AS count FROM saved_scholarships WHERE student_id = ?").get(id).count
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/applications", (req, res, next) => {
    const status = req.query.status;
    if (status !== undefined && !STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: "Status filter must be Pending, Approved, or Rejected." });
    }
    try {
        const db = getDatabase();
        const sql = `
            SELECT a.application_id,a.student_id,a.scholarship_id,a.status,a.applied_on,
                   st.name AS student_name,st.email AS student_email,
                   s.name AS scholarship_name,s.provider,s.amount,s.deadline
            FROM applications a JOIN students st ON st.student_id=a.student_id
            JOIN scholarships s ON s.scholarship_id=a.scholarship_id
            ${status === undefined ? "" : "WHERE a.status = ?"}
            ORDER BY a.applied_on DESC,a.application_id DESC
        `;
        const rows = status === undefined ? db.prepare(sql).all() : db.prepare(sql).all(status);
        return res.json({ success: true, applications: rows.map(applicationProjection) });
    } catch (error) {
        return next(error);
    }
});

router.get("/applications/:id", (req, res, next) => {
    const id = recordId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    try {
        const db = getDatabase();
        const row = db.prepare(`
            SELECT a.application_id,a.student_id,a.scholarship_id,a.status,a.applied_on,
                   st.name AS student_name,st.email AS student_email,st.course,st.annual_income,
                   st.category,st.state,st.gender,st.disability,st.cgpa,st.created_at AS student_created_at,
                   s.name AS scholarship_name,s.provider,s.description,s.amount,s.minimum_income,
                   s.deadline,s.eligible_course,s.eligible_category,s.eligible_state,s.eligible_gender,
                   s.disability_required,s.category AS scholarship_category,s.minimum_cgpa
            FROM applications a JOIN students st ON st.student_id=a.student_id
            JOIN scholarships s ON s.scholarship_id=a.scholarship_id
            WHERE a.application_id = ?
        `).get(id);
        if (!row) return res.status(404).json({ success: false, message: "Application was not found." });
        const documents = db.prepare(`SELECT document_id,application_id,document_name,document_type,status,created_at FROM documents WHERE application_id=? ORDER BY document_id`).all(id).map(safeDocument);
        return res.json({
            success: true,
            application: {
                application_id: row.application_id,
                status: row.status,
                applied_on: row.applied_on,
                student: profileProjection({
                    student_id: row.student_id,name: row.student_name,email: row.student_email,course: row.course,
                    annual_income: row.annual_income,category: row.category,state: row.state,gender: row.gender,
                    disability: row.disability,cgpa: row.cgpa,created_at: row.student_created_at
                }),
                scholarship: safeScholarship({
                    scholarship_id: row.scholarship_id,name: row.scholarship_name,provider: row.provider,
                    description: row.description,amount: row.amount,minimum_income: row.minimum_income,
                    deadline: row.deadline,eligible_course: row.eligible_course,eligible_category: row.eligible_category,
                    eligible_state: row.eligible_state,eligible_gender: row.eligible_gender,
                    disability_required: row.disability_required,category: row.scholarship_category,minimum_cgpa: row.minimum_cgpa
                }),
                deadline: deadlineDetails(row.deadline),
                documents
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.put("/applications/:id/status", (req, res, next) => {
    const id = recordId(req.params.id);
    if (id === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    if (!isRecord(req.body) || !STATUSES.includes(req.body.status)) {
        return res.status(400).json({ success: false, message: "Status must be Pending, Approved, or Rejected." });
    }
    try {
        const db = getDatabase();
        if (!db.prepare("SELECT application_id FROM applications WHERE application_id = ?").get(id)) {
            return res.status(404).json({ success: false, message: "Application was not found." });
        }
        db.prepare("UPDATE applications SET status = ? WHERE application_id = ?").run(req.body.status, id);
        const row = db.prepare(`
            SELECT a.application_id,a.student_id,a.scholarship_id,a.status,a.applied_on,
                   st.name AS student_name,st.email AS student_email,s.name AS scholarship_name,
                   s.provider,s.amount,s.deadline
            FROM applications a JOIN students st ON st.student_id=a.student_id
            JOIN scholarships s ON s.scholarship_id=a.scholarship_id WHERE a.application_id=?
        `).get(id);
        return res.json({ success: true, application: applicationProjection(row) });
    } catch (error) {
        return next(error);
    }
});

router.get("/reports", (req, res, next) => {
    try {
        const db = getDatabase();
        const deadlines = db.prepare("SELECT scholarship_id,deadline FROM scholarships").all();
        const deadlineCounts = { upcoming: 0, expired: 0, unknown: 0 };
        for (const row of deadlines) deadlineCounts[deadlineDetails(row.deadline).deadline_status]++;
        const grouped = db.prepare("SELECT status,COUNT(*) AS count FROM applications GROUP BY status").all();
        const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0]));
        for (const row of grouped) byStatus[row.status] = row.count;
        const scholarshipApplications = db.prepare(`
            SELECT s.scholarship_id,s.name AS scholarship_name,COUNT(a.application_id) AS application_count
            FROM scholarships s LEFT JOIN applications a ON a.scholarship_id=s.scholarship_id
            GROUP BY s.scholarship_id,s.name ORDER BY application_count DESC,s.scholarship_id
        `).all();
        return res.json({
            success: true,
            report: {
                totals: {
                    students: db.prepare("SELECT COUNT(*) AS count FROM students").get().count,
                    scholarships: deadlines.length,
                    applications: db.prepare("SELECT COUNT(*) AS count FROM applications").get().count
                },
                applications_by_status: byStatus,
                scholarship_application_counts: scholarshipApplications,
                scholarship_deadlines: deadlineCounts
            }
        });
    } catch (error) {
        return next(error);
    }
});

router.post("/backup", (req, res, next) => {
    try {
        const image = Buffer.from(getDatabase().serialize());
        fs.mkdirSync(BACKUP_DIRECTORY, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const fileName = `scholarsync-${stamp}-${crypto.randomBytes(4).toString("hex")}.sqlite`;
        const filePath = path.join(BACKUP_DIRECTORY, fileName);
        let created = false;
        try {
            const descriptor = fs.openSync(filePath, "wx", 0o600);
            created = true;
            try {
                fs.writeFileSync(descriptor, image);
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
        } catch (error) {
            if (created) {
                try { fs.rmSync(filePath, { force: true }); } catch {}
            }
            throw error;
        }
        return res.status(201).json({
            success: true,
            message: "Database backup created without modifying the live database.",
            backup: { file_name: fileName, size_bytes: image.length, created_at: new Date().toISOString() }
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;




