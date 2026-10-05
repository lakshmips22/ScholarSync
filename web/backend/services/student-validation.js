const EMAIL_PATTERN = /^[^\s|@]+@[^\s|@]+\.[^\s|@.]+$/;
const { isRecord } = require("./validators");
const PROFILE_FIELDS = [
    "name", "email", "course", "annual_income", "category", "state", "gender", "disability", "cgpa"
];
const TEXT_LIMITS = {
    name: 99,
    email: 99,
    course: 99,
    category: 29,
    state: 59,
    gender: 19
};

function validateProfileUpdate(body) {
    const errors = {};
    const updates = {};
    const unknownFields = Object.keys(body).filter((field) => !PROFILE_FIELDS.includes(field));

    if (unknownFields.length) {
        errors.fields = `Unsupported profile field(s): ${unknownFields.join(", ")}.`;
    }
    if (Object.keys(body).length === 0) {
        errors.fields = "Provide at least one profile field to update.";
    }

    for (const field of Object.keys(TEXT_LIMITS)) {
        if (!Object.hasOwn(body, field)) continue;
        if (typeof body[field] !== "string") {
            errors[field] = "This field must be text.";
            continue;
        }
        const value = body[field].trim();
        if (!value) errors[field] = "This field cannot be blank.";
        if (Buffer.byteLength(value, "utf8") > TEXT_LIMITS[field]) {
            errors[field] = `Must be at most ${TEXT_LIMITS[field]} bytes.`;
        }
        if (value.includes("|")) errors[field] = "The | character is not allowed.";
        if (field === "email" && value && !EMAIL_PATTERN.test(value)) {
            errors.email = "Enter a valid email address.";
        }
        updates[field] = value;
    }

    for (const field of ["annual_income", "cgpa"]) {
        if (!Object.hasOwn(body, field)) continue;
        const value = body[field];
        if (typeof value !== "number" || !Number.isFinite(value)) {
            errors[field] = "Enter a valid number.";
            continue;
        }
        if (field === "annual_income" && value < 0) {
            errors.annual_income = "Annual income cannot be negative.";
        }
        if (field === "cgpa" && (value < 0 || value > 10)) {
            errors.cgpa = "CGPA must be between 0 and 10.";
        }
        updates[field] = value;
    }

    if (Object.hasOwn(body, "disability")) {
        if (body.disability !== "Yes" && body.disability !== "No") {
            errors.disability = "Disability must be Yes or No.";
        } else {
            updates.disability = body.disability;
        }
    }

    return { errors, updates };
}

module.exports = { isRecord, validateProfileUpdate };
