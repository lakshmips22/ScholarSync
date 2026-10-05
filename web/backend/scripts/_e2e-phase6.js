"use strict";
// ---------------------------------------------------------------------------
// ScholarSync Phase 6 - end-to-end regression driver, retained for repeat verification.
// Run from web/backend with: node scripts/_e2e-phase6.js
// Safety: mutating flows run against a temporary COPY of the database. The
// real database instance is only used for read-only startup requests.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const vm = require("node:vm");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require(path.join(__dirname, "..", "services", "auth-service"));

const BACKEND_DIR = path.join(__dirname, "..");
const PROJECT_ROOT = path.join(BACKEND_DIR, "..", "..");
const SOURCE_DB = path.join(BACKEND_DIR, "database", "scholarsync.sqlite");
const FRONTEND_DIR = path.join(BACKEND_DIR, "..", "frontend");
const REAL_EXE = path.join(PROJECT_ROOT, "ScholarSync.exe");

const RUN_ID = Date.now().toString(36);
let passed = 0;
const failures = [];
const children = [];
let tmpDir;
let staticHandle;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function call(port, pathname, { method = "GET", token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
        headers["content-type"] = "application/json";
        payload = JSON.stringify(body);
    }
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers, body: payload });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* text inspected as-is */ }
    return { status: response.status, json, text };
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

async function portBusy(port) {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.once("error", () => resolve(true));
        probe.once("listening", () => probe.close(() => resolve(false)));
        probe.listen(port, "127.0.0.1");
    });
}

// opts: { dbPath, backupDir, fixedPort, env } - all optional; omit for project defaults.
async function startServer(label, opts = {}) {
    const port = opts.fixedPort || (await getFreePort());
    const env = { ...process.env };
    env.PORT = String(port);
    if (opts.dbPath) env.SCHOLARSYNC_DATABASE_PATH = opts.dbPath;
    if (opts.backupDir) env.SCHOLARSYNC_BACKUP_DIR = opts.backupDir;
    Object.assign(env, opts.env || {});
    const child = spawn(process.execPath, ["server.js"], { cwd: BACKEND_DIR, windowsHide: true, env });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    let exitCode = null;
    child.on("exit", (code) => { exitCode = code; });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && exitCode === null) {
        try {
            const ready = await call(port, "/api/test");
            if (ready.status === 200) return { port, label, child, stdout: () => stdout, stderr: () => stderr, exited: () => exitCode };
        } catch { /* not listening yet */ }
        await sleep(200);
    }
    child.kill();
    throw new Error(`${label}: backend did not become ready (exit=${exitCode})\n${stdout.slice(-400)}\n${stderr.slice(-400)}`);
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

// Deep-walks a JSON value looking for sensitive key names.
function findSensitiveKeys(value, keys = /password|secret|salt|_hash/i, label = "$") {
    const hits = [];
    if (Array.isArray(value)) {
        value.forEach((item, index) => hits.push(...findSensitiveKeys(item, keys, `${label}[${index}]`)));
    } else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
            if (keys.test(key)) hits.push(`${label}.${key}`);
            hits.push(...findSensitiveKeys(inner, keys, `${label}.${key}`));
        }
    }
    return hits;
}

const ADMIN_USER = `phase6-admin-${RUN_ID}`;
const ADMIN_PASS = "Phase6-Admin!42";

function studentPayload(tag, overrides = {}) {
    return {
        name: `Phase6 Student ${tag}`,
        email: `phase6.${tag.toLowerCase()}.${RUN_ID}@example.com`,
        password: `Phase6-Student!${tag}`,
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
        name: "Phase6 Temporary Verification Scholarship",
        provider: "Phase6 Test Provider",
        description: "Created and removed by the Phase 6 verification driver.",
        amount: 45000,
        minimum_income: -1,
        deadline: "2027-07-31",
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

function expectOk(res, context = "") {
    assert(res.json && res.json.success === true, `${context}: expected success:true JSON, got HTTP ${res.status} ${res.text.slice(0, 140)}`);
}

async function main() {
    console.log("ScholarSync Phase 6 end-to-end verification");
    console.log(`Run id ${RUN_ID}. Real database is only used for read-only startup checks.\n`);

    // ---- workspace (isolated copy) ------------------------------------------
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scholarsync-e2e-"));
    const dbPath = path.join(tmpDir, "database", "scholarsync.sqlite");
    const backupDir = path.join(tmpDir, "backups");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(SOURCE_DB + suffix)) fs.copyFileSync(SOURCE_DB + suffix, dbPath + suffix);
    }
    const copyDb = new DatabaseSync(dbPath, { timeout: 5000 });
    copyDb.prepare("INSERT INTO admins (username, password_hash, role) VALUES (?, ?, 'admin')")
        .run(ADMIN_USER, await hashPassword(ADMIN_PASS));
    copyDb.close();

    let realBefore;
    {
        const ro = new DatabaseSync(SOURCE_DB, { readOnly: true });
        realBefore = {
            user_version: Object.values(ro.prepare("PRAGMA user_version").get())[0],
            scholarships: Object.values(ro.prepare("SELECT COUNT(*) c FROM scholarships").get())[0],
            students: Object.values(ro.prepare("SELECT COUNT(*) c FROM students").get())[0],
            admins: Object.values(ro.prepare("SELECT COUNT(*) c FROM admins").get())[0],
            applications: Object.values(ro.prepare("SELECT COUNT(*) c FROM applications").get())[0]
        };
        ro.close();
    }
    console.log(`real db before: ${JSON.stringify(realBefore)}\n`);

    // ---- 1. STARTUP -----------------------------------------------------------
    console.log("A. Startup verification");
    const defaultPortOccupied = await portBusy(3000);
    await t("A1 default port configuration is 3000; existing listeners are preserved", async () => {
        const serverSource = fs.readFileSync(path.join(BACKEND_DIR, "server.js"), "utf8");
        assert(/process\.env\.PORT\s*\|\|\s*3000/.test(serverSource), "server.js no longer defaults to port 3000");
        if (defaultPortOccupied) {
            const health = await call(3000, "/api/test");
            assert(health.status === 200, `port 3000 is occupied and its API health check returned ${health.status}`);
            console.log("  info  port 3000 already serves an API; leaving that existing process untouched");
        }
    });

    // Real project database and C configuration; use port 3000 when free and
    // an isolated port when a pre-existing local service owns it.
    let real = null;
    await t("A2 backend starts with project database and C configuration", async () => {
        real = await startServer("real", { fixedPort: defaultPortOccupied ? await getFreePort() : 3000 });
        assert(real.port !== 3000 || !defaultPortOccupied, "test backend collided with a pre-existing listener");
    });
    if (!real) throw new Error("A2 failed: cannot continue without the default-config instance");

    staticHandle = await startStaticFrontend();
    const sPort = staticHandle.port;
    console.log(`  info  static frontend served on ${sPort}, backend on ${real.port}`);

    await t("A3 frontend static pages and assets all serve", async () => {
        for (const file of ["/", "/index.html", "/auth.html", "/student.html", "/admin.html", "/theme.css", "/theme.js"]) {
            const res = await fetch(`http://127.0.0.1:${sPort}${file}`);
            assert(res.status === 200, `${file} -> ${res.status}`);
            await res.text();
        }
    });

    await t("A4 backend reaches default-config database (10 catalog rows)", async () => {
        const list = await call(real.port, "/api/scholarships");
        expectOk(list);
        assert(Array.isArray(list.json.scholarships) && list.json.scholarships.length === realBefore.scholarships,
            `expected ${realBefore.scholarships} catalog rows, got ${list.json && list.json.scholarships && list.json.scholarships.length}`);
    });

    await t("A5 C bridge route reachable with default configuration", async () => {
        const bridge = await call(real.port, "/api/c/scholarships", {});
        assert(bridge.status === 200 && bridge.json && bridge.json.success === true && Array.isArray(bridge.json.scholarships) && bridge.json.scholarships.length > 0,
            `C bridge -> ${bridge.status} ${bridge.text.slice(0, 140)}`);
    });

    await t("A6 no startup errors, no unhandled exceptions, process alive", async () => {
        await sleep(300);
        assert(real.exited() === null, `server exited early (code ${real.exited()})`);
        const noise = real.stderr();
        assert(!/unhandled|throw|EADDRINUSE/i.test(noise), `stderr noise: ${noise.slice(0, 200)}`);
    });
    // The read-only real-config instance is finished here; keep it running for
    // the report of controlled API-failure behavior, then shut it down.
    real.child.kill();
    await sleep(200);

    // ---- sandbox instance on the copy for all mutating flows -----------------
    const box = await startServer("sandbox", { dbPath, backupDir });
    const adminLoginRes = await call(box.port, "/api/admin/login", { method: "POST", body: { username: ADMIN_USER, password: ADMIN_PASS } });
    assert(adminLoginRes.status === 200 && adminLoginRes.json && adminLoginRes.json.token, `admin seeding/login failed: ${adminLoginRes.text.slice(0, 160)}`);
    const adminToken = adminLoginRes.json.token;

    // ---- 2. PUBLIC SCHOLARSHIP FLOW (sandbox; catalog rows are the copied 10) --
    console.log("\nB. Public scholarship flow");
    let catalog;
    await t("B1 catalog loads with full records (SQLite-authoritative route)", async () => {
        const list = await call(box.port, "/api/scholarships");
        expectOk(list, "catalog");
        catalog = list.json.scholarships;
        assert(Array.isArray(catalog) && catalog.length === realBefore.scholarships, `catalog size ${catalog && catalog.length}`);
        const first = catalog[0];
        for (const field of ["scholarship_id", "name", "provider", "amount", "deadline", "category"]) {
            assert(field in first, `catalog row missing ${field}`);
        }
    });
    await t("B2 search + filtering data usable on catalog fields (client-side filter)", async () => {
        for (const row of catalog) {
            assert(typeof row.name === "string" && row.name.length > 0, `row ${row.scholarship_id} unusable for search`);
        }
        const needle = catalog[1].name.slice(0, 6);
        const matches = catalog.filter((s) => [s.name, s.provider, s.category].some((v) => String(v || "").toLowerCase().includes(needle.toLowerCase())));
        assert(matches.length >= 1, `client-side search for "${needle}" would find nothing`);
    });
    await t("B3 catalog projection exposes no sensitive/internal fields", async () => {
        const sens = findSensitiveKeys(catalog);
        assert(sens.length === 0, `sensitive keys in catalog: ${sens.join(",")}`);
    });
    await t("B4 unknown API route gives controlled JSON failure (not HTML)", async () => {
        const miss = await call(box.port, "/api/definitely-not-a-route");
        assert(miss.status === 404 && miss.json && miss.json.success === false, `404 handler -> ${miss.status} ${miss.text.slice(0, 120)}`);
    });
    await t("B5 C-backed route still available alongside SQLite route", async () => {
        const c = await call(box.port, "/api/c/scholarships");
        assert(c.status === 200 && c.json.success === true && Array.isArray(c.json.scholarships), `c route -> ${c.status}`);
    });

    // ---- 3. STUDENT AUTHENTICATION ---------------------------------------------
    console.log("\nC. Student authentication flow");
    const studentB = studentPayload("B");
    const studentC = studentPayload("C");
    let tokenB;
    await t("C1 register student B and student C", async () => {
        for (const p of [studentB, studentC]) {
            const reg = await call(box.port, "/api/auth/register", { method: "POST", body: p });
            assert([200, 201].includes(reg.status), `register ${p.email} -> ${reg.status} ${reg.text.slice(0, 140)}`);
        }
    });
    await t("C2 invalid registration rejected (bad email, weak password, duplicate)", async () => {
        const bad1 = await call(box.port, "/api/auth/register", { method: "POST", body: studentPayload("X", { email: "not-an-email" }) });
        assert(bad1.status === 400, `bad email -> ${bad1.status}`);
        const bad2 = await call(box.port, "/api/auth/register", { method: "POST", body: studentPayload("X", { password: "short" }) });
        assert(bad2.status === 400, `weak password -> ${bad2.status}`);
        const dupe = await call(box.port, "/api/auth/register", { method: "POST", body: studentB });
        assert(dupe.status === 409, `duplicate email -> ${dupe.status}`);
    });
    await t("C3 login works; wrong password rejected with safe message", async () => {
        const wrong = await call(box.port, "/api/auth/login", { method: "POST", body: { email: studentB.email, password: "Wrong-Password!1" } });
        assert(wrong.status === 401 && wrong.json && typeof wrong.json.message === "string", `wrong password -> ${wrong.status}`);
        assert(!/not found|no such|unknown/i.test(wrong.json.message || ""), `message reveals account existence: ${wrong.json.message}`);
        const login = await call(box.port, "/api/auth/login", { method: "POST", body: { email: studentB.email, password: studentB.password } });
        expectOk(login, "login B");
        tokenB = login.json.token;
        assert(typeof tokenB === "string" && tokenB.length >= 32, "no usable token in login response");
    });
    await t("C4 protected routes reject unauthenticated and forged tokens", async () => {
        for (const route of ["/api/auth/me", "/api/student/profile", "/api/saved-scholarships", "/api/applications", "/api/deadlines", "/api/recommendations"]) {
            const anon = await call(box.port, route);
            assert(anon.status === 401, `${route} anonymous -> ${anon.status}`);
            const forged = await call(box.port, route, { token: "A".repeat(43) });
            assert(forged.status === 401, `${route} forged -> ${forged.status}`);
        }
    });
    await t("C5 authenticated profile keeps correct identity, exposes no secrets", async () => {
        const me = await call(box.port, "/api/auth/me", { token: tokenB });
        expectOk(me, "me");
        const profile = await call(box.port, "/api/student/profile", { token: tokenB });
        expectOk(profile, "profile");
        const body = JSON.stringify(profile.json);
        assert(body.includes(studentB.email), "profile does not show the correct student email");
        assert(!body.includes(studentB.password), "profile response contains the password");
        const sens = findSensitiveKeys(profile.json);
        assert(sens.length === 0, `sensitive keys in profile: ${sens.join(",")}`);
    });
    await t("C6 logout invalidates token; re-login issues a new one", async () => {
        const out = await call(box.port, "/api/auth/logout", { method: "POST", token: tokenB });
        expectOk(out, "logout");
        const after = await call(box.port, "/api/auth/me", { token: tokenB });
        assert(after.status === 401, `old token still valid -> ${after.status}`);
        const again = await call(box.port, "/api/auth/login", { method: "POST", body: { email: studentB.email, password: studentB.password } });
        expectOk(again, "re-login");
        tokenB = again.json.token;
        expectOk(await call(box.port, "/api/auth/me", { token: tokenB }), "me after re-login");
    });
    const loginC = await call(box.port, "/api/auth/login", { method: "POST", body: { email: studentC.email, password: studentC.password } });
    expectOk(loginC, "login C");
    const tokenC = loginC.json.token;
    // ---- 4. SAVED SCHOLARSHIPS --------------------------------------------------
    console.log("\nD. Saved scholarships flow");
    const saveTarget = catalog[2].scholarship_id;
    await t("D1 save appears in list and status endpoint", async () => {
        const post = await call(box.port, `/api/saved-scholarships/${saveTarget}`, { method: "POST", token: tokenB });
        assert(post.status === 201 && post.json.saved === true, `save -> ${post.status} ${post.text.slice(0, 120)}`);
        const list = await call(box.port, "/api/saved-scholarships", { token: tokenB });
        expectOk(list, "saved list");
        assert(list.json.saved_scholarships.some((row) => row.scholarship_id === saveTarget), "saved list missing new entry");
        const status = await call(box.port, `/api/saved-scholarships/${saveTarget}/status`, { token: tokenB });
        assert(status.status === 200 && status.json.saved === true, `status -> ${status.status} ${status.text.slice(0, 120)}`);
    });
    await t("D2 double save does not create a duplicate", async () => {
        const again = await call(box.port, `/api/saved-scholarships/${saveTarget}`, { method: "POST", token: tokenB });
        assert(again.status === 200 && again.json.already_saved === true, `second save -> ${again.status} ${again.text.slice(0, 120)}`);
        const list = await call(box.port, "/api/saved-scholarships", { token: tokenB });
        assert(list.json.saved_scholarships.filter((row) => row.scholarship_id === saveTarget).length === 1, "duplicate entry in list");
    });
    await t("D3 another student cannot delete B's saved entry", async () => {
        const stolen = await call(box.port, `/api/saved-scholarships/${saveTarget}`, { method: "DELETE", token: tokenC });
        assert(stolen.status === 404 && stolen.json.success === false, `cross-delete -> ${stolen.status}`);
        const list = await call(box.port, "/api/saved-scholarships", { token: tokenB });
        assert(list.json.saved_scholarships.some((row) => row.scholarship_id === saveTarget), "B's saved entry was affected");
        const cList = await call(box.port, "/api/saved-scholarships", { token: tokenC });
        assert(cList.json.saved_scholarships.length === 0, "C unexpectedly owns a saved entry");
    });
    await t("D4 unsave removes the entry and status reflects it", async () => {
        const del = await call(box.port, `/api/saved-scholarships/${saveTarget}`, { method: "DELETE", token: tokenB });
        expectOk(del, "unsave");
        const status = await call(box.port, `/api/saved-scholarships/${saveTarget}/status`, { token: tokenB });
        assert(status.json.saved === false, "status still reports saved");
        const again = await call(box.port, `/api/saved-scholarships/${saveTarget}`, { method: "DELETE", token: tokenB });
        assert(again.status === 404, `delete-of-absent -> ${again.status}`);
    });
    await t("D5 save with unknown/invalid scholarship id fails with JSON", async () => {
        const gone = await call(box.port, "/api/saved-scholarships/999999", { method: "POST", token: tokenB });
        assert(gone.status === 404 && gone.json.success === false, `unknown -> ${gone.status}`);
        const bad = await call(box.port, "/api/saved-scholarships/not-a-number", { method: "POST", token: tokenB });
        assert(bad.status === 400 && bad.json.success === false, `invalid -> ${bad.status}`);
    });

    // ---- 5. APPLICATION TRACKER --------------------------------------------------
    console.log("\nE. Application tracker flow");
    const applyTarget = catalog[4].scholarship_id;
    let applicationId = null;
    await t("E1 student applies; tracker shows the new application as Pending", async () => {
        const post = await call(box.port, "/api/applications", { method: "POST", token: tokenB, body: { scholarship_id: applyTarget } });
        assert([200, 201].includes(post.status), `apply -> ${post.status} ${post.text.slice(0, 140)}`);
        const list = await call(box.port, "/api/applications", { token: tokenB });
        expectOk(list, "application list");
        const row = list.json.applications.find((a) => a.scholarship_id === applyTarget);
        assert(row, "new application missing from tracker");
        assert(row.status === "Pending", `expected Pending, got ${row.status}`);
        applicationId = row.application_id;
    });
    await t("E2 duplicate application rejected, no duplicate row", async () => {
        const dupe = await call(box.port, "/api/applications", { method: "POST", token: tokenB, body: { scholarship_id: applyTarget } });
        assert(dupe.status === 409 && dupe.json.success === false, `duplicate -> ${dupe.status}`);
        const list = await call(box.port, "/api/applications", { token: tokenB });
        assert(list.json.applications.filter((a) => a.scholarship_id === applyTarget).length === 1, "duplicate row created");
    });
    await t("E3 student cannot change own review status (403) and state is unchanged", async () => {
        const forge = await call(box.port, `/api/applications/${applicationId}/status`, { method: "PUT", token: tokenB, body: { status: "Approved" } });
        assert(forge.status === 403 && forge.json.success === false, `student status change -> ${forge.status}`);
        const list = await call(box.port, "/api/applications", { token: tokenB });
        const row = list.json.applications.find((a) => a.application_id === applicationId);
        assert(row && row.status === "Pending", "status changed after refused request");
    });
    await t("E4 another student cannot see or touch the application", async () => {
        const list = await call(box.port, "/api/applications", { token: tokenC });
        assert(!list.json.applications.some((a) => a.application_id === applicationId), "leaked into C's tracker");
        const detail = await call(box.port, `/api/applications/${applicationId}`, { token: tokenC });
        assert(detail.status === 404, `cross-detail -> ${detail.status}`);
        const delDoc = await call(box.port, `/api/applications/${applicationId}/documents/1`, { method: "DELETE", token: tokenC });
        assert([403, 404].includes(delDoc.status), `cross document delete -> ${delDoc.status}`);
    });
    let documentId = null;
    await t("E5 document checklist: add, list, rename, student-safe status", async () => {
        const add = await call(box.port, `/api/applications/${applicationId}/documents`, { method: "POST", token: tokenB, body: { document_name: "Phase6 Income Certificate" } });
        assert([200, 201].includes(add.status), `add doc -> ${add.status} ${add.text.slice(0, 140)}`);
        const list = await call(box.port, `/api/applications/${applicationId}/documents`, { token: tokenB });
        expectOk(list, "document list");
        const doc = list.json.documents.find((d) => d.document_name === "Phase6 Income Certificate");
        assert(doc, "added document missing from checklist");
        documentId = doc.document_id;
        const rename = await call(box.port, `/api/applications/${applicationId}/documents/${documentId}`, { method: "PUT", token: tokenB, body: { document_name: "Phase6 Income Proof" } });
        expectOk(rename, "rename doc");
        const after = await call(box.port, `/api/applications/${applicationId}/documents`, { token: tokenB });
        assert(after.json.documents.some((d) => d.document_name === "Phase6 Income Proof"), "rename not visible in checklist");
        const submitted = await call(box.port, `/api/applications/${applicationId}/documents/${documentId}`, { method: "PUT", token: tokenB, body: { status: "Submitted" } });
        expectOk(submitted, "student-set Submitted status");
    });
    await t("E6 student cannot set reviewer-only document state", async () => {
        const verified = await call(box.port, `/api/applications/${applicationId}/documents/${documentId}`, { method: "PUT", token: tokenB, body: { status: "Verified" } });
        assert(verified.status === 403 && verified.json.success === false, `student Verified -> ${verified.status}`);
    });
    await t("E7 document delete works and second delete fails as JSON 404", async () => {
        const del = await call(box.port, `/api/applications/${applicationId}/documents/${documentId}`, { method: "DELETE", token: tokenB });
        expectOk(del, "delete doc");
        const list = await call(box.port, `/api/applications/${applicationId}/documents`, { token: tokenB });
        assert(!list.json.documents.some((d) => d.document_id === documentId), "document still listed");
        const again = await call(box.port, `/api/applications/${applicationId}/documents/${documentId}`, { method: "DELETE", token: tokenB });
        assert(again.status === 404 && again.json.success === false, `second delete -> ${again.status}`);
    });
    await t("E8 invalid application requests fail with JSON, not HTML", async () => {
        const gone = await call(box.port, "/api/applications", { method: "POST", token: tokenB, body: { scholarship_id: 999999 } });
        assert(gone.status === 404, `unknown scholarship -> ${gone.status}`);
        const empty = await call(box.port, "/api/applications", { method: "POST", token: tokenB, body: {} });
        assert(empty.status === 400, `missing field -> ${empty.status}`);
        const spoof = await call(box.port, "/api/applications", { method: "POST", token: tokenB, body: { scholarship_id: applyTarget, student_id: 1 } });
        assert(spoof.status === 400, `client-supplied student_id -> ${spoof.status}`);
    });

    // ---- 6. DEADLINES / ELIGIBILITY / RECOMMENDATIONS / PROFILE ------------------
    console.log("\nF. Deadlines, eligibility, recommendations and profile");
    await t("F1 deadlines show real dates with remaining days and valid states", async () => {
        const res = await call(box.port, "/api/deadlines", { token: tokenB });
        expectOk(res, "deadlines");
        const rows = res.json.deadlines;
        assert(Array.isArray(rows) && rows.length > 0, "no deadline rows");
        for (const row of rows) {
            assert(["upcoming", "expired", "unknown"].includes(row.deadline_status), `bad state ${row.deadline_status}`);
            if (/^\d{4}-\d{2}-\d{2}$/.test(String(row.deadline))) {
                assert(row.deadline_status !== "unknown", "valid date classified unknown");
                assert(Number.isInteger(row.days_remaining), "valid date without integer days_remaining");
            }
        }
        const counts = res.json.counts;
        assert(counts.upcoming + counts.expired + counts.unknown === rows.length, "counts do not match rows");
    });
    await t("F2 deadlines include the student's own application state", async () => {
        const res = await call(box.port, "/api/deadlines", { token: tokenB });
        const row = res.json.deadlines.find((d) => d.scholarship_id === applyTarget);
        assert(row, "applied scholarship absent from deadlines");
        assert(JSON.stringify(row).includes(String(applicationId)) || JSON.stringify(row).includes("Pending"),
            "application state not reflected in deadline row");
    });
    await t("F3 eligibility check returns criteria and reasons for a valid pair", async () => {
        const appsBefore = await call(box.port, "/api/applications", { token: tokenB });
        expectOk(appsBefore, "applications before eligibility check");
        const res = await call(box.port, `/api/scholarships/${applyTarget}/eligibility`, { token: tokenB });
        expectOk(res, "eligibility");
        assert(res.json.profile_complete === true, `unexpected profile problems: ${JSON.stringify(res.json.missing_fields)}`);
        assert(typeof res.json.eligible === "boolean", "eligible is not boolean");
        assert(Array.isArray(res.json.criteria) && res.json.criteria.length > 0, "no criteria returned");
        assert(Array.isArray(res.json.reasons), "no reasons array");
        const gone = await call(box.port, "/api/scholarships/999999/eligibility", { token: tokenB });
        assert(gone.status === 404, `unknown -> ${gone.status}`);
        const bad = await call(box.port, "/api/scholarships/abc/eligibility", { token: tokenB });
        assert(bad.status === 400, `invalid id -> ${bad.status}`);
        const appsAfter = await call(box.port, "/api/applications", { token: tokenB });
        expectOk(appsAfter, "applications after eligibility check");
        assert(appsAfter.json.applications.length === appsBefore.json.applications.length, "eligibility created an application");
    });
    await t("F4 recommendations are eligible-only, capped, and honest", async () => {
        const res = await call(box.port, "/api/recommendations", { token: tokenB });
        expectOk(res, "recommendations");
        assert(res.json.profile_complete === true, "profile unexpectedly incomplete");
        const recs = res.json.recommendations;
        assert(Array.isArray(recs) && recs.length <= 5, `bad recommendation list (${recs && recs.length})`);
        assert(recs.every((r) => r.eligibility && r.eligibility.eligible === true), "ineligible recommendation leaked in");
        assert(Number.isInteger(res.json.active_eligible_count) && recs.length <= res.json.active_eligible_count,
            "recommendation count inconsistent with eligible total");
        assert(!JSON.stringify(res.json).toLowerCase().includes("password_hash"), "internal field in recommendations");
    });
    await t("F5 profile update persists and invalid updates are refused", async () => {
        const put = await call(box.port, "/api/student/profile", { method: "PUT", token: tokenB, body: { cgpa: 9.1 } });
        expectOk(put, "profile update");
        const after = await call(box.port, "/api/student/profile", { token: tokenB });
        const body = after.json.student || after.json.profile || after.json;
        assert(JSON.stringify(body).includes("9.1"), "cgpa update not visible");
        const bad = await call(box.port, "/api/student/profile", { method: "PUT", token: tokenB, body: { annual_income: "plenty" } });
        assert(bad.status === 400 && bad.json.success === false, `invalid income -> ${bad.status}`);
        const noSecret = await call(box.port, "/api/student/profile", { token: tokenB });
        const sens = findSensitiveKeys(noSecret.json);
        assert(sens.length === 0, `sensitive keys after update: ${sens.join(",")}`);
    });
    await t("F6 dashboard data (saved + applications + deadlines) is consistent per student", async () => {
        await call(box.port, `/api/saved-scholarships/${catalog[1].scholarship_id}`, { method: "POST", token: tokenB });
        const saved = await call(box.port, "/api/saved-scholarships", { token: tokenB });
        const apps = await call(box.port, "/api/applications", { token: tokenB });
        const otherApps = await call(box.port, "/api/applications", { token: tokenC });
        assert(saved.json.saved_scholarships.length === 1, "saved count drifted");
        assert(apps.json.applications.length === 1 && otherApps.json.applications.length === 0, "application counts crossed students");
    });

    // ---- 7. ADMIN CONSOLE ---------------------------------------------------------
    console.log("\nG. Admin console flow");
    let createdScholarshipId = null;
    await t("G1 admin area refuses anonymous, student, and wrong-credential access", async () => {
        const anon = await call(box.port, "/api/admin/dashboard");
        assert(anon.status === 401, `anonymous dashboard -> ${anon.status}`);
        const student = await call(box.port, "/api/admin/dashboard", { token: tokenB });
        assert(student.status === 403, `student dashboard -> ${student.status}`);
        const wrong = await call(box.port, "/api/admin/login", { method: "POST", body: { username: ADMIN_USER, password: "Wrong-Admin!1" } });
        assert(wrong.status === 401, `wrong admin password -> ${wrong.status}`);
    });
    await t("G2 dashboard statistics match the database", async () => {
        const res = await call(box.port, "/api/admin/dashboard", { token: adminToken });
        expectOk(res, "dashboard");
        const s = res.json.statistics;
        assert(s.total_students === realBefore.students + 2, `students ${s.total_students}`);
        assert(s.total_scholarships === realBefore.scholarships, `scholarships ${s.total_scholarships}`);
        assert(s.total_applications === realBefore.applications + 1, `applications ${s.total_applications}`);
    });
    await t("G3 admin creates a scholarship and it appears in the public catalog", async () => {
        const create = await call(box.port, "/api/admin/scholarships", { method: "POST", token: adminToken, body: scholarshipPayload() });
        assert([200, 201].includes(create.status), `create -> ${create.status} ${create.text.slice(0, 160)}`);
        const adminList = await call(box.port, "/api/admin/scholarships", { token: adminToken });
        const row = adminList.json.scholarships.find((s) => s.name === scholarshipPayload().name);
        assert(row, "created scholarship missing from admin list");
        createdScholarshipId = row.scholarship_id;
        const pub = await call(box.port, "/api/scholarships");
        assert(pub.json.scholarships.some((s) => s.scholarship_id === createdScholarshipId), "not visible in public catalog");
    });
    await t("G4 admin edits it and the public view updates; invalid edits refused", async () => {
        const edit = await call(box.port, `/api/admin/scholarships/${createdScholarshipId}`, { method: "PUT", token: adminToken, body: { amount: 46000 } });
        expectOk(edit, "edit");
        const pub = await call(box.port, "/api/scholarships");
        const row = pub.json.scholarships.find((s) => s.scholarship_id === createdScholarshipId);
        assert(row && row.amount === 46000, `public view shows ${row && row.amount}`);
        const bad = await call(box.port, `/api/admin/scholarships/${createdScholarshipId}`, { method: "PUT", token: adminToken, body: { amount: "free money" } });
        assert(bad.status === 400 && bad.json.success === false, `invalid edit -> ${bad.status}`);
    });
    await t("G5 scholarship referenced by an application cannot be deleted; clean one can", async () => {
        const blocked = await call(box.port, `/api/admin/scholarships/${applyTarget}`, { method: "DELETE", token: adminToken });
        assert(blocked.status === 409 && blocked.json.success === false, `delete referenced -> ${blocked.status}`);
        const gone = await call(box.port, `/api/admin/scholarships/${createdScholarshipId}`, { method: "DELETE", token: adminToken });
        expectOk(gone, "delete created");
        const pub = await call(box.port, "/api/scholarships");
        assert(!pub.json.scholarships.some((s) => s.scholarship_id === createdScholarshipId), "still in public catalog");
        const again = await call(box.port, `/api/admin/scholarships/${createdScholarshipId}`, { method: "DELETE", token: adminToken });
        assert(again.status === 404, `delete again -> ${again.status}`);
    });

    await t("G6 student management: list finds the account, detail has no secrets", async () => {
        const list = await call(box.port, "/api/admin/students", { token: adminToken });
        expectOk(list, "student list");
        const row = list.json.students.find((s) => s.email === studentB.email);
        assert(row, "student B missing from admin list");
        const detail = await call(box.port, `/api/admin/students/${row.student_id}`, { token: adminToken });
        expectOk(detail, "student detail");
        assert(!JSON.stringify(detail.json).includes(studentB.password), "password exposed in admin detail");
        const sens = findSensitiveKeys(detail.json);
        assert(sens.length === 0, `sensitive keys in admin detail: ${sens.join(",")}`);
    });
    await t("G7 admin reviews an application; student tracker reflects the decision", async () => {
        const list = await call(box.port, "/api/admin/applications", { token: adminToken });
        expectOk(list, "admin application list");
        const review = await call(box.port, `/api/admin/applications/${applicationId}/status`, { method: "PUT", token: adminToken, body: { status: "Approved" } });
        expectOk(review, "admin approve");
        const mine = await call(box.port, "/api/applications", { token: tokenB });
        const row = mine.json.applications.find((a) => a.application_id === applicationId);
        assert(row && row.status === "Approved", `student view shows ${row && row.status}`);
        const invalid = await call(box.port, `/api/admin/applications/${applicationId}/status`, { method: "PUT", token: adminToken, body: { status: "Maybe" } });
        assert(invalid.status === 400, `invalid status -> ${invalid.status}`);
    });
    await t("G8 reports aggregate the real database values", async () => {
        const res = await call(box.port, "/api/admin/reports", { token: adminToken });
        expectOk(res, "reports");
        const check = new DatabaseSync(dbPath, { readOnly: true });
        const students = Object.values(check.prepare("SELECT COUNT(*) c FROM students").get())[0];
        const applications = Object.values(check.prepare("SELECT COUNT(*) c FROM applications").get())[0];
        check.close();
        assert(res.json.report.totals.students === students, "report student total wrong");
        assert(res.json.report.totals.applications === applications, "report application total wrong");
    });
    const backupNames = [];
    await t("G9 backup creates a real, restorable database copy", async () => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const res = await call(box.port, "/api/admin/backup", { method: "POST", token: adminToken });
            assert(res.status === 201 && res.json.backup, `backup -> ${res.status} ${res.text.slice(0, 140)}`);
            const name = res.json.backup.file_name;
            assert(/^scholarsync-[0-9T:.-]+-[0-9a-f]{8}\.sqlite$/.test(name.replace(/:/g, "-")) || /^scholarsync-/.test(name), `odd name ${name}`);
            const file = path.join(backupDir, name);
            assert(fs.existsSync(file), `backup file missing: ${name}`);
            assert(fs.statSync(file).size === res.json.backup.size_bytes, "size mismatch");
            backupNames.push(name);
        }
        assert(new Set(backupNames).size === 2, "second backup reused the same file name");
        const snap = new DatabaseSync(path.join(backupDir, backupNames[1]), { readOnly: true });
        assert(Object.values(snap.prepare("PRAGMA integrity_check").get())[0] === "ok", "backup fails integrity_check");
        assert(Object.values(snap.prepare("PRAGMA user_version").get())[0] === 3, "backup user_version wrong");
        const inSnap = Object.values(snap.prepare("SELECT COUNT(*) c FROM students WHERE email = ?").get(studentB.email))[0];
        snap.close();
        assert(inSnap === 1, "backup does not contain the current data (student B missing)");
    });
    await t("G10 admin logout invalidates the admin token", async () => {
        const out = await call(box.port, "/api/admin/logout", { method: "POST", token: adminToken });
        expectOk(out, "admin logout");
        const after = await call(box.port, "/api/admin/dashboard", { token: adminToken });
        assert(after.status === 401, `token still valid -> ${after.status}`);
    });

    // ---- 8. C CORE INTEGRATION -----------------------------------------------------
    console.log("\nH. C core integration");
    let cDirect = null;
    await t("H1 ScholarSync.exe --api scholarships outputs valid JSON (direct)", () => {
        assert(fs.existsSync(REAL_EXE), `C executable missing at ${REAL_EXE}`);
        const run = spawnSync(REAL_EXE, ["--api", "scholarships"], { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 20000 });
        assert(run.status === 0, `exit ${run.status}; stderr: ${String(run.stderr).slice(0, 160)}`);
        cDirect = JSON.parse(run.stdout);
        const rows = Array.isArray(cDirect) ? cDirect : cDirect.scholarships;
        assert(Array.isArray(rows) && rows.length > 0, "no scholarship rows in C output");
        assert(rows.every((row) => row && typeof row === "object"), "C output rows are not objects");
    });
    await t("H2 /api/c/scholarships mirrors the direct C output", async () => {
        const bridge = await call(box.port, "/api/c/scholarships");
        assert(bridge.status === 200 && bridge.json.success === true, `bridge -> ${bridge.status}`);
        const directRows = Array.isArray(cDirect) ? cDirect : cDirect.scholarships;
        assert(bridge.json.scholarships.length === directRows.length, `count ${bridge.json.scholarships.length} vs C ${directRows.length}`);
    });
    await t("H3 controlled failure isolation: broken C path does not affect web routes", async () => {
        const broken = await startServer("broken-c", { dbPath, backupDir, env: { SCHOLARSYNC_C_PROGRAM: path.join(tmpDir, "does-not-exist.exe") } });
        const bridge = await call(broken.port, "/api/c/scholarships");
        assert(bridge.status === 500 && bridge.json.success === false, `broken bridge -> ${bridge.status}`);
        assert(bridge.json.message === "Unable to load scholarships from C program.", `unexpected message: ${bridge.json.message}`);
        assert(!/ENOENT|\.exe|path|at .*\.js/i.test(bridge.text), `error leaks internals: ${bridge.text.slice(0, 160)}`);
        const catalog = await call(broken.port, "/api/scholarships");
        expectOk(catalog, "web catalog while C is broken");
        assert(catalog.json.scholarships.length >= 10, "web catalog lost rows when C broke");
        broken.child.kill();
    });

    // ---- 9. STATIC FRONTEND VERIFICATION -------------------------------------------
    console.log("\nI. Frontend static verification (pages, assets, dark mode, safety)");
    const PAGES = ["index.html", "auth.html", "student.html", "admin.html"];
    const pageSource = {};
    await t("I1 every page and asset loads over the local static server", async () => {
        for (const file of [...PAGES, "theme.css", "theme.js", "api-config.js"]) {
            const res = await fetch(`http://127.0.0.1:${sPort}/${file}`);
            assert(res.status === 200, `${file} -> ${res.status}`);
            pageSource[file] = await res.text();
        }
    });
    await t("I2 all inline page scripts and shared script parse as valid JavaScript", () => {
        const sources = [["theme.js", pageSource["theme.js"]]];
        for (const page of PAGES) {
            const scripts = pageSource[page].match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
            scripts.forEach((block, index) => sources.push([`${page}#script${index}`, block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "")]));
        }
        for (const [label, code] of sources) {
            new vm.Script(code, { filename: label });
        }
        assert(sources.length >= PAGES.length + 1, "no scripts found to check");
    });

    await t("I3 every DOM id referenced by page scripts exists in its page", () => {
        for (const page of PAGES) {
            const source = pageSource[page];
            const defined = new Set([...source.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
            const referenced = new Set([
                ...[...source.matchAll(/\$\(\s*["']([\w-]+)["']\s*\)/g)].map((m) => m[1]),
                ...[...source.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)].map((m) => m[1])
            ]);
            const missing = [...referenced].filter((id) => !defined.has(id));
            assert(missing.length === 0, `${page}: ids referenced but never defined: ${missing.join(", ")}`);
        }
    });
    await t("I4 page API calls only target endpoints the backend actually serves", () => {
        const allowed = [
            /^\/auth\/(register|login|me|logout)$/, /^\/student\/profile$/,
            /^\/saved-scholarships(\/1)?(\/status)?$/, /^\/scholarships(\/1(\/eligibility)?)?$/,
            /^\/recommendations$/, /^\/applications(\/1)?(\/status|\/documents(\/1)?)?$/,
            /^\/deadlines$/, /^\/c\/scholarships$/,
            /^\/admin\/(login|logout|dashboard|reports|backup|students(\/1)?|scholarships(\/1)?|applications(\/1)?(\/status)?)$/
        ];
        const offenders = [];
        for (const page of [...PAGES]) {
            const source = pageSource[page];
            const literals = [
                ...[...source.matchAll(/\bapi\(\s*["'`]([^"'`$]*)/g)].map((m) => m[1]),
                ...[...source.matchAll(/fetch\(\s*[`"'][^`"']*?\/api(\/[^`"'?#]*)/g)].map((m) => m[1])
            ];
            for (let literal of literals) {
                literal = literal.replace(/\$\{[^}]*\}/g, "1").replace(/\/\d+(?=\/|$)/g, "/1").replace(/\/$/, "/1");
                if (!literal.startsWith("/")) continue;
                if (!allowed.some((pattern) => pattern.test(literal))) offenders.push(`${page}: ${literal}`);
            }
        }
        assert(offenders.length === 0, `unknown endpoints called: ${offenders.join(", ")}`);
    });
    await t("I5 referenced local assets exist inside the frontend folder", () => {
        const missing = [];
        for (const page of PAGES) {
            for (const m of pageSource[page].matchAll(/(?:src|href)="([^"]+)"/g)) {
                const target = m[1].split("?")[0].split("#")[0];
                if (!target || target.includes("${") || /^(https?:|data:|mailto:|javascript:|#)/i.test(target)) continue;
                if (!fs.existsSync(path.join(FRONTEND_DIR, path.normalize(target)))) missing.push(`${page}: ${target}`);
            }
        }
        assert(missing.length === 0, `missing local references: ${missing.join(", ")}`);
    });
    await t("I6 dark mode and responsive styling are wired into every page", () => {
        assert(/localStorage/.test(pageSource["theme.js"]) && /theme/i.test(pageSource["theme.js"]), "theme.js does not persist a theme choice");
        assert(/\[data-theme=["']?dark|prefers-color-scheme:\s*dark/.test(pageSource["theme.css"]), "theme.css has no dark-mode rules");
        assert(/@media\s*\(/.test(pageSource["theme.css"]), "theme.css has no responsive breakpoints");
        for (const page of PAGES) {
            assert(/theme\.css/.test(pageSource[page]) && /theme\.js/.test(pageSource[page]), `${page} does not load the shared theme`);
        }
    });
    await t("I7 UI safety, dynamic API configuration, and eligibility/apply separation", () => {
        for (const page of PAGES) {
            assert(!/window\.(confirm|alert|prompt)\s*\(/.test(pageSource[page]), `${page} still uses a blocking dialog`);
            assert(/api-config\.js/.test(pageSource[page]), `${page} does not load api-config.js`);
            assert(/SCHOLARSYNC_API_BASE/.test(pageSource[page]), `${page} does not use the configured API base`);
        }
        assert(/window\.location\.hostname/.test(pageSource["api-config.js"]), "API default is not derived from the current host");
        assert(/armDelete|armed/.test(pageSource["admin.html"]), "admin.html has no two-step armed delete pattern");
        assert(/armDelete|armed/.test(pageSource["student.html"]), "student.html has no two-step armed delete pattern");
        const catalog = pageSource["index.html"];
        const eligibilityStart = catalog.indexOf("async function checkScholarshipEligibility(id)");
        const eligibilityEnd = catalog.indexOf("async function refreshApplicationForScholarship", eligibilityStart);
        assert(eligibilityStart >= 0 && eligibilityEnd > eligibilityStart, "eligibility action function could not be isolated");
        const eligibility = catalog.slice(eligibilityStart, eligibilityEnd);
        assert(/\/scholarships\/\$\{encodeURIComponent\(id\)\}\/eligibility/.test(eligibility), "eligibility does not request the eligibility endpoint");
        assert(!/\/applications|method\s*:\s*["']POST/i.test(eligibility), "eligibility action can create an application");
        const applyStart = catalog.indexOf("async function applyForScholarship(id, button)");
        const applyEnd = catalog.indexOf("async function showApplicationDetails", applyStart);
        assert(applyStart >= 0 && applyEnd > applyStart, "Apply action function could not be isolated");
        const apply = catalog.slice(applyStart, applyEnd);
        assert(/studentApi\(["']\/applications["']/.test(apply) && /method\s*:\s*["']POST/.test(apply), "Apply action does not own application creation");
        assert(/function escapeHtml\(value\)[\s\S]*?replace\(\/\[&<>\\"'\]/.test(catalog), "homepage is missing its XSS-safe escapeHtml helper");
    });
    console.log("  INFO  interactive click-through (armed-delete two-click, live UI state) is NOT TESTABLE headless; verified statically above.");

    // ---- 10. CONSISTENCY AND CLEAN-ROOM EXIT ---------------------------------------
    console.log("\nJ. Database consistency and clean exit");
    await t("J1 sandbox database passes integrity checks after all mutations", () => {
        const check = new DatabaseSync(dbPath, { readOnly: true });
        assert(Object.values(check.prepare("PRAGMA integrity_check").get())[0] === "ok", "integrity_check failed");
        assert(check.prepare("PRAGMA foreign_key_check").all().length === 0, "foreign key violations present");
        assert(Object.values(check.prepare("PRAGMA user_version").get())[0] === 3, "user_version drifted");
        check.close();
    });
    await t("J2 no orphan or duplicate rows created by any flow", () => {
        const check = new DatabaseSync(dbPath, { readOnly: true });
        const orphanApps = Object.values(check.prepare("SELECT COUNT(*) c FROM applications a LEFT JOIN scholarships s USING(scholarship_id) LEFT JOIN students st USING(student_id) WHERE s.scholarship_id IS NULL OR st.student_id IS NULL").get())[0];
        assert(orphanApps === 0, `${orphanApps} orphan applications`);
        const orphanSaved = Object.values(check.prepare("SELECT COUNT(*) c FROM saved_scholarships ss LEFT JOIN scholarships s USING(scholarship_id) LEFT JOIN students st USING(student_id) WHERE s.scholarship_id IS NULL OR st.student_id IS NULL").get())[0];
        assert(orphanSaved === 0, `${orphanSaved} orphan saved entries`);
        const dupSaved = check.prepare("SELECT COUNT(*) c FROM (SELECT student_id, scholarship_id FROM saved_scholarships GROUP BY student_id, scholarship_id HAVING COUNT(*) > 1)").get().c;
        assert(Number(dupSaved) === 0, "duplicate saved pairs");
        const dupApps = check.prepare("SELECT COUNT(*) c FROM (SELECT student_id, scholarship_id FROM applications GROUP BY student_id, scholarship_id HAVING COUNT(*) > 1)").get().c;
        assert(Number(dupApps) === 0, "duplicate application pairs");
        const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
        if (tables.includes("application_documents")) {
            const orphanDocs = Object.values(check.prepare("SELECT COUNT(*) c FROM application_documents d LEFT JOIN applications a USING(application_id) WHERE a.application_id IS NULL").get())[0];
            assert(orphanDocs === 0, `${orphanDocs} orphan documents`);
        }
        check.close();
    });
    await t("J3 the real project database is untouched by this driver", () => {
        const check = new DatabaseSync(SOURCE_DB, { readOnly: true });
        const after = {
            user_version: Object.values(check.prepare("PRAGMA user_version").get())[0],
            scholarships: Object.values(check.prepare("SELECT COUNT(*) c FROM scholarships").get())[0],
            students: Object.values(check.prepare("SELECT COUNT(*) c FROM students").get())[0],
            admins: Object.values(check.prepare("SELECT COUNT(*) c FROM admins").get())[0],
            applications: Object.values(check.prepare("SELECT COUNT(*) c FROM applications").get())[0]
        };
        const leftovers = Object.values(check.prepare("SELECT (SELECT COUNT(*) FROM students WHERE email LIKE 'phase6.%') + (SELECT COUNT(*) FROM admins WHERE username LIKE 'phase6-admin-%') c").get())[0];
        check.close();
        assert(JSON.stringify(after) === JSON.stringify(realBefore), `real db changed: ${JSON.stringify(after)} vs ${JSON.stringify(realBefore)}`);
        assert(leftovers === 0, `${leftovers} phase6 test rows leaked into the real database`);
    });
    await t("J4 test server processes shut down and release only their own ports", async () => {
        for (const child of children) { try { child.kill(); } catch { /* already gone */ } }
        await sleep(1200);
        assert(!(await portBusy(box.port)), "sandbox port still busy after shutdown");
        assert(!(await portBusy(real.port)), "real-config test port still busy after shutdown");
        if (staticHandle && staticHandle.server.listening) {
            await new Promise((resolve) => staticHandle.server.close(resolve));
        }
        if (staticHandle) assert(staticHandle.server.listening === false, "test static frontend server still listening after shutdown");
    });

    console.log(`\n${"=".repeat(64)}`);
    console.log(`Phase 6 end-to-end: ${passed} passed, ${failures.length} failed`);
    for (const failure of failures) console.log(`  FAILED: ${failure.name} - ${failure.reason}`);
    console.log(`${failures.length === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
    console.error(`\nDRIVER ABORTED: ${error && error.stack}`);
    process.exitCode = 2;
}).finally(() => {
    for (const child of children) { try { child.kill(); } catch { /* ignore */ } }
    try { if (staticHandle) staticHandle.server.close(); } catch { /* ignore */ }
    try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});












