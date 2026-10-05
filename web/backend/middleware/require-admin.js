const crypto = require("node:crypto");
const { getDatabase } = require("../database/database");
const { findAdminSession } = require("../services/admin-auth-service");

function requireAdmin(req, res, next) {
    const header = req.get("authorization");
    const match = typeof header === "string" && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    if (!match) return res.status(401).json({ success: false, message: "Administrator authentication required." });

    try {
        const tokenHash = crypto.createHash("sha256").update(match[1], "utf8").digest("hex");
        const admin = findAdminSession(tokenHash);
        if (admin) {
            req.admin = {
                admin_id: admin.admin_id,
                username: admin.username,
                role: admin.role,
                created_at: admin.created_at
            };
            req.adminTokenHash = admin.token_hash;
            return next();
        }

        const now = Math.floor(Date.now() / 1000);
        const isStudent = getDatabase().prepare(
            "SELECT 1 AS valid FROM auth_sessions WHERE token_hash = ? AND expires_at > ?"
        ).get(tokenHash, now);
        if (isStudent) {
            return res.status(403).json({ success: false, message: "Administrator access is required." });
        }
        return res.status(401).json({ success: false, message: "Administrator authentication required." });
    } catch (error) {
        return next(error);
    }
}

module.exports = requireAdmin;
