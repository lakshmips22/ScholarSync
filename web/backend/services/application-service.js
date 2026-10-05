const { deadlineState } = require("./eligibility-service");
const { isRecord, positiveId } = require("./validators");

const REVIEW_STATUSES = new Set(["Pending", "Approved", "Rejected"]);
const STUDENT_DOCUMENT_STATUSES = new Set(["Pending", "Submitted"]);

function deadlineDetails(deadline) {
    const state = deadlineState(deadline);
    if (state === "unknown") return { deadline_status: "unknown", days_remaining: null };
    const today = new Date().toISOString().slice(0, 10);
    const [year, month, day] = deadline.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
    const days = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000);
    return {
        deadline_status: state === "expired" ? "expired" : "upcoming",
        days_remaining: days
    };
}

function safeApplication(row) {
    const deadline = deadlineDetails(row.deadline);
    return {
        application_id: row.application_id,
        scholarship_id: row.scholarship_id,
        status: row.status,
        applied_on: row.applied_on,
        scholarship_name: row.scholarship_name,
        deadline: row.deadline,
        deadline_status: deadline.deadline_status,
        days_remaining: deadline.days_remaining
    };
}

function safeDocument(row) {
    return {
        document_id: row.document_id,
        application_id: row.application_id,
        document_name: row.document_name,
        document_type: row.document_type,
        status: row.status,
        created_at: row.created_at
    };
}

module.exports = {
    REVIEW_STATUSES,
    STUDENT_DOCUMENT_STATUSES,
    deadlineDetails,
    isRecord,
    positiveId,
    safeApplication,
    safeDocument
};
