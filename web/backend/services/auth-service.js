const crypto = require("node:crypto");
const { safeStudent } = require("./student-service");
const { promisify } = require("node:util");
const { getDatabase } = require("../database/database");

const pbkdf2 = promisify(crypto.pbkdf2);
const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

async function hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const hash = await pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
    return `P1$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
    const match = typeof storedHash === "string" && /^P1\$([0-9a-fA-F]{32})\$([0-9a-fA-F]{64})$/.exec(storedHash);
    if (!match) {
        // Spend comparable work for missing or malformed hashes without accepting them.
        await pbkdf2(password, crypto.randomBytes(SALT_LENGTH), ITERATIONS, KEY_LENGTH, "sha256");
        return false;
    }
    const actual = await pbkdf2(password, Buffer.from(match[1], "hex"), ITERATIONS, KEY_LENGTH, "sha256");
    return crypto.timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}

async function registerStudent(student) {
    const passwordHash = await hashPassword(student.password);
    const database = getDatabase();
    try {
        const result = database.prepare(`
            INSERT INTO students
                (name, email, password_hash, course, annual_income, category, state, gender, disability, cgpa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            student.name, student.email, passwordHash, student.course,
            student.annual_income, student.category, student.state,
            student.gender, student.disability, student.cgpa
        );
        const row = database.prepare(`
            SELECT student_id, name, email, course, annual_income, category, state,
                   gender, disability, cgpa, created_at
            FROM students WHERE student_id = ?
        `).get(Number(result.lastInsertRowid));
        return safeStudent(row);
    } catch (error) {
        if (/UNIQUE constraint failed: students\.email/i.test(error.message)) {
            const duplicate = new Error("An account with this email already exists.");
            duplicate.code = "DUPLICATE_EMAIL";
            throw duplicate;
        }
        throw error;
    }
}

async function authenticateStudent(email, password) {
    const row = getDatabase().prepare(`
        SELECT student_id, name, email, password_hash, course, annual_income,
               category, state, gender, disability, cgpa, created_at
        FROM students WHERE email = ?
    `).get(email);
    const isValid = await verifyPassword(password, row ? row.password_hash : null);
    return isValid && row ? safeStudent(row) : null;
}

function createSession(studentId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_TTL_SECONDS;
    const database = getDatabase();
    database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
    database.prepare("INSERT INTO auth_sessions (token_hash, student_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash, studentId, expiresAt);
    return { token, expires_at: new Date(expiresAt * 1000).toISOString() };
}

function findSession(token) {
    const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const now = Math.floor(Date.now() / 1000);
    const row = getDatabase().prepare(`
        SELECT s.student_id, s.name, s.email, s.course, s.annual_income,
               s.category, s.state, s.gender, s.disability, s.cgpa, s.created_at,
               a.token_hash
        FROM auth_sessions a
        JOIN students s ON s.student_id = a.student_id
        WHERE a.token_hash = ? AND a.expires_at > ?
    `).get(tokenHash, now);
    return row ? { student: safeStudent(row), tokenHash: row.token_hash } : null;
}

function deleteSession(tokenHash) {
    getDatabase().prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
}

module.exports = {
    authenticateStudent,
    hashPassword,
    verifyPassword,
    createSession,
    deleteSession,
    findSession,
    registerStudent,
    SESSION_TTL_SECONDS
};



