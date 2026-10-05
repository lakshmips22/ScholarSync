const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const { positiveId } = require("../services/validators");
const { deadlineState, evaluateScholarship, profileProblems } = require("../services/eligibility-service");

const router = express.Router();
function loadScholarship(db, id) {
    return db.prepare("SELECT * FROM scholarships WHERE scholarship_id = ?").get(id);
}

router.get("/:scholarshipId/eligibility", requireAuth, (req, res, next) => {
    const scholarshipId = positiveId(req.params.scholarshipId);
    if (scholarshipId === null) {
        return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    }
    try {
        const db = getDatabase();
        const scholarship = loadScholarship(db, scholarshipId);
        if (!scholarship) return res.status(404).json({ success: false, message: "Scholarship was not found." });

        const student = db.prepare(`
            SELECT student_id, course, annual_income, category, state, gender, disability, cgpa
            FROM students WHERE student_id = ?
        `).get(req.auth.student.student_id);
        if (!student) return res.status(404).json({ success: false, message: "Student profile was not found." });

        const profile = profileProblems(student);
        if (profile.missing.length || profile.invalid.length) {
            const missing = profile.missing;
            const invalid = profile.invalid;
            return res.status(200).json({
                success: true,
                eligible: false,
                profile_complete: false,
                missing_fields: missing,
                invalid_fields: invalid,
                scholarship: { scholarship_id: scholarship.scholarship_id, name: scholarship.name },
                criteria: [],
                reasons: ["Complete or correct the profile fields needed for eligibility checking."]
            });
        }

        const result = evaluateScholarship(student, scholarship);
        return res.json({
            success: true,
            eligible: result.eligible,
            profile_complete: true,
            scholarship: { scholarship_id: scholarship.scholarship_id, name: scholarship.name },
            deadline_status: deadlineState(scholarship.deadline),
            criteria: result.criteria,
            reasons: result.reasons
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
