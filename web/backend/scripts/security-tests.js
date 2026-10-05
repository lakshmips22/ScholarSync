"use strict";
// ---------------------------------------------------------------------------
// ScholarSync Phase 5 - security & error-hardening suite.
//
// Run from web/backend with:  npm test      (or: node scripts/security-tests.js)
//
// Safety: the suite never touches the real database or backup folder. It
// copies database/scholarsync.sqlite into a temp folder, seeds throwaway
// accounts there, starts dedicated backend instances on random localhost
// ports with SCHOLARSYNC_DATABASE_PATH pointed at the copy, drives them
// over HTTP, and deletes the temp folder at the end.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require(path.join(__dirname, "..", "services", "auth-service"));

const BACKEND_DIR = path.join(__dirname, "..");
const PROJECT_ROOT = path.join(BACKEND_DIR, "..", "..");
const SOURCE_DB = path.join(BACKEND_DIR, "database", "scholarsync.sqlite");
const FRONTEND_DIR = path.join(BACKEND_DIR, "..", "frontend");
const REAL_EXE = path.join(PROJECT_ROOT, "ScholarSync.exe");
const FIXTURE_SRC = path.join(__dirname, "fixtures", "c_behavior_fixture.c");

const RUN_ID = Date.now().toString(36);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

let passed = 0;
const failures = [];
const children = [];
let tmpDir;
let dbPath;
let backupDir;
let testDb;
let staticHandle;
let gccAvailable = false;
const fakePrograms = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256hex = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

async function t(name, run) {
    try {
        await run();
        passed += 1;
        console.log(`  PASS  ${name}`);
    } catch (error) {
        failures.push({ name, reason: error && error.message });
        console.log(`  FAIL  ${name}\n          ${error && error.message}`);
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function expectStatus(res, status, context) {
    assert(res.status === status, `${context}: expected HTTP ${status}, got ${res.status} - ${res.text.slice(0, 160)}`);
}

function expectFailureJson(res, context) {
    assert(res.json && res.json.success === false && typeof res.json.message === "string" && res.json.message.length > 0,
        `${context}: expected {"success":false,"message":"..."} JSON, got - ${res.text.slice(0, 160)}`);
}

async function call(port, pathname, { method = "GET", token, body, raw, headers = {} } = {}) {
    const sendHeaders = { ...headers };
    if (token) sendHeaders.authorization = `Bearer ${token}`;
    let payload;
    if (raw !== undefined) {
        if (!sendHeaders["content-type"]) sendHeaders["content-type"] = "application/json";
        payload = raw;
    } else if (body !== undefined) {
        sendHeaders["content-type"] = "application/json";
        payload = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: sendHeaders, body: payload });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON answers are inspected as text */ }
    return { status: response.status, headers: response.headers, json, text };
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();
            probe.close(() => resolve(port));
        });
    });
}

async function startServer(label, extraEnv = {}) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        const port = await getFreePort();
        const child = spawn(process.execPath, ["server.js"], {
            cwd: BACKEND_DIR,
            windowsHide: true,
            env: {
                ...process.env,
                PORT: String(port),
                SCHOLARSYNC_DATABASE_PATH: dbPath,
                SCHOLARSYNC_BACKUP_DIR: backupDir,
                ...extraEnv
            }
        });
        children.push(child);
        let output = "";
        const record = (chunk) => { if (output.length < 4000000) output += String(chunk); };
        child.stdout.on("data", record);
        child.stderr.on("data", record);
        let exitCode = null;
        child.on("exit", (code) => { exitCode = code; });
        const deadline = Date.now() + 20000;
        while (Date.now() >= 0 && Date.now() < deadline && exitCode === null) {
            try {
                const ready = await call(port, "/api/test");
                if (ready.status === 200) return { port, label, child, output: () => output };
            } catch { /* not listening yet */ }
            await sleep(200);
        }
        child.kill();
        if (attempt < 3 && exitCode !== null) continue;
        throw new Error(`${label}: backend did not become ready (exit=${exitCode})\n${output.slice(-800)}`);
    }
    throw new Error("unreachable");
}

function startStaticFrontend() {
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    const server = http.createServer((req, res) => {
        const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
        const filePath = path.join(FRONTEND_DIR, path.normalize(requested));
        if (!filePath.startsWith(FRONTEND_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
    });
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, server })));
}

function compileFixtures() {
    const modes = { garbage: null, shape: "SS_MODE_SHAPE", flood: "SS_MODE_FLOOD", hang: "SS_MODE_HANG", exitfail: "SS_MODE_EXITFAIL" };
    for (const [name, define] of Object.entries(modes)) {
        const exe = path.join(tmpDir, `ss-${name}.exe`);
        const args = [FIXTURE_SRC, "-O2", "-o", exe];
        if (define) args.unshift(`-D${define}`);
        const result = spawnSync("gcc", args, { windowsHide: true, encoding: "utf8" });
        if (result.error || result.status !== 0) {
            console.log(`  note  gcc cannot build the controlled C fixtures (${result.error ? result.error.message : String(result.stderr).slice(0, 120)}); those tests will be skipped`);
            gccAvailable = false;
            return;
        }
        fakePrograms[name] = exe;
    }
    gccAvailable = true;
}

function studentPayload(tag, overrides = {}) {
    return {
        name: `Phase5 Student ${tag}`,
        email: `phase5.${tag.toLowerCase()}.${RUN_ID}@example.com`,
        password: `Phase5-Student!${tag}`,
        course: "Computer Science",
        annual_income: 150000,
        category: "General",
        state: "Karnataka",
        gender: "Female",
        disability: "No",
        cgpa: 8.2,
        ...overrides
    };
}

function scholarshipPayload(overrides = {}) {
    return {
        name: "Phase5 Automated Test Scholarship",
        provider: "Phase5 Test Provider",
        description: "Created and removed by the security test suite.",
        amount: 50000,
        minimum_income: -1,
        deadline: "2027-06-30",
        eligible_course: "Any",
        eligible_category: "Any",
        eligible_state: "Any",
        eligible_gender: "Any",
        disability_required: "Any",
        category: "Merit",
        minimum_cgpa: 0,
        ...overrides
    };
}

const ADMIN_USER = `phase5-admin-${RUN_ID}`;
const ADMIN_PASS = "Phase5-Admin!42";
const VIEWER_USER = `phase5-viewer-${RUN_ID}`;
const VIEWER_PASS = "Phase5-Viewer!42";

const adminLogin = (port, username = ADMIN_USER, password = ADMIN_PASS) =>
    call(port, "/api/admin/login", { method: "POST", body: { username, password } });
const studentLogin = (port, credentials) =>
    call(port, "/api/auth/login", { method: "POST", body: { email: credentials.email, password: credentials.password } });

async function main() {
    console.log("ScholarSync Phase 5 security & error-hardening suite");
    console.log(`Run id ${RUN_ID} - the live database, backups and C executable are never harmed.\n`);

    // ---- workspace ----------------------------------------------------------
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scholarsync-security-"));
    dbPath = path.join(tmpDir, "database", "scholarsync.sqlite");
    backupDir = path.join(tmpDir, "backups");
    const blockedBackup = path.join(tmpDir, "backup-dir-is-a-file");
    fs.writeFileSync(blockedBackup, "this regular file blocks the backup directory");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(SOURCE_DB + suffix)) fs.copyFileSync(SOURCE_DB + suffix, dbPath + suffix);
    }
    testDb = new DatabaseSync(dbPath, { timeout: 5000 });

    // Seed throwaway accounts into the copy before any server starts.
    testDb.prepare("INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'admin')")
        .run(ADMIN_USER, await hashPassword(ADMIN_PASS));
    const viewerId = Number(testDb.prepare("INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'viewer')")
        .run(VIEWER_USER, await hashPassword(VIEWER_PASS)).lastInsertRowid);
    const viewerSessionToken = randomToken();
    testDb.prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
        .run(sha256hex(viewerSessionToken), viewerId, Math.floor(Date.now() / 1000) + 3600);

    compileFixtures();
    staticHandle = await startStaticFrontend();

    const serverMain = await startServer("main");
    const serverBackupFail = await startServer("backup-fail", { SCHOLARSYNC_BACKUP_DIR: blockedBackup });
    const serverCors = await startServer("cors", { SCHOLARSYNC_CORS_ORIGINS: "http://127.0.0.1:5500,http://localhost:5500" });
    const cServers = { missing: await startServer("c-missing", { SCHOLARSYNC_C_PROGRAM: path.join(tmpDir, "no-such-program.exe") }) };
    if (gccAvailable) {
        cServers.garbage = await startServer("c-garbage", { SCHOLARSYNC_C_PROGRAM: fakePrograms.garbage });
        cServers.shape = await startServer("c-shape", { SCHOLARSYNC_C_PROGRAM: fakePrograms.shape });
        cServers.flood = await startServer("c-flood", { SCHOLARSYNC_C_PROGRAM: fakePrograms.flood });
        cServers.hang = await startServer("c-hang", { SCHOLARSYNC_C_PROGRAM: fakePrograms.hang, SCHOLARSYNC_C_TIMEOUT_MS: "800" });
        cServers.exitfail = await startServer("c-exitfail", { SCHOLARSYNC_C_PROGRAM: fakePrograms.exitfail });
    }
    const port = serverMain.port;
    console.log(`  note  main backend on 127.0.0.1:${port}, controlled backends for C/backup/CORS started\n`);

    // ---- shared state -------------------------------------------------------
    const studentA = studentPayload("A");
    const studentB = studentPayload("B");
    const sqlName = "Robert'); DROP TABLE students;--";
    let tokenA, tokenB, adminToken, studentAId, applicationAId, documentAId, firstScholarshipId, secondScholarshipId;
    let catalogNames = new Set();

    // =========================================================================
    console.log("A. Baseline, headers and error envelope");
    await t("A1 GET /api/test answers 200", async () => {
        const res = await call(port, "/api/test");
        expectStatus(res, 200, "api test");
        assert(res.json && res.json.success === true, "unexpected api test payload");
    });
    await t("A2 X-Powered-By header is not sent", async () => {
        const res = await call(port, "/api/test");
        assert(!res.headers.has("x-powered-by"), "x-powered-by header present");
    });
    await t("A3 unknown API paths and methods answer JSON 404", async () => {
        const missing = await call(port, "/api/definitely-not-a-route");
        expectStatus(missing, 404, "unknown GET");
        expectFailureJson(missing, "unknown GET");
        const wrongMethod = await call(port, "/api/test", { method: "PUT" });
        expectStatus(wrongMethod, 404, "wrong method");
        expectFailureJson(wrongMethod, "wrong method");
    });
    await t("A4 malformed JSON answers 400 with a friendly message", async () => {
        const res = await call(port, "/api/auth/login", { method: "POST", raw: '{"email":' });
        expectStatus(res, 400, "malformed json");
        assert(/valid JSON/i.test(res.text), res.text.slice(0, 120));
    });
    await t("A5 oversized body answers 413", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", raw: JSON.stringify({ name: "x".repeat(40000) }) });
        expectStatus(res, 413, "oversized body");
        expectFailureJson(res, "oversized body");
    });
    await t("A6 non-object JSON body is rejected", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: [] });
        expectStatus(res, 400, "array body");
    });

    // =========================================================================
    console.log("B. Registration, login and password handling");
    await t("B1 register student A without leaking credentials", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentA });
        expectStatus(res, 201, "register A");
        assert(res.json.user && res.json.user.student_id, "no user object in register response");
        studentAId = res.json.user.student_id;
        assert(!res.text.includes("password_hash") && !res.text.includes("P1$") && !res.text.includes(studentA.password),
            "register response leaks credentials");
    });
    await t("B2 register student B", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentB });
        expectStatus(res, 201, "register B");
    });
    await t("B3 duplicate email answers 409 with a clear message", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentA });
        expectStatus(res, 409, "duplicate email");
        assert(/already exists/i.test(res.text), res.text.slice(0, 120));
    });
    await t("B4 short password rejected", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Short", { password: "abc1234" }) });
        expectStatus(res, 400, "short password");
        assert(res.json.errors && res.json.errors.password, "errors.password missing");
    });
    await t("B5 invalid email rejected", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Badmail", { email: "not-an-email" }) });
        expectStatus(res, 400, "invalid email");
    });
    await t("B6 name length boundaries (99 bytes ok, 100 bytes rejected)", async () => {
        const ok = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Len99", { name: "p5-" + "a".repeat(96) }) });
        expectStatus(ok, 201, "99-byte name");
        const tooLong = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Len100", { name: "p5-" + "a".repeat(97) }) });
        expectStatus(tooLong, 400, "100-byte name");
    });
    await t("B7 disability enum enforced", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Disab", { disability: "Maybe" }) });
        expectStatus(res, 400, "disability enum");
    });
    await t("B8 numeric ranges rejected (cgpa>10, negative income, string cgpa)", async () => {
        const cgpa = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("CgpaHi", { cgpa: 10.5 }) });
        expectStatus(cgpa, 400, "cgpa 10.5");
        const income = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("IncomeNeg", { annual_income: -1 }) });
        expectStatus(income, 400, "negative income");
        const strCgpa = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("CgpaStr", { cgpa: "8.5" }) });
        expectStatus(strCgpa, 400, "string cgpa");
    });
    await t("B9 client-supplied student_id cannot impersonate another account", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Extra", { student_id: 1 }) });
        expectStatus(res, 201, "register with extra field");
        assert(res.json.user.student_id !== 1 && res.json.user.student_id !== studentAId, "client controlled the student_id");
    });
    await t("B10 SQL-injection payload stores as harmless data", async () => {
        const res = await call(port, "/api/auth/register", { method: "POST", body: studentPayload("Sqli", { name: sqlName }) });
        expectStatus(res, 201, "sql name register");
    });
    await t("B11 failed logins are indistinguishable (no user enumeration)", async () => {
        const wrong = await studentLogin(port, { email: studentA.email, password: "Wrong-Password!9" });
        expectStatus(wrong, 401, "wrong password");
        const ghost = await studentLogin(port, { email: `ghost.${RUN_ID}@example.com`, password: "Wrong-Password!9" });
        expectStatus(ghost, 401, "unknown user");
        assert(wrong.json.message === ghost.json.message, "login answers differ, leaking user existence");
    });
    await t("B12 login injection payload never reaches SQL (401/400, not 500)", async () => {
        const res = await studentLogin(port, { email: "x'or'1'='1@example.com", password: "whatever123" });
        assert(res.status === 400 || res.status === 401, `expected 400/401, got ${res.status}: ${res.text.slice(0, 120)}`);
    });
    await t("B13 login returns a well-formed bearer token and future expiry", async () => {
        const login = await studentLogin(port, studentA);
        expectStatus(login, 200, "login A");
        tokenA = login.json.token;
        assert(TOKEN_PATTERN.test(String(tokenA)), `unexpected token format: ${String(tokenA).slice(0, 12)}...`);
        assert(new Date(login.json.expires_at).getTime() > Date.now(), "expires_at not in the future");
        assert(!login.text.includes("password_hash") && !login.text.includes(studentA.password), "login response leaks credentials");
    });
    await t("B14 second student can log in", async () => {
        const login = await studentLogin(port, studentB);
        expectStatus(login, 200, "login B");
        tokenB = login.json.token;
    });

    // =========================================================================
    console.log("C. Session handling and authentication guards");
    await t("C1 /auth/me returns the own session only", async () => {
        const res = await call(port, "/api/auth/me", { token: tokenA });
        expectStatus(res, 200, "me");
        assert(res.json.user && res.json.user.email === studentA.email, "me returned a different account");
    });
    await t("C2 protected endpoint without any token answers 401", async () => {
        const res = await call(port, "/api/student/profile");
        expectStatus(res, 401, "no token");
        expectFailureJson(res, "no token");
        assert(res.json.message === "Authentication required.", res.json.message);
    });
    await t("C3 wrong auth scheme answers 401", async () => {
        const res = await call(port, "/api/auth/me", { headers: { authorization: `Token ${tokenA}` } });
        expectStatus(res, 401, "wrong scheme");
    });
    await t("C4 forged well-formed token is unknown to the database", async () => {
        const res = await call(port, "/api/auth/me", { token: randomToken() });
        expectStatus(res, 401, "forged token");
    });
    await t("C5 expired session is rejected", async () => {
        const expiredToken = randomToken();
        testDb.prepare("INSERT INTO auth_sessions (token_hash, student_id, expires_at) VALUES (?, ?, ?)")
            .run(sha256hex(expiredToken), studentAId, Math.floor(Date.now() / 1000) - 60);
        const res = await call(port, "/api/auth/me", { token: expiredToken });
        expectStatus(res, 401, "expired session");
    });
    await t("C6 token is unusable after logout, others stay valid", async () => {
        const second = await studentLogin(port, studentA);
        expectStatus(second, 200, "second login");
        const loggedOut = await call(port, "/api/auth/logout", { method: "POST", token: second.json.token });
        expectStatus(loggedOut, 200, "logout");
        const reuse = await call(port, "/api/auth/me", { token: second.json.token });
        expectStatus(reuse, 401, "reusing logged-out token");
        const stillValid = await call(port, "/api/auth/me", { token: tokenA });
        expectStatus(stillValid, 200, "first token after logging out another");
    });
    await t("C7 database stores only SHA-256 session hashes, never raw tokens", async () => {
        const row = testDb.prepare("SELECT token_hash FROM auth_sessions WHERE token_hash = ?").get(sha256hex(tokenA));
        assert(row, "session row for the SHA-256 token hash was not found");
        assert(row.token_hash !== tokenA && row.token_hash.length === 64, "raw token stored");
    });

    // =========================================================================
    console.log("D. Ownership, IDOR and validation limits");
    await t("D1 public scholarship catalog is consistent", async () => {
        const res = await call(port, "/api/scholarships");
        expectStatus(res, 200, "catalog");
        assert(Array.isArray(res.json.scholarships) && res.json.scholarships.length === 10, `expected 10 scholarships, got ${res.json.scholarships && res.json.scholarships.length}`);
        firstScholarshipId = res.json.scholarships[0].scholarship_id;
        secondScholarshipId = res.json.scholarships[1].scholarship_id;
        catalogNames = new Set(res.json.scholarships.map((s) => s.name));
    });
    await t("D2 student creates an application (Pending, deadline reported)", async () => {
        const res = await call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: firstScholarshipId } });
        expectStatus(res, 201, "apply");
        assert(res.json.application.status === "Pending", `expected Pending, got ${res.json.application.status}`);
        assert(typeof res.json.deadline_status === "string", "deadline_status missing");
        applicationAId = res.json.application.application_id;
    });
    await t("D3 duplicate application answers 409", async () => {
        const res = await call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: firstScholarshipId } });
        expectStatus(res, 409, "duplicate application");
        assert(/already have an application/i.test(res.text), res.text.slice(0, 120));
    });
    await t("D4 client-supplied student_id on an application is refused", async () => {
        const res = await call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: secondScholarshipId, student_id: studentAId } });
        expectStatus(res, 400, "student_id injection");
        assert(/student identity comes from authentication/i.test(res.text), res.text.slice(0, 140));
    });
    await t("D5 unknown scholarship id answers 404", async () => {
        const res = await call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: 999999 } });
        expectStatus(res, 404, "unknown scholarship");
    });
    await t("D6 students only ever see their own applications", async () => {
        const ownA = await call(port, "/api/applications", { token: tokenA });
        expectStatus(ownA, 200, "list A");
        assert(ownA.json.applications.length === 1, `student A should have 1 application, has ${ownA.json.applications.length}`);
        const ownB = await call(port, "/api/applications", { token: tokenB });
        assert(ownB.json.applications.length === 0, "student B sees someone else's application");
    });
    await t("D7 IDOR: student B cannot read or change A's records (404)", async () => {
        const get = await call(port, `/api/applications/${applicationAId}`, { token: tokenB });
        expectStatus(get, 404, "B reads A application");
        const patch = await call(port, `/api/applications/${applicationAId}/status`, { method: "PUT", token: tokenB, body: { status: "Pending" } });
        expectStatus(patch, 404, "B patches A application");
        const docs = await call(port, `/api/applications/${applicationAId}/documents`, { token: tokenB });
        expectStatus(docs, 404, "B lists A documents");
    });
    await t("D8 review statuses are admin-only for students (403/400)", async () => {
        const approve = await call(port, `/api/applications/${applicationAId}/status`, { method: "PUT", token: tokenA, body: { status: "Approved" } });
        expectStatus(approve, 403, "self-approve");
        assert(/administrator/i.test(approve.text), approve.text.slice(0, 140));
        const pending = await call(port, `/api/applications/${applicationAId}/status`, { method: "PUT", token: tokenA, body: { status: "Pending" } });
        expectStatus(pending, 403, "student status change to Pending is also admin-controlled");
        const junk = await call(port, `/api/applications/${applicationAId}/status`, { method: "PUT", token: tokenA, body: { status: "Junk" } });
        expectStatus(junk, 400, "junk status");
    });

    await t("D9 documents: create, list and reviewer-only statuses", async () => {
        const created = await call(port, `/api/applications/${applicationAId}/documents`, { method: "POST", token: tokenA, body: { document_name: "Income Certificate" } });
        expectStatus(created, 201, "create document");
        assert(created.json.document.status === "Pending", `new document status was ${created.json.document.status}`);
        documentAId = created.json.document.document_id;
        const list = await call(port, `/api/applications/${applicationAId}/documents`, { token: tokenA });
        assert(list.json.documents.length === 1, "document list wrong");
        const verify = await call(port, `/api/applications/${applicationAId}/documents/${documentAId}`, { method: "PUT", token: tokenA, body: { status: "Verified" } });
        expectStatus(verify, 403, "student sets Verified");
        assert(/reviewer/i.test(verify.text), verify.text.slice(0, 140));
        const junk = await call(port, `/api/applications/${applicationAId}/documents/${documentAId}`, { method: "PUT", token: tokenA, body: { status: "Junk" } });
        expectStatus(junk, 400, "junk document status");
        const submit = await call(port, `/api/applications/${applicationAId}/documents/${documentAId}`, { method: "PUT", token: tokenA, body: { status: "Submitted" } });
        expectStatus(submit, 200, "student marks Submitted");
    });
    await t("D10 document byte limit and unknown-field rejection", async () => {
        const tooLong = await call(port, `/api/applications/${applicationAId}/documents/${documentAId}`, { method: "PUT", token: tokenA, body: { document_name: "a".repeat(201) } });
        expectStatus(tooLong, 400, "201-byte document name");
        assert(/200 bytes/.test(tooLong.text), "byte-limit message missing");
        const sneaky = await call(port, `/api/applications/${applicationAId}/documents`, { method: "POST", token: tokenA, body: { document_name: "ok", file_path: "../../windows/win.ini" } });
        expectStatus(sneaky, 400, "unknown document field");
    });
    await t("D11 saved list is strictly per-student", async () => {
        const saved = await call(port, `/api/saved-scholarships/${firstScholarshipId}`, { method: "POST", token: tokenA });
        assert(saved.status === 200 || saved.status === 201, `save answered ${saved.status}`);
        const ownStatus = await call(port, `/api/saved-scholarships/${firstScholarshipId}/status`, { token: tokenA });
        assert(ownStatus.json.saved === true, "A does not see own save");
        const otherStatus = await call(port, `/api/saved-scholarships/${firstScholarshipId}/status`, { token: tokenB });
        assert(otherStatus.json.saved === false, "B sees A's saved entry");
        const otherDelete = await call(port, `/api/saved-scholarships/${firstScholarshipId}`, { method: "DELETE", token: tokenB });
        expectStatus(otherDelete, 404, "B deletes A's saved entry");
        const removed = await call(port, `/api/saved-scholarships/${firstScholarshipId}`, { method: "DELETE", token: tokenA });
        expectStatus(removed, 200, "A deletes own saved entry");
        const again = await call(port, `/api/saved-scholarships/${firstScholarshipId}`, { method: "DELETE", token: tokenA });
        expectStatus(again, 404, "double delete");
    });
    await t("D12 profile edits are validated and scoped to the owner", async () => {
        const ok = await call(port, "/api/student/profile", { method: "PUT", token: tokenA, body: { cgpa: 9.1 } });
        expectStatus(ok, 200, "profile edit");
        const after = await call(port, "/api/student/profile", { token: tokenA });
        assert(after.json.user.cgpa === 9.1, "profile edit did not stick");
        assert(!after.text.includes("password_hash") && !after.text.includes("P1$"), "profile leaks credentials");
        const badCgpa = await call(port, "/api/student/profile", { method: "PUT", token: tokenA, body: { cgpa: 10.5 } });
        expectStatus(badCgpa, 400, "cgpa 10.5");
        const badIncome = await call(port, "/api/student/profile", { method: "PUT", token: tokenA, body: { annual_income: -5 } });
        expectStatus(badIncome, 400, "negative income");
        const impersonate = await call(port, "/api/student/profile", { method: "PUT", token: tokenA, body: { student_id: 1 } });
        expectStatus(impersonate, 400, "profile student_id injection");
    });
    await t("D13 deadline overview covers every scholarship", async () => {
        const res = await call(port, "/api/deadlines", { token: tokenA });
        expectStatus(res, 200, "deadlines");
        const total = res.json.counts.upcoming + res.json.counts.expired + res.json.counts.unknown;
        assert(total === 10, `expected 10 deadline rows, got ${total}`);
    });

    // =========================================================================
    console.log("E. Eligibility and recommendations");
    await t("E1 eligibility check answers for a real scholarship", async () => {
        const res = await call(port, `/api/scholarships/${firstScholarshipId}/eligibility`, { token: tokenA });
        expectStatus(res, 200, "eligibility");
        assert(res.json.success === true, "eligibility success flag missing");
    });
    await t("E2 injection in the scholarship path segment is refused", async () => {
        const res = await call(port, `/api/scholarships/${encodeURIComponent("101 OR 1=1")}/eligibility`, { token: tokenA });
        expectStatus(res, 400, "path injection");
    });
    await t("E3 eligibility and recommendations require authentication", async () => {
        const eligibility = await call(port, `/api/scholarships/${firstScholarshipId}/eligibility`);
        expectStatus(eligibility, 401, "eligibility without token");
        const recommendations = await call(port, "/api/recommendations");
        expectStatus(recommendations, 401, "recommendations without token");
    });
    await t("E4 recommendations answer for a complete profile", async () => {
        const res = await call(port, "/api/recommendations", { token: tokenA });
        expectStatus(res, 200, "recommendations");
        assert(res.json.success === true && typeof res.json.profile_complete === "boolean", "recommendations payload wrong");
    });

    // =========================================================================
    console.log("F. Admin authentication and privilege separation");
    await t("F1 admin endpoints reject anonymous and student tokens", async () => {
        const anonymous = await call(port, "/api/admin/dashboard");
        expectStatus(anonymous, 401, "anonymous dashboard");
        assert(/Administrator/i.test(anonymous.text), anonymous.text.slice(0, 120));
        const asStudent = await call(port, "/api/admin/dashboard", { token: tokenA });
        expectStatus(asStudent, 403, "student token on admin route");
        assert(/Administrator access is required/i.test(asStudent.text), asStudent.text.slice(0, 120));
    });
    await t("F2 admin login: wrong and unknown answers match; viewer cannot log in", async () => {
        const wrong = await adminLogin(port, ADMIN_USER, "Wrong-Admin!9");
        expectStatus(wrong, 401, "wrong admin password");
        const unknown = await adminLogin(port, `ghost-admin-${RUN_ID}`, ADMIN_PASS);
        expectStatus(unknown, 401, "unknown admin user");
        assert(wrong.json.message === unknown.json.message, "admin login leaks user existence");
        const viewer = await adminLogin(port, VIEWER_USER, VIEWER_PASS);
        expectStatus(viewer, 401, "viewer role login");
    });
    await t("F3 admin login issues a token without leaking the hash", async () => {
        const res = await adminLogin(port);
        expectStatus(res, 200, "admin login");
        adminToken = res.json.token;
        assert(TOKEN_PATTERN.test(String(adminToken)), "admin token format");
        assert(res.json.admin && res.json.admin.role === "admin", "admin role missing");
        assert(!res.text.includes("password_hash") && !res.text.includes("P1$") && !res.text.includes(ADMIN_PASS), "admin login leaks credentials");
    });
    await t("F4 session tables are isolated between students and admins", async () => {
        const studentOnAdmin = await call(port, "/api/student/profile", { token: adminToken });
        expectStatus(studentOnAdmin, 401, "admin token on student route");
        const viewerOnAdmin = await call(port, "/api/admin/dashboard", { token: viewerSessionToken });
        expectStatus(viewerOnAdmin, 401, "viewer session on admin route");
    });
    await t("F5 expired and logged-out admin sessions stop working", async () => {
        const expiredAdminToken = randomToken();
        const adminRow = testDb.prepare("SELECT admin_id FROM admins WHERE username = ?").get(ADMIN_USER);
        testDb.prepare("INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
            .run(sha256hex(expiredAdminToken), Number(adminRow.admin_id), Math.floor(Date.now() / 1000) - 60);
        const expired = await call(port, "/api/admin/dashboard", { token: expiredAdminToken });
        expectStatus(expired, 401, "expired admin session");
        const second = await adminLogin(port);
        expectStatus(second, 200, "second admin login");
        const logout = await call(port, "/api/admin/logout", { method: "POST", token: second.json.token });
        expectStatus(logout, 200, "admin logout");
        const reuse = await call(port, "/api/admin/dashboard", { token: second.json.token });
        expectStatus(reuse, 401, "reuse after admin logout");
    });

    await t("F6 dashboard, lists and reports answer for the admin", async () => {
        const dashboard = await call(port, "/api/admin/dashboard", { token: adminToken });
        expectStatus(dashboard, 200, "dashboard");
        assert(dashboard.json.statistics, "statistics missing");
        const scholarships = await call(port, "/api/admin/scholarships", { token: adminToken });
        expectStatus(scholarships, 200, "admin scholarships");
        assert(scholarships.json.scholarships.length === 10, "admin scholarship list wrong");
        const students = await call(port, "/api/admin/students", { token: adminToken });
        expectStatus(students, 200, "admin students");
        assert(students.json.students.some((s) => s.name === sqlName), "SQL-injection name was not stored verbatim");
        assert(!students.text.includes("password_hash") && !students.text.includes("P1$"), "student list leaks credentials");
        const applications = await call(port, "/api/admin/applications", { token: adminToken });
        expectStatus(applications, 200, "admin applications");
        const reports = await call(port, "/api/admin/reports", { token: adminToken });
        expectStatus(reports, 200, "admin reports");
    });
    await t("F7 student search: injection safe, wildcards usable, size-capped", async () => {
        const injection = await call(port, `/api/admin/students?q=${encodeURIComponent("'; DROP TABLE students;--")}`, { token: adminToken });
        expectStatus(injection, 200, "search injection");
        const stillThere = await call(port, "/api/admin/students", { token: adminToken });
        assert(stillThere.json.students.some((s) => s.name === sqlName), "table was damaged by search injection");
        const wildcard = await call(port, `/api/admin/students?q=${encodeURIComponent("Comput%")}`, { token: adminToken });
        expectStatus(wildcard, 200, "wildcard search");
        assert(wildcard.json.students.length >= 1, "wildcard search found nothing");
        const tooLong = await call(port, `/api/admin/students?q=${"a".repeat(100)}`, { token: adminToken });
        expectStatus(tooLong, 400, "100-byte search");
        const doubled = await call(port, "/api/admin/students?q=a&q=b", { token: adminToken });
        expectStatus(doubled, 400, "doubled search parameter");
        assert(/single text value/i.test(doubled.text), doubled.text.slice(0, 120));
    });

    await t("F8 scholarship creation validates every field class", async () => {
        const badDate = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ deadline: "2027-13-01" }) });
        expectStatus(badDate, 400, "impossible date");
        const badIncome = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ minimum_income: -5 }) });
        expectStatus(badIncome, 400, "income below -1");
        const badCgpa = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ minimum_cgpa: 11 }) });
        expectStatus(badCgpa, 400, "minimum cgpa above 10");
        const badAmount = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ amount: -1 }) });
        expectStatus(badAmount, 400, "negative amount");
        const badDisability = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ disability_required: "No" }) });
        expectStatus(badDisability, 400, "disability_required No");
        const longName = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ name: "a".repeat(150) }) });
        expectStatus(longName, 400, "150-byte name");
        const pipe = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ provider: "Bad|Provider" }) });
        expectStatus(pipe, 400, "pipe in provider");
        const sneaky = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload({ scholarship_id: 999 }) });
        expectStatus(sneaky, 400, "unknown field");
        const total = await call(port, "/api/admin/scholarships", { token: adminToken });
        assert(total.json.scholarships.length === 10, "invalid payloads were stored");
    });
    await t("F9 scholarship create/update/delete round trip", async () => {
        const created = await call(port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload() });
        expectStatus(created, 201, "create scholarship");
        const id = created.json.scholarship.scholarship_id;
        const updated = await call(port, `/api/admin/scholarships/${id}`, { method: "PUT", token: adminToken, body: { name: "Phase5 Renamed Scholarship" } });
        expectStatus(updated, 200, "update scholarship");
        assert(updated.json.scholarship.name === "Phase5 Renamed Scholarship", "update did not apply");
        const empty = await call(port, `/api/admin/scholarships/${id}`, { method: "PUT", token: adminToken, body: {} });
        expectStatus(empty, 400, "empty update");
        const removed = await call(port, `/api/admin/scholarships/${id}`, { method: "DELETE", token: adminToken });
        expectStatus(removed, 200, "delete scholarship");
    });
    await t("F10 admin status flow works and is validated", async () => {
        const approved = await call(port, `/api/admin/applications/${applicationAId}/status`, { method: "PUT", token: adminToken, body: { status: "Approved" } });
        expectStatus(approved, 200, "admin approves");
        const junk = await call(port, `/api/admin/applications/${applicationAId}/status`, { method: "PUT", token: adminToken, body: { status: "Junk" } });
        expectStatus(junk, 400, "junk admin status");
        const studentView = await call(port, `/api/applications/${applicationAId}`, { token: tokenA });
        assert(studentView.json.application.status === "Approved", "student still sees the old status");
    });
    await t("F11 scholarship with applications cannot be deleted (409)", async () => {
        const res = await call(port, `/api/admin/scholarships/${firstScholarshipId}`, { method: "DELETE", token: adminToken });
        expectStatus(res, 409, "delete in-use scholarship");
    });
    await t("F12 admin sees documents on an application detail", async () => {
        const res = await call(port, `/api/admin/applications/${applicationAId}`, { token: adminToken });
        expectStatus(res, 200, "admin application detail");
        assert(Array.isArray(res.json.application.documents) && res.json.application.documents.length === 1, "documents missing from admin detail");
        assert(!res.text.includes("password_hash") && !res.text.includes("P1$"), "admin detail leaks credentials");
    });

    // =========================================================================
    console.log("G. Backups (success, traversal attempts, controlled failure)");
    await t("G1 backup succeeds and always uses a server-generated file name", async () => {
        const res = await call(port, "/api/admin/backup", { method: "POST", token: adminToken, body: { file_name: "../../../../evil-backup.sqlite" } });
        expectStatus(res, 201, "backup");
        const fileName = res.json.backup.file_name;
        assert(fileName.startsWith("scholarsync-") && fileName.endsWith(".sqlite") && !fileName.includes("..") && !fileName.includes("evil"),
            `backup name was controllable: ${fileName}`);
        assert(fs.existsSync(path.join(backupDir, fileName)), "backup file missing from the backup directory");
        assert(res.json.backup.size_bytes > 0, "empty backup reported");
        const stray = [];
        for (const entry of fs.readdirSync(tmpDir, { recursive: true })) {
            if (String(entry).includes("evil")) stray.push(String(entry));
        }
        assert(stray.length === 0, `path traversal wrote files outside the backup directory: ${stray.join(", ")}`);
        const files = fs.readdirSync(backupDir);
        assert(files.length === 1 && files[0] === fileName, "unexpected files in the backup directory");
    });
    await t("G2 unreadable backup destination answers a controlled 500", async () => {
        const login = await adminLogin(serverBackupFail.port);
        expectStatus(login, 200, "login on backup-fail server");
        const res = await call(serverBackupFail.port, "/api/admin/backup", { method: "POST", token: login.json.token });
        expectStatus(res, 500, "backup with blocked destination");
        expectFailureJson(res, "blocked backup");
        assert(!res.text.includes(tmpDir) && !res.text.includes("C:\\") && !/EPERM|EEXIST|ENOENT|\bat\s/i.test(res.text),
            `failure response leaks internals: ${res.text.slice(0, 200)}`);
    });
    await t("G3 backups require admin access", async () => {
        const anonymous = await call(port, "/api/admin/backup", { method: "POST" });
        expectStatus(anonymous, 401, "anonymous backup");
        const student = await call(port, "/api/admin/backup", { method: "POST", token: tokenA });
        expectStatus(student, 403, "student backup");
    });

    // =========================================================================
    console.log("H. Credential and token exposure");
    await t("H1 password hash format and no plaintext storage", async () => {
        const row = testDb.prepare("SELECT password_hash FROM students WHERE student_id = ?").get(studentAId);
        assert(/^P1\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(row.password_hash), "PBKDF2 hash format unexpected");
        assert(row.password_hash !== studentA.password, "plaintext password stored");
    });
    await t("H2 raw tokens and passwords appear nowhere in the database bytes", async () => {
        const bytes = [];
        for (const suffix of ["", "-wal", "-shm"]) {
            if (fs.existsSync(dbPath + suffix)) bytes.push(fs.readFileSync(dbPath + suffix).toString("latin1"));
        }
        const haystack = bytes.join("");
        for (const secret of [tokenA, tokenB, adminToken, studentA.password, ADMIN_PASS]) {
            assert(!haystack.includes(secret), `database contains the raw secret ${secret.slice(0, 6)}...`);
        }
    });
    await t("H3 server logs never print raw tokens or passwords", async () => {
        for (const server of [serverMain, serverBackupFail, serverCors]) {
            const logged = server.output();
            for (const secret of [tokenA, tokenB, adminToken, studentA.password, ADMIN_PASS]) {
                assert(!logged.includes(secret), `${server.label} log leaked ${secret.slice(0, 6)}...`);
            }
        }
    });

    // =========================================================================
    console.log("I. CORS policy");
    await t("I1 default policy stays open for this project", async () => {
        const res = await call(port, "/api/test");
        assert(res.headers.get("access-control-allow-origin") === "*", "default CORS header missing");
    });
    await t("I2 configured allow-list only echoes permitted origins", async () => {
        const allowed = await call(serverCors.port, "/api/test", { headers: { origin: "http://localhost:5500" } });
        assert(allowed.headers.get("access-control-allow-origin") === "http://localhost:5500", "allowed origin was not echoed");
        const denied = await call(serverCors.port, "/api/test", { headers: { origin: "http://evil.example" } });
        assert(!denied.headers.has("access-control-allow-origin"), "disallowed origin received an allow header");
        assert(denied.status === 200, "denied origin should still get the normal response");
    });

    // =========================================================================
    console.log("J. C program bridge resilience");
    const noLeak = (text) => !/ENOENT|spawn|EPERM|C:\\|work place|ScholarSync\.exe|\bat\s+\w/i.test(text);
    await t("J1 real C executable answers and matches the web catalog", async () => {
        const res = await call(port, "/api/c/scholarships");
        expectStatus(res, 200, "c bridge");
        assert(res.json.source === "c-executable", "wrong source marker");
        assert(Array.isArray(res.json.scholarships) && res.json.scholarships.length >= 10, "c catalog too small");
        const cNames = new Set(res.json.scholarships.map((s) => s.name));
        for (const name of catalogNames) assert(cNames.has(name), `C catalog is missing "${name}"`);
    });
    await t("J2 query parameters cannot redirect the bridge to another program", async () => {
        const res = await call(port, "/api/c/scholarships?program=../../../../Windows/System32/calc.exe");
        expectStatus(res, 200, "query injection on c bridge");
        assert(res.json.source === "c-executable", "query parameter influenced the program used");
    });
    await t("J3 missing C program gives the friendly load message", async () => {
        const res = await call(cServers.missing.port, "/api/c/scholarships");
        expectStatus(res, 500, "missing program");
        assert(res.json && res.json.message === "Unable to load scholarships from C program.", `unexpected message: ${res.text.slice(0, 160)}`);
        assert(noLeak(res.text), `message leaks internals: ${res.text.slice(0, 160)}`);
    });
    if (gccAvailable) {
        await t("J4 C program exiting with an error gives the same friendly message", async () => {
            const res = await call(cServers.exitfail.port, "/api/c/scholarships");
            expectStatus(res, 500, "exit-failure program");
            assert(res.json.message === "Unable to load scholarships from C program.", `unexpected message: ${res.text.slice(0, 160)}`);
            assert(noLeak(res.text), "message leaks internals");
        });
        await t("J5 C program printing garbage gives the invalid-data message", async () => {
            const res = await call(cServers.garbage.port, "/api/c/scholarships");
            expectStatus(res, 500, "garbage program");
            assert(res.json.message === "Invalid data received from C program.", `unexpected message: ${res.text.slice(0, 160)}`);
            assert(noLeak(res.text), "message leaks internals");
        });
        await t("J6 valid JSON with the wrong shape gives the invalid-data message", async () => {
            const res = await call(cServers.shape.port, "/api/c/scholarships");
            expectStatus(res, 500, "wrong-shape program");
            assert(res.json.message === "Invalid data received from C program.", `unexpected message: ${res.text.slice(0, 160)}`);
            assert(noLeak(res.text), "message leaks internals");
        });
        await t("J7 C program flooding more than 1 MB is capped safely", async () => {
            const res = await call(cServers.flood.port, "/api/c/scholarships");
            expectStatus(res, 500, "flood program");
            assert(res.json.message === "Invalid data received from C program.", `unexpected message: ${res.text.slice(0, 160)}`);
            assert(noLeak(res.text), "message leaks internals");
        });
        await t("J8 hanging C program hits the server-side timeout quickly", async () => {
            const started = Date.now();
            const res = await call(cServers.hang.port, "/api/c/scholarships");
            const elapsed = Date.now() - started;
            expectStatus(res, 500, "hanging program");
            assert(res.json.message === "The C program took too long to respond.", `unexpected message: ${res.text.slice(0, 160)}`);
            assert(elapsed < 8000, `timeout took ${elapsed} ms`);
            assert(noLeak(res.text), "message leaks internals");
        });
    } else {
        console.log("  SKIP  J4-J8 (gcc unavailable, controlled C fixtures could not be built)");
    }

    // =========================================================================
    console.log("K. Frontend pages and dead-code removal");
    await t("K1 every frontend page loads over the local static server", async () => {
        const files = fs.readdirSync(FRONTEND_DIR).filter((file) => /\.(html|js|css)$/.test(file));
        assert(files.includes("index.html") && files.includes("admin.html"), "expected frontend files are missing");
        for (const file of files) {
            const res = await call(staticHandle.port, `/${file}`);
            assert(res.status === 200, `${file} answered ${res.status}`);
        }
        const index = await call(staticHandle.port, "/");
        assert(index.text.includes("ScholarSync"), "index page content unexpected");
    });
    await t("K2 admin.html has no duplicate function declarations left", async () => {
        const html = fs.readFileSync(path.join(FRONTEND_DIR, "admin.html"), "utf8");
        const names = [...html.matchAll(/^\s*function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((match) => match[1]);
        const counts = new Map();
        for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
        const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
        assert(duplicates.length === 0, `duplicate function declarations: ${duplicates.map(([n]) => n).join(", ")}`);
    });
    await t("K3 no blocking alert/prompt/confirm dialogs remain in the frontend", async () => {
        const offenders = [];
        for (const file of fs.readdirSync(FRONTEND_DIR).filter((f) => /\.(html|js)$/.test(f))) {
            const source = fs.readFileSync(path.join(FRONTEND_DIR, file), "utf8");
            if (/(^|[^.\w])(alert|prompt)\s*\(/.test(source) || /(^|[^.\w])confirm\s*\(/.test(source) ||
                /window\.(alert|prompt|confirm)\s*\(/.test(source)) {
                offenders.push(file);
            }
        }
        assert(offenders.length === 0, `legacy dialogs remain in: ${offenders.join(", ")}`);
    });

    // =========================================================================
    console.log("L. Database integrity after the whole suite");
    await t("L1 schema version and integrity check pass", async () => {
        assert(testDb.prepare("PRAGMA user_version").get().user_version === 3, "schema version drifted");
        assert(testDb.prepare("PRAGMA integrity_check").get().integrity_check === "ok", "integrity_check failed");
    });
    await t("L2 all tables survive the injection attempts", async () => {
        const tables = new Set(testDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
        for (const required of ["students", "scholarships", "applications", "documents", "admins", "saved_scholarships", "auth_sessions", "admin_sessions"]) {
            assert(tables.has(required), `table ${required} is gone`);
        }
        assert(testDb.prepare("SELECT COUNT(*) AS c FROM scholarships").get().c === 10, "scholarship count drifted");
        assert(testDb.prepare("SELECT COUNT(*) AS c FROM students").get().c >= 6, "student rows vanished");
    });
    await t("L3 injection text is still stored verbatim as data", async () => {
        const row = testDb.prepare("SELECT name FROM students WHERE email LIKE 'phase5.sqli.%'").get();
        assert(row && row.name === sqlName, "SQL-injection name was altered in storage");
    });

    // =========================================================================
    console.log("M. Concurrent writes honour constraints");
    await t("M1 simultaneous registrations with one email: one wins, one gets 409", async () => {
        const payload = studentPayload("Race");
        const [first, second] = await Promise.all([
            call(port, "/api/auth/register", { method: "POST", body: payload }),
            call(port, "/api/auth/register", { method: "POST", body: payload })
        ]);
        assert([first.status, second.status].sort().join() === "201,409", `statuses were ${first.status}/${second.status}`);
    });
    await t("M2 simultaneous duplicate applications: one wins, one gets 409", async () => {
        const [first, second] = await Promise.all([
            call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: secondScholarshipId } }),
            call(port, "/api/applications", { method: "POST", token: tokenA, body: { scholarship_id: secondScholarshipId } })
        ]);
        assert([first.status, second.status].sort().join() === "201,409", `statuses were ${first.status}/${second.status}`);
    });
    await t("M3 simultaneous saves produce exactly one entry", async () => {
        const [first, second] = await Promise.all([
            call(port, `/api/saved-scholarships/${secondScholarshipId}`, { method: "POST", token: tokenB }),
            call(port, `/api/saved-scholarships/${secondScholarshipId}`, { method: "POST", token: tokenB })
        ]);
        assert([first.status, second.status].every((status) => status === 200 || status === 201), `save statuses ${first.status}/${second.status}`);
        const list = await call(port, "/api/saved-scholarships", { token: tokenB });
        const entries = list.json.saved_scholarships.filter((s) => s.scholarship_id === secondScholarshipId);
        assert(entries.length === 1, `expected one saved entry, found ${entries.length}`);
    });
}

async function cleanup() {
    for (const child of children) {
        try { child.kill(); } catch { /* already gone */ }
    }
    await sleep(700);
    if (staticHandle) {
        try { staticHandle.server.close(); } catch { /* ignore */ }
    }
    try { if (testDb) testDb.close(); } catch { /* ignore */ }
    if (tmpDir) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
                break;
            } catch {
                await sleep(400);
            }
        }
    }
}

main()
    .then(async () => {
        console.log(`\n${passed} checks passed, ${failures.length} failed.`);
        if (failures.length) {
            console.log("\nFailures:");
            for (const failure of failures) console.log(`  - ${failure.name}: ${failure.reason}`);
        }
        await cleanup();
        process.exit(failures.length ? 1 : 0);
    })
    .catch(async (error) => {
        console.error("The suite could not run to completion:", error);
        await cleanup();
        process.exit(1);
    });
