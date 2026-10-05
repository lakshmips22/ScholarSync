const express = require("express");
const requireAuth = require("../middleware/require-auth");
const { isRecord } = require("../services/validators");
const {
    authenticateStudent,
    createSession,
    deleteSession,
    registerStudent
} = require("../services/auth-service");

const router = express.Router();
const BYTE_LIMITS = {
    name: 99,
    email: 99,
    course: 99,
    category: 29,
    state: 59,
    gender: 19
};
const EMAIL_PATTERN = /^[^\s|@]+@[^\s|@]+\.[^\s|@.]+$/;

function textField(body, field, errors, required = true) {
    const value = body[field];
    if (typeof value !== "string") {
        if (required) errors[field] = "This field is required and must be text.";
        return "";
    }
    const cleaned = value.trim();
    if (required && !cleaned) errors[field] = "This field is required.";
    if (Buffer.byteLength(cleaned, "utf8") > BYTE_LIMITS[field]) {
        errors[field] = `Must be at most ${BYTE_LIMITS[field]} bytes.`;
    }
    if (cleaned.includes("|")) errors[field] = "The | character is not allowed.";
    return cleaned;
}

function validateRegistration(body) {
    const errors = {};
    const student = {};
    for (const field of ["name", "email", "course", "category", "state", "gender"]) {
        student[field] = textField(body, field, errors);
    }
    if (student.email && !EMAIL_PATTERN.test(student.email)) {
        errors.email = "Enter a valid email address.";
    }

    if (typeof body.password !== "string") {
        errors.password = "Password is required and must be text.";
    } else {
        student.password = body.password;
        const passwordLength = Buffer.byteLength(body.password, "utf8");
        if (passwordLength < 8 || passwordLength > 99) {
            errors.password = "Password must be 8 to 99 bytes long.";
        }
        if (!body.password.trim()) errors.password = "Password cannot be blank.";
    }

    for (const field of ["annual_income", "cgpa"]) {
        const value = body[field];
        if (value === undefined || value === null || value === "") {
            errors[field] = "This field is required and must be a number.";
        } else if (typeof value !== "number" || !Number.isFinite(value)) {
            errors[field] = "Enter a valid number.";
        } else {
            student[field] = value;
        }
    }
    if (student.annual_income !== undefined && student.annual_income < 0) {
        errors.annual_income = "Annual income cannot be negative.";
    }
    if (student.cgpa !== undefined && (student.cgpa < 0 || student.cgpa > 10)) {
        errors.cgpa = "CGPA must be between 0 and 10.";
    }

    if (body.disability !== "Yes" && body.disability !== "No") {
        errors.disability = "Disability must be Yes or No.";
    } else {
        student.disability = body.disability;
    }
    return { errors, student };
}

function validateCredentials(body) {
    if (typeof body.email !== "string" || !body.email.trim() ||
        Buffer.byteLength(body.email.trim(), "utf8") > BYTE_LIMITS.email ||
        !EMAIL_PATTERN.test(body.email.trim())) {
        return { error: "Enter a valid email and password." };
    }
    if (typeof body.password !== "string" || !body.password.length ||
        Buffer.byteLength(body.password, "utf8") > 99) {
        return { error: "Enter a valid email and password." };
    }
    return { email: body.email.trim(), password: body.password };
}

router.post("/register", async (req, res, next) => {
    if (!isRecord(req.body)) {
        return res.status(400).json({ success: false, message: "Provide registration details as a JSON object." });
    }
    const { errors, student } = validateRegistration(req.body);
    if (Object.keys(errors).length) {
        return res.status(400).json({ success: false, message: "Please correct the registration details.", errors });
    }
    try {
        const profile = await registerStudent(student);
        return res.status(201).json({ success: true, message: "Registration successful.", user: profile });
    } catch (error) {
        if (error.code === "DUPLICATE_EMAIL") {
            return res.status(409).json({ success: false, message: error.message });
        }
        return next(error);
    }
});

router.post("/login", async (req, res, next) => {
    if (!isRecord(req.body)) {
        return res.status(400).json({ success: false, message: "Provide login details as a JSON object." });
    }
    const credentials = validateCredentials(req.body);
    if (credentials.error) {
        return res.status(400).json({ success: false, message: credentials.error });
    }
    try {
        const user = await authenticateStudent(credentials.email, credentials.password);
        if (!user) {
            return res.status(401).json({ success: false, message: "Email or password is incorrect." });
        }
        const session = createSession(user.student_id);
        return res.json({
            success: true,
            message: "Login successful.",
            user,
            token: session.token,
            token_type: "Bearer",
            expires_at: session.expires_at
        });
    } catch (error) {
        return next(error);
    }
});

router.get("/me", requireAuth, (req, res) => {
    res.json({ success: true, user: req.auth.student });
});

router.post("/logout", requireAuth, (req, res) => {
    deleteSession(req.auth.tokenHash);
    res.json({ success: true, message: "Logged out successfully." });
});

module.exports = router;
