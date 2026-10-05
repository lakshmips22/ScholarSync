const crypto = require("node:crypto");
const { getDatabase } = require("../database/database");
const { SESSION_TTL_SECONDS, verifyPassword } = require("./auth-service");

async function authenticateAdmin(username, password) {
    const admin = getDatabase().prepare(`
        SELECT admin_id, username, password_hash, role, created_at
        FROM admins WHERE username = ?
    `).get(username);
    const valid = await verifyPassword(password, admin ? admin.password_hash : null);
    if (!valid || !admin || admin.role !== "admin") return null;
    return {
        admin_id: admin.admin_id,
        username: admin.username,
        role: admin.role,
        created_at: admin.created_at
    };
}

function createAdminSession(adminId) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest("hex");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_TTL_SECONDS;
    const db = getDatabase();
    db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
    db.prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash, adminId, expiresAt);
    return { token, expires_at: new Date(expiresAt * 1000).toISOString() };
}

function findAdminSession(tokenHash) {
    const now = Math.floor(Date.now() / 1000);
    return getDatabase().prepare(`
        SELECT a.admin_id, a.username, a.role, a.created_at, s.token_hash
        FROM admin_sessions s JOIN admins a ON a.admin_id = s.admin_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND a.role = 'admin'
    `).get(tokenHash, now);
}

function deleteAdminSession(tokenHash) {
    getDatabase().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
}

module.exports = { authenticateAdmin, createAdminSession, deleteAdminSession, findAdminSession };
