# ScholarSync

**A scholarship-management system built around a C console application, with a web application for student and administrator workflows.**

ScholarSync is a B.Tech Computer Science and Engineering project. Its C application provides the original system foundation; the web application extends access through a browser interface, a Node.js/Express API, and a separate SQLite database for web workflows.

## Project Overview

### Problem Statement

Students need a place to explore scholarship information, compare their profiles with listed eligibility rules, and keep track of saved scholarships, applications, checklist items, and deadlines. Administrators need tools to maintain the scholarship catalog and review application records.

### Objectives

- Implement scholarship, student, application, and administration workflows in C.
- Provide a browser-based interface backed by a Node.js/Express API and SQLite.
- Reuse the project's scholarship rules for transparent eligibility matching and recommendations.
- Demonstrate input validation, password handling, access control, and regression testing.

## Key Features

### C Core

- Windows console workflows for students and administrators.
- Scholarship catalog management, application tracking, eligibility matching, recommendations, and deadline tools.
- Salted PBKDF2-SHA-256 password hashes using Windows BCrypt.
- A JSON scholarship API mode (`scholarsync.exe --api scholarships`) used by the web integration bridge and the SQLite catalog importer.

### Student

- Register, sign in, and manage profile and password details.
- Browse and search scholarships; check eligibility and view recommendations based on the project's defined scholarship rules.
- Save scholarships, create and track applications, manage document checklist/status entries, and review deadlines/calendar information.

### Admin

- Sign in and manage scholarship records.
- Find students, review applications, and update application status.
- View dashboard statistics and reports; create database backups and export application data where supported by the relevant application workflow.

### Web Application

- Student and admin browser interfaces backed by the Express API.
- SQLite persistence for web accounts and workflows, including scholarships, saved scholarships, applications, checklist entries, and sessions.
- Same-origin `/api` proxying through the frontend server for HTTPS demo access; ordinary LAN HTTP continues to use the backend on port `3000`.

## System Architecture

The web application uses this primary data path:

```text
Browser frontend → Node.js / Express API → SQLite
```

The C program remains part of the system and has not been replaced by the web application. The backend can invoke its JSON API through a controlled executable bridge:

```text
Node.js / Express → C executable/API bridge → existing C system and data
```

The web catalog and web workflows use SQLite. The C executable remains available for its console workflows and the `/api/c/scholarships` bridge endpoint; the scholarship importer can seed/update the web catalog from the C JSON output. C text-file account workflows and web accounts in SQLite remain independent.

## Technology Stack

- **C** — console application and JSON scholarship API mode.
- **GCC and Windows BCrypt** — Windows C build and PBKDF2-SHA-256 password hashing.
- **Node.js 24.15 or later** — backend runtime (`node:sqlite` is built in).
- **Express 5** — REST API and static frontend server.
- **SQLite** — relational persistence for web application data.
- **HTML, CSS, and JavaScript** — browser interfaces.

## Student Workflow

1. Register or sign in, then complete profile details used by the listed matching rules.
2. Browse or search the scholarship catalog.
3. Check a scholarship's eligibility or review recommendations. These results explain matches against the project's defined rules; they do not guarantee provider approval.
4. Save scholarships and create an application tracking record through the apply flow.
5. Track application status, maintain checklist item/status entries, and review deadline and calendar information.

## Admin Workflow

1. Sign in with a configured admin account.
2. Add, edit, or manage scholarship catalog entries.
3. Search student records and review applications.
4. Update application review status and use available reports, backups, and exports.

## Build and Local Setup

### C application

On Windows, install a GCC toolchain that provides the BCrypt import library. From the project root, run:

```bat
build.bat
```

Then run `scholarsync.exe` from the project root. It reads and writes relative paths under `data/`. The `data/` directory, executable, and production records are excluded from this public repository; a fresh clone therefore does not include local account/catalog data. Backups may contain account hashes and personal information; keep them private.

### Web application

Install Node.js 24.15 or later. From `web/backend`, install the declared dependencies:

```text
npm install
```

Start the backend and frontend in separate terminals, both from `web/backend`:

```text
npm start
npm run start:frontend
```

Open [http://localhost:5500](http://localhost:5500). The backend defaults to port `3000`. For same-Wi-Fi testing, use the LAN frontend URL printed by the frontend server; the browser API configuration uses that hostname on port `3000`. The host firewall must allow the relevant ports on the private network. Treat LAN HTTP as a trusted-network development setup, not a way to send credentials over untrusted Wi-Fi.

### Database preparation

The SQLite database is separate from the C `data/` files. From `web/backend`, initialize the schema and apply pending migrations:

```text
npm run db:init
```

To import/update scholarships from the C catalog, first build the C executable and ensure its catalog data is available, then run from `web/backend`:

```text
npm run db:import-scholarships
```

This importer requires the project-root `scholarsync.exe` and invokes its JSON API mode. It does not import student or admin accounts. To configure an admin for the web application, create the admin through the C Admin Portal and then run `npm run db:import-admin` from `web/backend`; the script imports the existing salted password hash, not plaintext. Web student registration is separate from C text-file student accounts.

#### Web configuration

The backend defaults to `0.0.0.0:3000`; the frontend defaults to `0.0.0.0:5500`. Supported settings include `PORT`, `SCHOLARSYNC_HOST`, `SCHOLARSYNC_FRONTEND_PORT`, `SCHOLARSYNC_FRONTEND_HOST`, `SCHOLARSYNC_DATABASE_PATH`, `SCHOLARSYNC_BACKUP_DIR`, `SCHOLARSYNC_C_PROGRAM`, `SCHOLARSYNC_C_TIMEOUT_MS`, and `SCHOLARSYNC_CORS_ORIGINS`. The C bridge defaults to the project-root `ScholarSync.exe` on Windows. If `SCHOLARSYNC_CORS_ORIGINS` is unset, the backend keeps its permissive default; configure an allow-list when the deployment requires one.

For database schema, tables, environment settings, and workflow details, see [web/backend/DATABASE.md](web/backend/DATABASE.md).

## Testing and Verification

- **Phase 5 security regression:** 81/81 checks passed.
- **Phase 6 end-to-end regression:** 60/60 checks passed.
- **Phase 7 combined regression coverage:** 141/141 checks passed.
- **Additional recorded checks:** C API passed; SQLite integrity passed; foreign-key violations were zero.
- **Manual public HTTPS verification:** The project owner verified the public site, Student 3 login, dashboard access, and an authenticated scholarship save followed by unsave through the Cloudflare Quick Tunnel. The operation was reported as reversible and no new student or application was created.
- **Physical-device verification:** Project records document student and admin workflows on a physical iPhone. Android public-link access was verified, but broader Android workflow testing and physical tablet testing are not claimed. These device checks were manual, not automated.

See [PHASE7_REPORT.md](PHASE7_REPORT.md) for the documented Phase 7 regression and device-verification details. The private Phase 8 audit report is intentionally excluded from this public repository.

## Demo and Deployment

ScholarSync was manually demonstrated over the internet using a zero-cost Cloudflare Quick Tunnel. To start a new demo, first start the backend and frontend as above, then run in another terminal:

```text
cloudflared.exe tunnel --url http://localhost:5500
```

Open the HTTPS URL printed by `cloudflared`. The tunnel should target the frontend on port `5500`; the frontend server proxies same-origin `/api` requests to the backend on `localhost:3000`. Do not expose the backend port directly through the tunnel.

This is a temporary demo, not permanent production hosting. The laptop and the backend, frontend, and tunnel processes must remain running. A Quick Tunnel URL is temporary and may change when a new tunnel starts; it does not provide guaranteed uptime or a permanent custom domain.

## Limitations

- Scholarship catalog entries, eligibility rules, and dates are project-defined examples, not verified external provider data. Confirm official criteria and deadlines with providers before relying on them.
- Eligibility checks and recommendations are transparent rule-based matching, not AI/ML, and do not guarantee an award.
- The document feature tracks checklist items and statuses; it does not upload or store document files.
- The Cloudflare Quick Tunnel is temporary and requires the laptop and application services to stay running.
- Physical-device testing is limited to the scope documented above; physical tablet testing and broad Android workflow verification are not claimed.
- The Phase 8 audit recorded a saved-scholarship count discrepancy whose historical row-level origin could not be established because earlier snapshots did not preserve row identities. The database passed its integrity checks; no cleanup was performed based on unavailable historical evidence.

## Project Context

ScholarSync was completed as a B.Tech CSE project demonstrating a C application and its web extension, API integration, relational data persistence, authentication, and testing. It is an academic/demo project; scholarship data and temporary public access should not be treated as a verified provider directory or production hosting service.
