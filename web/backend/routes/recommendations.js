const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const { deadlineState, evaluateScholarship, profileProblems, safeScholarship } = require("../services/eligibility-service");

const router = express.Router();
const MAX_RECOMMENDATIONS = 5;

router.get("/", requireAuth, (req, res, next) => {
    try {
        const db = getDatabase();
        const student = db.prepare(`
            SELECT student_id, course, annual_income, category, state, gender, disability, cgpa
            FROM students WHERE student_id = ?
        `).get(req.auth.student.student_id);
        if (!student) return res.status(404).json({ success: false, message: "Student profile was not found." });

        const profile = profileProblems(student);
        if (profile.missing.length || profile.invalid.length) {
            return res.json({
                success: true,
                profile_complete: false,
                missing_fields: profile.missing,
                invalid_fields: profile.invalid,
                recommendations: [],
                active_eligible_count: 0,
                expired_eligible_count: 0,
                message: "Complete or correct your profile fields to get recommendations."
            });
        }

        const scholarships = db.prepare("SELECT * FROM scholarships ORDER BY scholarship_id ASC").all();
        if (scholarships.length === 0) {
            return res.json({
                success: true,
                profile_complete: true,
                recommendations: [],
                active_eligible_count: 0,
                expired_eligible_count: 0,
                message: "No scholarships are currently available in the catalog."
            });
        }

        const activeMatches = [];
        let expiredEligibleCount = 0;
        let unknownDeadlineEligibleCount = 0;
        for (const scholarship of scholarships) {
            const match = evaluateScholarship(student, scholarship);
            if (!match.eligible) continue;
            const status = deadlineState(scholarship.deadline);
            if (status === "expired") {
                expiredEligibleCount++;
                continue;
            }
            if (status === "unknown") {
                unknownDeadlineEligibleCount++;
                continue;
            }
            activeMatches.push({ scholarship, match });
        }

        // Mirrors the C recommender: eligible scholarships ranked by award amount, top five shown.
        activeMatches.sort((left, right) => right.scholarship.amount - left.scholarship.amount ||
            left.scholarship.scholarship_id - right.scholarship.scholarship_id);
        const recommendations = activeMatches.slice(0, MAX_RECOMMENDATIONS).map(({ scholarship, match }) => ({
            ...safeScholarship(scholarship),
            match_reasons: ["Your profile meets all listed eligibility rules."],
            eligibility: { eligible: true, criteria: match.criteria, reasons: match.reasons }
        }));

        let message = null;
        if (recommendations.length === 0 && expiredEligibleCount > 0 && unknownDeadlineEligibleCount === 0) {
            message = "Your profile matches scholarships, but their deadlines have passed.";
        } else if (recommendations.length === 0 && unknownDeadlineEligibleCount > 0) {
            message = "No active recommendations could be confirmed because matching scholarship deadlines are missing or invalid.";
        } else if (recommendations.length === 0) {
            message = "No currently available scholarships match the listed profile rules.";
        }

        return res.json({
            success: true,
            profile_complete: true,
            recommendations,
            active_eligible_count: activeMatches.length,
            expired_eligible_count: expiredEligibleCount,
            unverified_deadline_count: unknownDeadlineEligibleCount,
            message
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
