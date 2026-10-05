const express = require("express");
const cors = require("cors");
const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const authRoutes = require("./routes/auth");
const studentRoutes = require("./routes/student");
const savedScholarshipRoutes = require("./routes/saved-scholarships");
const eligibilityRoutes = require("./routes/eligibility");
const recommendationRoutes = require("./routes/recommendations");
const applicationRoutes = require("./routes/applications");
const deadlineRoutes = require("./routes/deadlines");
const adminRoutes = require("./routes/admin");
const { getDatabase } = require("./database/database");
const { safeScholarship } = require("./services/eligibility-service");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.SCHOLARSYNC_HOST || "0.0.0.0";

// Keep the framework name out of response headers.
app.disable("x-powered-by");

// CORS: the local frontend opens from file:// or a local static server, so the
// default stays open for this local project. Set SCHOLARSYNC_CORS_ORIGINS
// (comma-separated list) to restrict browser access to explicit origins.
const corsOrigins = process.env.SCHOLARSYNC_CORS_ORIGINS
    ? process.env.SCHOLARSYNC_CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : null;
app.use(cors(corsOrigins ? { origin: corsOrigins } : {}));
app.use(express.json({ limit: "32kb" }));

// C program location (SCHOLARSYNC_C_PROGRAM overrides it for controlled tests/deployments)
const cProgram = process.env.SCHOLARSYNC_C_PROGRAM || path.join(
    __dirname,
    "..",
    "..",
    "ScholarSync.exe"
);

// Home route
app.get("/", (req, res) => {
    res.send("ScholarSync Backend is running!");
});

// API test
app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "ScholarSync API is connected!"
    });
});

// SQLite is the single authoritative scholarship catalog for the web application.
// Browsing, eligibility, recommendations, saved, applications, deadlines and admin
// all read these rows, so admin changes appear in every web view at once.
app.get("/api/scholarships", (req, res, next) => {
    try {
        const scholarships = getDatabase()
            .prepare("SELECT * FROM scholarships ORDER BY scholarship_id")
            .all()
            .map(safeScholarship);
        return res.json({ success: true, scholarships });
    } catch (error) {
        return next(error);
    }
});

// Legacy bridge kept for the C integration: the executable catalog under its own
// path. The web catalog never depends on it, so a C failure stays controlled.
// The executable path comes only from the environment (SCHOLARSYNC_C_PROGRAM);
// request input never reaches it, the arguments are fixed, and no shell is used.
// The timeout and output cap stop a hung or runaway C process from blocking the
// server; SCHOLARSYNC_C_TIMEOUT_MS overrides the wait for controlled tests.
const C_TIMEOUT_MS = (() => {
    const configured = Number(process.env.SCHOLARSYNC_C_TIMEOUT_MS);
    return Number.isFinite(configured) && configured >= 100 && configured <= 60000
        ? Math.floor(configured)
        : 10000;
})();
const C_MAX_BUFFER = 1024 * 1024;

app.get("/api/c/scholarships", (req, res) => {
    execFile(
        cProgram,
        ["--api", "scholarships"],
        {
            windowsHide: true,
            cwd: path.join(__dirname, "..", ".."),
            timeout: C_TIMEOUT_MS,
            maxBuffer: C_MAX_BUFFER
        },
        (error, stdout, stderr) => {
            if (error) {
                console.error("C program error:", error.message || String(error));
                if (stderr) console.error(String(stderr).slice(0, 2000));
                if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
                    return res.status(500).json({
                        success: false,
                        message: "Invalid data received from C program."
                    });
                }
                if (error.killed || error.signal || error.code === "ETIMEDOUT") {
                    return res.status(500).json({
                        success: false,
                        message: "The C program took too long to respond."
                    });
                }
                return res.status(500).json({
                    success: false,
                    message: "Unable to load scholarships from C program."
                });
            }
            let parsed;
            try {
                parsed = JSON.parse(stdout);
            } catch (parseError) {
                console.error("JSON parsing error:", parseError.message);
                console.error("C output:", String(stdout).slice(0, 500));
                return res.status(500).json({
                    success: false,
                    message: "Invalid data received from C program."
                });
            }
            const validShape = Array.isArray(parsed) &&
                parsed.every((row) => row !== null && typeof row === "object" && !Array.isArray(row));
            if (!validShape) {
                console.error("C program returned an unexpected JSON shape.");
                return res.status(500).json({
                    success: false,
                    message: "Invalid data received from C program."
                });
            }
            return res.json({ success: true, source: "c-executable", scholarships: parsed });
        }
    );
});

app.use("/api/auth", authRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/saved-scholarships", savedScholarshipRoutes);
app.use("/api/scholarships", eligibilityRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/deadlines", deadlineRoutes);
app.use("/api/admin", adminRoutes);

// Unknown API paths answer with the same JSON envelope as every other API error.
app.use("/api", (req, res) => {
    res.status(404).json({ success: false, message: "API endpoint was not found." });
});

// Keep all API errors in JSON and avoid returning internal database details.
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error && error.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "Request body must contain valid JSON." });
    }
    if (error && error.type === "entity.too.large") {
        return res.status(413).json({ success: false, message: "Request body is too large." });
    }
    console.error("Request failed:", error && error.message ? error.message : "unknown error");
    return res.status(500).json({ success: false, message: "An unexpected server error occurred." });
});

if (require.main === module) {
    try {
        require("./database/database").getDatabase();
        app.listen(PORT, HOST, () => {
            console.log(`ScholarSync backend: http://localhost:${PORT}`);
            if (HOST === "0.0.0.0" || HOST === "::") {
                const addresses = Object.values(os.networkInterfaces()).flat().filter((item) =>
                    item && item.family === "IPv4" && !item.internal
                );
                for (const item of addresses) console.log(`Same-network API: http://${item.address}:${PORT}`);
            }
        });
    } catch (error) {
        console.error("ScholarSync backend could not initialize its database.");
        process.exitCode = 1;
    }
}

module.exports = { app };





