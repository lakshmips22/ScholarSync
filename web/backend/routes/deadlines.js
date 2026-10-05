const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const { deadlineDetails } = require("../services/application-service");

const router = express.Router();

router.get("/", requireAuth, (req, res, next) => {
    try {
        const rows = getDatabase().prepare(`
            SELECT s.scholarship_id, s.name AS scholarship_name, s.deadline,
                   a.application_id, a.status AS application_status, a.applied_on
            FROM scholarships s
            LEFT JOIN applications a
              ON a.scholarship_id = s.scholarship_id AND a.student_id = ?
        `).all(req.auth.student.student_id).map((row) => ({
            scholarship_id: row.scholarship_id,
            scholarship_name: row.scholarship_name,
            deadline: row.deadline,
            ...deadlineDetails(row.deadline),
            application: row.application_id === null ? null : {
                application_id: row.application_id,
                status: row.application_status,
                applied_on: row.applied_on
            }
        }));
        rows.sort((left, right) => {
            const leftRank = left.deadline_status === "upcoming" ? 0 : left.deadline_status === "expired" ? 1 : 2;
            const rightRank = right.deadline_status === "upcoming" ? 0 : right.deadline_status === "expired" ? 1 : 2;
            if (leftRank !== rightRank) return leftRank - rightRank;
            if (left.days_remaining === null) return right.days_remaining === null ? left.scholarship_id - right.scholarship_id : 1;
            if (right.days_remaining === null) return -1;
            return left.days_remaining - right.days_remaining || left.scholarship_id - right.scholarship_id;
        });
        const counts = rows.reduce((summary, row) => {
            summary[row.deadline_status]++;
            return summary;
        }, { upcoming: 0, expired: 0, unknown: 0 });
        return res.json({ success: true, deadlines: rows, counts });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
