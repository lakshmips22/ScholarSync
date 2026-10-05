# ScholarSync database foundation

## Why SQLite

SQLite provides a relational database in one local file. It needs no separate database server and suits the current single-machine project. The backend uses the Node.js built-in `node:sqlite` module, which is available in the installed Node.js 24.21.0 runtime; no native add-on or third-party database dependency needs installation.

## Location

The database file is `web/backend/database/scholarsync.sqlite`. SQLite database and journal files are ignored by Git. The database is separate from the C `data/` files; initializing it does not delete or replace those files.

## Tables and relationships

- `students`: maps the C `Student` profile fields. `email` is unique; the stored credential field is named `password_hash` and is intended for an existing secure hash, never plaintext.
- `scholarships`: maps all fields from the C `Scholarship` structure and API. `minimum_income` retains the C meanings: `-1` unspecified, `0` no limit, positive values are a limit.
- `admins`: username, password hash, and a role. Usernames are unique.
- `saved_scholarships`: links students and scholarships, stores `saved_at`, and uses the pair as its primary key to prevent duplicate saves.
- `applications`: links students and scholarships, retains the C application ID/status/date fields, and enforces one application per student/scholarship as the C application flow does.
- `documents`: checklist entries belong to an application. Name is required; type and storage path are optional; status is constrained to the defined lifecycle values. The current web workflow tracks checklist items and does not upload files.

Foreign keys protect application and saved-record relationships. Indexes support scholarship category/deadline lookups and related-record lookups. Foreign-key enforcement is enabled on every connection.

## Initialize

From `web/backend`, run:

```text
npm run db:init
```

Initialization creates the database directory/file and applies all pending versioned migrations, including `database/migrations/002_auth_sessions.sql`. It is safe to run again; it does not drop tables or rows.

## Import scholarships

From `web/backend`, run:

```text
npm run db:import-scholarships
```

The importer invokes the existing `scholarsync.exe --api scholarships` command and inserts/updates those real records with parameterized statements in one transaction. It does not read, delete, or replace the C data files. Existing database scholarships absent from a later C catalog are intentionally retained.

Student/admin accounts, saved entries, applications, and documents are not migrated in this phase. In particular, the current account files are left untouched; no credential data is copied automatically.

## Architecture

The web application reads its scholarship catalog from SQLite, the single authoritative catalog:

```text
Frontend → Express /api/scholarships → SQLite scholarship table
```

Since Phase 4, `GET /api/scholarships` reads the `scholarships` table through the same `safeScholarship` projection used by eligibility, recommendations, saved scholarships, applications, deadlines, and admin, so one admin change appears in every web view at once. The C executable stays available as an integration bridge at `GET /api/c/scholarships` and returns a controlled JSON error if the C program fails; `npm run db:import-scholarships` refreshes SQLite from the C catalog, and the optional `SCHOLARSYNC_C_PROGRAM` environment variable overrides the executable path.

## Student authentication (Phase 2A)

The existing `students` table is reused for student accounts. Registration requires the profile values already represented by the C `Student` structure: name, email, password, course, annual income, category, state, gender, disability, and CGPA. The server validates text lengths against the existing C field capacities, checks email shape, accepts disability as `Yes` or `No`, and requires CGPA from 0 through 10 and nonnegative annual income.

Passwords are stored only as salted PBKDF2-SHA256 hashes, using the same `P1$<salt hex>$<hash hex>` format and 210,000 iterations as the C application. A generated opaque bearer token is returned on login. The database stores only a SHA-256 digest of that token in `auth_sessions`; sessions expire after 12 hours and logout deletes the session. The token must be sent as `Authorization: Bearer <token>`. Passwords, hashes, and raw session tokens are never stored together or returned in profile responses.

Migration `002_auth_sessions.sql` adds the session table and indexes; it does not alter existing student or scholarship records. Apply pending migrations from `web/backend` with:

```text
npm run db:init
```

### Authentication endpoints

- `POST /api/auth/register` — JSON fields: `name`, `email`, `password`, `course`, `annual_income`, `category`, `state`, `gender`, `disability`, `cgpa`. Returns 201 and a safe `user` profile; duplicate email returns 409.
- `POST /api/auth/login` — JSON `email` and `password`; returns a safe user and bearer `token`; invalid credentials return the same 401 message.
- `GET /api/auth/me` — requires a bearer token; returns the safe current profile.
- `POST /api/auth/logout` — requires a bearer token and invalidates it.

Sessions use opaque bearer tokens with a 12-hour expiry. Student and admin browser login interfaces are present. Tokens are sent in the `Authorization` header; use the HTTPS Cloudflare Quick Tunnel for the public demo. The local/LAN development URL uses HTTP, so keep that mode on a trusted private network and do not use it to send real credentials over untrusted Wi-Fi.

Web registrations are stored in SQLite. They are not copied to the C text-file student store; C console account workflows remain independent. The established scholarship path remains:

```text
Frontend → Express /api/scholarships → SQLite scholarship table
```


## Student profile and saved scholarships (Phase 2B)

No schema migration is required. The profile API updates existing `students` columns (name, email, course, annual income, category, state, gender, disability, and CGPA). Updates may include one or more supported fields; the route rejects unknown fields such as client-supplied student IDs or password hashes. Email uniqueness is enforced by the existing unique constraint.

All Phase 2B routes use the Phase 2A `requireAuth` bearer-token middleware and take the student ID from the authenticated session. Saved scholarships use the existing `saved_scholarships` table and return details from the existing `scholarships` table. Repeated saves are idempotent; removing a scholarship that is not saved returns 404. No database tables or fields were added for this phase.

- `GET /api/student/profile`
- `PUT /api/student/profile`
- `GET /api/saved-scholarships`
- `POST /api/saved-scholarships/:scholarshipId`
- `DELETE /api/saved-scholarships/:scholarshipId`
- `GET /api/saved-scholarships/:scholarshipId/status`

## Eligibility and recommendations (Phase 2C)

No database changes were needed. Both endpoints require the existing Phase 2A bearer-token middleware and read the profile selected by the authenticated session; clients cannot provide another student ID.

- `GET /api/scholarships/:scholarshipId/eligibility` compares the signed-in student's profile with the selected SQLite scholarship and returns an overall profile-rule result, each checked condition, and explanations. It follows the C matcher: income is unrestricted when `minimum_income` is zero or negative; course/state/gender/disability values match case-insensitively with blank or `Any` rules unrestricted; category values are comma-separated exact options; `North East` means Arunachal Pradesh, Assam, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, or Tripura; and CGPA must meet a positive `minimum_cgpa`. Scholarship category is descriptive and is not treated as an eligibility condition.
- `GET /api/recommendations` applies those same rules to the signed-in student's profile and SQLite scholarship catalog. It returns up to five matches ranked by award amount, following the existing C recommender. Expired deadlines are omitted from active recommendations; a date that is missing or not a valid `YYYY-MM-DD` date is also not presented as active. Each item contains the scholarship's stored fields and its rule-by-rule explanation. This is transparent rule-based matching, not AI or machine learning.

Incomplete or invalid profile data produces an explanatory empty response. A complete profile with no matches and an empty scholarship catalog also receive separate empty-state messages. Eligibility results describe matches to listed profile rules; they do not guarantee an award or provider approval.

## Applications, documents, and deadlines (Phase 2D)

No migration was needed: the existing `applications` and `documents` tables already support the requested records and constraints. All endpoints below use the Phase 2A bearer-token middleware, use the authenticated student's ID in SQL, and return only that student's data.

- `POST /api/applications` — JSON `{ "scholarship_id": 101 }`; creates one application per student/scholarship with status `Pending` and the current local date. As in the C application flow, an existing catalog scholarship may still be applied to after its deadline; the response reports the derived deadline state.
- `GET /api/applications` and `GET /api/applications/:id` — return the student's applications with scholarship name, actual deadline, deadline state, and days remaining.
- `PUT /api/applications/:id/status` — validates the existing database statuses `Pending`, `Approved`, and `Rejected`. Review status is administrator-controlled in the C project, so student requests receive 403; no student can approve/reject or otherwise change review state.
- `GET /api/applications/:id/documents`, `POST /api/applications/:id/documents`, `PUT /api/applications/:id/documents/:documentId`, and `DELETE /api/applications/:id/documents/:documentId` — manage checklist names/types and statuses using the existing document table. Students may set `Pending` or `Submitted`; `Verified`/`Rejected` are reviewer states. No file upload or filesystem path is accepted or returned; the existing schema does not define a safe upload-storage design.
- `GET /api/deadlines` — returns real scholarship deadlines, each marked `upcoming`, `expired`, or `unknown`, with `days_remaining` when the date is a valid `YYYY-MM-DD`. It includes this student's application ID/status/date when an application exists. Missing or invalid dates are marked `unknown` and sorted after known deadlines.

The existing application schema stores only `applied_on` and the current status, not status history. No timeline table was added; the API reports the state the schema can support without fabricating history.

## Admin dashboard and management (Phase 2E)

Migration `003_admin_sessions.sql` adds a separate admin session table keyed to the existing `admins` table. It is additive and does not alter students, scholarships, applications, or existing sessions. Admin bearer tokens use the existing 12-hour token policy and are stored as SHA-256 digests. Admin middleware accepts only valid admin sessions; a valid student token gets 403, and an absent/invalid token gets 401.

Endpoints under `/api/admin` include:

- `POST /login`, `POST /logout`
- `GET /dashboard`
- `GET/POST /scholarships`, `PUT/DELETE /scholarships/:id`
- `GET /students`, `GET /students/:id`
- `GET /applications`, `GET /applications/:id`, `PUT /applications/:id/status`
- `GET /reports`
- `POST /backup`

Scholarship additions use the existing SQLite scholarship columns and C field limits; IDs are generated by SQLite. Scholarship deletion is blocked while applications reference the scholarship. Saved entries use the existing foreign-key cascade and are removed with a successful scholarship deletion. Admin application review accepts the existing statuses `Pending`, `Approved`, and `Rejected`.

The SQLite `admins` table is empty in a fresh copy of this project. To reuse the existing C admin credential, first create the admin through the C Admin Portal, then from `web/backend` run:

```text
npm run db:import-admin
```

This command copies only the existing salted `P1$...` hash into the SQLite `admins` table; it never imports plaintext. Student registration remains separate from the C text-file student records.

The admin backup endpoint makes a uniquely named SQLite snapshot under `database/backups/`, opening each new destination exclusively so it cannot overwrite the live database or an earlier backup. The file is excluded from version control and is only created by authenticated admins. The C backup/restore flow for its text files remains unchanged.

## Security and error hardening (Phase 5)

The backend now presents a consistent, non-revealing error surface:

- `app.disable("x-powered-by")` removes the framework version header.
- Every `/api/*` failure answers JSON `{ "success": false, "message": "..." }`: unmatched API paths/methods get a JSON 404 (never the HTML error page), malformed JSON gets 400, and bodies over 32 KB get 413. A single final error handler logs the real error server-side and returns the generic "An unexpected server error occurred." message; stack traces, file paths, and SQL details never reach clients.
- The C bridge (`GET /api/c/scholarships`) uses a fixed program path and fixed arguments, so query parameters cannot redirect it to another executable. It enforces a timeout (default 10 s, `SCHOLARSYNC_C_TIMEOUT_MS`), a 1 MB output cap, and an array-of-objects shape check. Failures map to three friendly client messages — "Unable to load scholarships from C program." (missing/crashed program), "Invalid data received from C program." (garbage, wrong shape, oversized output), and "The C program took too long to respond." — with details logged only to the server console.
- Backup file names are always generated server-side (`scholarsync-<UTC timestamp>-<random>.sqlite`); a client-supplied `file_name` is ignored, so path traversal into the backup endpoint is impossible. An unwritable destination yields a controlled 500.
- Validation is shared through small validator modules: every text field has a byte limit, unknown fields are rejected instead of silently dropped, identity always comes from the session (client-supplied `student_id` is refused or ignored), application review is administrator-only (students get 403, even for `Pending`), document `Verified`/`Rejected` states return 403 for students, and admin student search is capped at 99 bytes with `|` and multi-valued parameters refused. All SQL stays parameterized, so injection payloads are stored verbatim as data.
- Frontend cleanup removed the shadowed duplicate function declarations in `admin.html` and replaced the last two blocking `window.confirm()` delete prompts (admin scholarship delete, student checklist delete) with a non-blocking two-step "Click again to confirm" button pattern.

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `SCHOLARSYNC_DATABASE_PATH` | Database file used by the server (test suites point this at a copy) | `database/scholarsync.sqlite` |
| `SCHOLARSYNC_BACKUP_DIR` | Directory for admin backups | `database/backups` |
| `SCHOLARSYNC_C_PROGRAM` | Executable used by the C bridge | project root `ScholarSync.exe` |
| `SCHOLARSYNC_C_TIMEOUT_MS` | C bridge timeout in milliseconds | `10000` |
| `SCHOLARSYNC_CORS_ORIGINS` | Comma-separated origin allow-list; unset keeps the permissive default for this project | open (`*`) |

## Local, LAN, and public demo routing

The default local/LAN setup serves the static frontend on port `5500` and Express on port `3000`. On HTTP pages, `api-config.js` retains the LAN API base `http://<page-hostname>:3000/api`. The project static server (`npm run start:frontend`) also proxies `/api` requests to `http://127.0.0.1:3000` for same-origin HTTPS use. HTTPS pages use `<page-origin>/api`, so a public browser connects to the frontend and the frontend relays API requests to Express.

For the zero-cost public demo, start the backend and `npm run start:frontend`, then run `cloudflared.exe tunnel --url http://localhost:5500`. Configure the tunnel to target only port `5500`; do not point it at backend port `3000`. The Quick Tunnel provides a temporary HTTPS URL, not permanent hosting. The laptop, backend, frontend, and `cloudflared` process must stay running. Do not configure router port forwarding for port `3000`; LAN firewall access to the backend should remain limited to the private network. See the root `README.md` for the launch instructions and limitations.

### Automated security checks

From `web/backend`, run:

```text
npm test
```

`scripts/security-tests.js` copies the live database into a temporary folder, seeds throwaway accounts, starts its own backend instances on random localhost ports (pointed at the copy via `SCHOLARSYNC_DATABASE_PATH`), and drives 81 checks in thirteen groups: error envelope and headers, registration/login rules, session guards (forged/expired/logged-out tokens), IDOR and byte limits, eligibility/recommendations, admin privilege separation and CRUD, backup success/traversal/failure, credential and token exposure (responses, database bytes, server logs), CORS, six C-bridge failure simulations, frontend page and dead-code checks, post-suite database integrity, and concurrent constraint violations. It never writes to the real database, backup folder, or C files, and deletes its temporary workspace at the end. The controlled misbehaving C programs are compiled on the fly from `scripts/fixtures/c_behavior_fixture.c` when `gcc` is available (those five checks are skipped otherwise). A clean run prints `81 checks passed, 0 failed.` and exits 0; any failure prints the failing checks and exits 1.

For local-only manual testing, start the backend with `npm start` (port 3000 by default) and optionally serve the frontend with a basic static server such as `python -m http.server 5500 --directory web/frontend` from the project root, then open `http://localhost:5500/` (or open `web/frontend/index.html` directly). This basic static-server option is for HTTP local development. Use the project's `npm run start:frontend` server when testing HTTPS same-origin `/api` proxying or starting a Quick Tunnel.

