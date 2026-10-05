const { findSession } = require("../services/auth-service");

function requireAuth(req, res, next) {
    const header = req.get("authorization");
    const match = typeof header === "string" && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
    if (!match) {
        return res.status(401).json({ success: false, message: "Authentication required." });
    }

    try {
        const session = findSession(match[1]);
        if (!session) {
            return res.status(401).json({ success: false, message: "Authentication required." });
        }
        req.auth = session;
        return next();
    } catch (error) {
        return next(error);
    }
}

module.exports = requireAuth;
