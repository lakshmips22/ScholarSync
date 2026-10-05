const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const { positiveId } = require("../services/validators");

const router = express.Router();
const SCHOLARSHIP_FIELDS = `
    s.scholarship_id, s.name, s.provider, s.description, s.amount,
    s.minimum_income, s.deadline, s.eligible_course, s.eligible_category,
    s.eligible_state, s.eligible_gender, s.disability_required,
    s.category, s.minimum_cgpa
`;

function getExistingScholarship(db, scholarshipId) {
    return db.prepare("SELECT scholarship_id FROM scholarships WHERE scholarship_id = ?").get(scholarshipId);
}

router.use(requireAuth);

router.get("/", (req, res, next) => {
    try {
        const saved = getDatabase().prepare(`
            SELECT ${SCHOLARSHIP_FIELDS}, ss.saved_at
            FROM saved_scholarships ss
            JOIN scholarships s ON s.scholarship_id = ss.scholarship_id
            WHERE ss.student_id = ?
            ORDER BY ss.saved_at DESC, s.scholarship_id ASC
        `).all(req.auth.student.student_id);
        return res.json({ success: true, saved_scholarships: saved });
    } catch (error) {
        return next(error);
    }
});

router.get("/:scholarshipId/status", (req, res, next) => {
    const scholarshipId = positiveId(req.params.scholarshipId);
    if (scholarshipId === null) {
        return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    }
    try {
        const db = getDatabase();
        if (!getExistingScholarship(db, scholarshipId)) {
            return res.status(404).json({ success: false, message: "Scholarship was not found." });
        }
        const saved = db.prepare(`
            SELECT 1 AS saved FROM saved_scholarships
            WHERE student_id = ? AND scholarship_id = ?
        `).get(req.auth.student.student_id, scholarshipId);
        return res.json({ success: true, scholarship_id: scholarshipId, saved: Boolean(saved) });
    } catch (error) {
        return next(error);
    }
});

router.post("/:scholarshipId", (req, res, next) => {
    const scholarshipId = positiveId(req.params.scholarshipId);
    if (scholarshipId === null) {
        return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    }
    try {
        const db = getDatabase();
        if (!getExistingScholarship(db, scholarshipId)) {
            return res.status(404).json({ success: false, message: "Scholarship was not found." });
        }
        const result = db.prepare(`
            INSERT INTO saved_scholarships (student_id, scholarship_id)
            VALUES (?, ?)
            ON CONFLICT(student_id, scholarship_id) DO NOTHING
        `).run(req.auth.student.student_id, scholarshipId);
        const alreadySaved = Number(result.changes) === 0;
        return res.status(alreadySaved ? 200 : 201).json({
            success: true,
            message: alreadySaved ? "Scholarship was already saved." : "Scholarship saved successfully.",
            scholarship_id: scholarshipId,
            saved: true,
            already_saved: alreadySaved
        });
    } catch (error) {
        return next(error);
    }
});

router.delete("/:scholarshipId", (req, res, next) => {
    const scholarshipId = positiveId(req.params.scholarshipId);
    if (scholarshipId === null) {
        return res.status(400).json({ success: false, message: "Scholarship ID must be a positive integer." });
    }
    try {
        const result = getDatabase().prepare(`
            DELETE FROM saved_scholarships WHERE student_id = ? AND scholarship_id = ?
        `).run(req.auth.student.student_id, scholarshipId);
        if (Number(result.changes) === 0) {
            return res.status(404).json({ success: false, message: "Scholarship was not in your saved list." });
        }
        return res.json({ success: true, message: "Scholarship removed from your saved list.", scholarship_id: scholarshipId, saved: false });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
