const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { getDatabase } = require("../database/database");
const {
    REVIEW_STATUSES,
    STUDENT_DOCUMENT_STATUSES,
    deadlineDetails,
    isRecord,
    positiveId,
    safeApplication,
    safeDocument
} = require("../services/application-service");

const router = express.Router();
const APPLICATION_SELECT = `
    SELECT a.application_id, a.scholarship_id, a.status, a.applied_on,
           s.name AS scholarship_name, s.deadline
    FROM applications a
    JOIN scholarships s ON s.scholarship_id = a.scholarship_id
`;
const DOCUMENT_SELECT = `
    SELECT document_id, application_id, document_name, document_type, status, created_at
    FROM documents
`;

function loadOwnedApplication(db, applicationId, studentId) {
    return db.prepare(`${APPLICATION_SELECT} WHERE a.application_id = ? AND a.student_id = ?`)
        .get(applicationId, studentId);
}

function documentInput(body, { allowStatus }) {
    const errors = {};
    const updates = {};
    const allowed = new Set(["document_name", "document_type", "status"]);
    const unknown = Object.keys(body).filter((field) => !allowed.has(field));
    if (unknown.length) errors.fields = `Unsupported document field(s): ${unknown.join(", ")}.`;

    if (Object.hasOwn(body, "document_name")) {
        if (typeof body.document_name !== "string" || body.document_name.trim() === "") {
            errors.document_name = "Document name must be non-empty text.";
        } else {
            const trimmedName = body.document_name.trim();
            if (Buffer.byteLength(trimmedName, "utf8") > 200) {
                errors.document_name = "Must be at most 200 bytes.";
            }
            updates.document_name = trimmedName;
        }
    } else if (!allowStatus) {
        errors.document_name = "Document name is required.";
    }

    if (Object.hasOwn(body, "document_type")) {
        if (body.document_type !== null && typeof body.document_type !== "string") {
            errors.document_type = "Document type must be text or null.";
        } else {
            const trimmedType = typeof body.document_type === "string" && body.document_type.trim()
                ? body.document_type.trim()
                : null;
            if (trimmedType !== null && Buffer.byteLength(trimmedType, "utf8") > 100) {
                errors.document_type = "Must be at most 100 bytes.";
            }
            updates.document_type = trimmedType;
        }
    }

    if (Object.hasOwn(body, "status")) {
        if (typeof body.status !== "string") {
            errors.status = "Document status must be text.";
        } else if (body.status === "Verified" || body.status === "Rejected") {
            errors.status = "Only an authorized reviewer can set Verified or Rejected.";
            errors.status_code = 403;
        } else if (!STUDENT_DOCUMENT_STATUSES.has(body.status)) {
            errors.status = "Status must be Pending or Submitted.";
        } else {
            updates.status = body.status;
        }
    } else if (!allowStatus) {
        updates.status = "Pending";
    }

    if (allowStatus && Object.keys(updates).length === 0 && Object.keys(errors).length === 0) {
        errors.fields = "Provide at least one document field to update.";
    }
    return { errors, updates };
}

router.use(requireAuth);

router.get("/", (req, res, next) => {
    try {
        const rows = getDatabase().prepare(`${APPLICATION_SELECT} WHERE a.student_id = ? ORDER BY a.applied_on DESC, a.application_id DESC`)
            .all(req.auth.student.student_id);
        return res.json({ success: true, applications: rows.map(safeApplication) });
    } catch (error) {
        return next(error);
    }
});

router.post("/", (req, res, next) => {
    if (!isRecord(req.body)) {
        return res.status(400).json({ success: false, message: "Provide application details as a JSON object." });
    }
    const unknown = Object.keys(req.body).filter((key) => key !== "scholarship_id");
    if (unknown.length) {
        return res.status(400).json({ success: false, message: "Only scholarship_id may be provided; student identity comes from authentication." });
    }
    const scholarshipId = positiveId(String(req.body.scholarship_id ?? ""));
    if (scholarshipId === null) {
        return res.status(400).json({ success: false, message: "A valid positive scholarship_id is required." });
    }

    try {
        const db = getDatabase();
        const scholarship = db.prepare("SELECT scholarship_id, deadline FROM scholarships WHERE scholarship_id = ?").get(scholarshipId);
        if (!scholarship) return res.status(404).json({ success: false, message: "Scholarship was not found." });
        // The existing C workflow permits applications for listed scholarships even after the deadline;
        // preserve that behavior and report the actual derived deadline state to the student.
        const appliedOn = new Date().toLocaleDateString("en-CA");
        let result;
        try {
            result = db.prepare(`
                INSERT INTO applications (student_id, scholarship_id, status, applied_on)
                VALUES (?, ?, ?, ?)
            `).run(req.auth.student.student_id, scholarshipId, "Pending", appliedOn);
        } catch (error) {
            if (/UNIQUE constraint failed: applications\.student_id, applications\.scholarship_id/i.test(error.message)) {
                return res.status(409).json({ success: false, message: "You already have an application for this scholarship." });
            }
            throw error;
        }
        const application = loadOwnedApplication(db, Number(result.lastInsertRowid), req.auth.student.student_id);
        const safe = safeApplication(application);
        return res.status(201).json({
            success: true,
            message: "Application created with status Pending.",
            application: safe,
            deadline_status: deadlineDetails(scholarship.deadline).deadline_status
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/:applicationId/documents", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    try {
        const db = getDatabase();
        if (!loadOwnedApplication(db, applicationId, req.auth.student.student_id)) {
            return res.status(404).json({ success: false, message: "Application was not found." });
        }
        const documents = db.prepare(`${DOCUMENT_SELECT} WHERE application_id = ? ORDER BY created_at, document_id`)
            .all(applicationId).map(safeDocument);
        return res.json({ success: true, documents });
    } catch (error) {
        return next(error);
    }
});

router.post("/:applicationId/documents", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    if (!isRecord(req.body)) return res.status(400).json({ success: false, message: "Provide document details as a JSON object." });
    const { errors, updates } = documentInput(req.body, { allowStatus: false });
    if (Object.keys(errors).length) {
        const status = errors.status_code || 400;
        delete errors.status_code;
        return res.status(status).json({ success: false, message: "Please correct the document details.", errors });
    }
    try {
        const db = getDatabase();
        if (!loadOwnedApplication(db, applicationId, req.auth.student.student_id)) {
            return res.status(404).json({ success: false, message: "Application was not found." });
        }
        const result = db.prepare(`
            INSERT INTO documents (application_id, document_name, document_type, status)
            VALUES (?, ?, ?, ?)
        `).run(applicationId, updates.document_name, updates.document_type ?? null, updates.status);
        const document = db.prepare(`${DOCUMENT_SELECT} WHERE document_id = ? AND application_id = ?`)
            .get(Number(result.lastInsertRowid), applicationId);
        return res.status(201).json({ success: true, document: safeDocument(document) });
    } catch (error) {
        return next(error);
    }
});

router.put("/:applicationId/documents/:documentId", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    const documentId = positiveId(req.params.documentId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    if (documentId === null) return res.status(400).json({ success: false, message: "Document ID must be a positive integer." });
    if (!isRecord(req.body)) return res.status(400).json({ success: false, message: "Provide document updates as a JSON object." });
    const { errors, updates } = documentInput(req.body, { allowStatus: true });
    if (Object.keys(errors).length) {
        const status = errors.status_code || 400;
        delete errors.status_code;
        return res.status(status).json({ success: false, message: "Please correct the document details.", errors });
    }
    try {
        const db = getDatabase();
        if (!loadOwnedApplication(db, applicationId, req.auth.student.student_id)) {
            return res.status(404).json({ success: false, message: "Application was not found." });
        }
        const current = db.prepare(`${DOCUMENT_SELECT} WHERE document_id = ? AND application_id = ?`)
            .get(documentId, applicationId);
        if (!current) return res.status(404).json({ success: false, message: "Document was not found." });
        if (current.status === "Verified") {
            return res.status(403).json({ success: false, message: "A verified document cannot be changed by a student." });
        }
        const fields = Object.keys(updates);
        const assignments = fields.map((field) => `${field} = ?`).join(", ");
        db.prepare(`UPDATE documents SET ${assignments} WHERE document_id = ? AND application_id = ?`)
            .run(...fields.map((field) => updates[field]), documentId, applicationId);
        const document = db.prepare(`${DOCUMENT_SELECT} WHERE document_id = ? AND application_id = ?`)
            .get(documentId, applicationId);
        return res.json({ success: true, document: safeDocument(document) });
    } catch (error) {
        return next(error);
    }
});

router.delete("/:applicationId/documents/:documentId", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    const documentId = positiveId(req.params.documentId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    if (documentId === null) return res.status(400).json({ success: false, message: "Document ID must be a positive integer." });
    try {
        const db = getDatabase();
        if (!loadOwnedApplication(db, applicationId, req.auth.student.student_id)) {
            return res.status(404).json({ success: false, message: "Application was not found." });
        }
        const existing = db.prepare(`${DOCUMENT_SELECT} WHERE document_id = ? AND application_id = ?`)
            .get(documentId, applicationId);
        if (!existing) return res.status(404).json({ success: false, message: "Document was not found." });
        if (existing.status === "Verified") {
            return res.status(403).json({ success: false, message: "A verified document cannot be deleted by a student." });
        }
        db.prepare("DELETE FROM documents WHERE document_id = ? AND application_id = ?").run(documentId, applicationId);
        return res.json({ success: true, message: "Document removed from the checklist." });
    } catch (error) {
        return next(error);
    }
});

router.get("/:applicationId", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    try {
        const application = loadOwnedApplication(getDatabase(), applicationId, req.auth.student.student_id);
        if (!application) return res.status(404).json({ success: false, message: "Application was not found." });
        return res.json({ success: true, application: safeApplication(application) });
    } catch (error) {
        return next(error);
    }
});

router.put("/:applicationId/status", (req, res, next) => {
    const applicationId = positiveId(req.params.applicationId);
    if (applicationId === null) return res.status(400).json({ success: false, message: "Application ID must be a positive integer." });
    if (!isRecord(req.body) || typeof req.body.status !== "string") {
        return res.status(400).json({ success: false, message: "Provide a status value." });
    }
    if (!REVIEW_STATUSES.has(req.body.status)) {
        return res.status(400).json({ success: false, message: "Status must be Pending, Approved, or Rejected in the existing application model." });
    }
    try {
        const application = loadOwnedApplication(getDatabase(), applicationId, req.auth.student.student_id);
        if (!application) return res.status(404).json({ success: false, message: "Application was not found." });
        return res.status(403).json({
            success: false,
            message: "Application review status is controlled by an administrator; students cannot change it."
        });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;

