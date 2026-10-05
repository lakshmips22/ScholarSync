const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const { isRecord, validateProfileUpdate } = require("../services/student-validation");
const { safeStudent } = require("../services/student-service");

const router = express.Router();
const PROFILE_SELECT = `
    SELECT student_id, name, email, course, annual_income, category, state,
           gender, disability, cgpa, created_at
    FROM students WHERE student_id = ?
`;

router.use(requireAuth);

router.get("/profile", (req, res, next) => {
    try {
        const student = getDatabase().prepare(PROFILE_SELECT).get(req.auth.student.student_id);
        if (!student) return res.status(404).json({ success: false, message: "Student profile was not found." });
        return res.json({ success: true, user: safeStudent(student) });
    } catch (error) {
        return next(error);
    }
});

router.put("/profile", (req, res, next) => {
    if (!isRecord(req.body)) {
        return res.status(400).json({ success: false, message: "Provide profile updates as a JSON object." });
    }
    const { errors, updates } = validateProfileUpdate(req.body);
    if (Object.keys(errors).length) {
        return res.status(400).json({ success: false, message: "Please correct the profile details.", errors });
    }

    const fields = Object.keys(updates);
    const studentId = req.auth.student.student_id;
    try {
        const db = getDatabase();
        const assignments = fields.map((field) => `${field} = ?`).join(", ");
        try {
            db.prepare(`UPDATE students SET ${assignments} WHERE student_id = ?`)
                .run(...fields.map((field) => updates[field]), studentId);
        } catch (error) {
            if (/UNIQUE constraint failed: students\.email/i.test(error.message)) {
                return res.status(409).json({ success: false, message: "An account with this email already exists." });
            }
            throw error;
        }
        const student = db.prepare(PROFILE_SELECT).get(studentId);
        if (!student) return res.status(404).json({ success: false, message: "Student profile was not found." });
        return res.json({ success: true, message: "Profile updated successfully.", user: safeStudent(student) });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
