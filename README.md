# ScholarSync

ScholarSync is a beginner-friendly C console project for managing scholarship records.

## Build

Use a Windows GCC toolchain with the BCrypt import library installed, then run `build.bat` from this folder. The program uses Windows BCrypt for salted PBKDF2-SHA-256 password hashes.

## Run

Run `scholarsync.exe` from this folder. The program reads and writes files under `data/` using relative paths.

## Password records

New student and admin passwords are stored as salted hashes, not reversible plaintext. Backups may contain account hashes and personal data; keep them private.

## Scholarship catalog and eligibility

Student profiles include course, annual family income, category, state, gender, benchmark-disability status, and CGPA on a 0–10 scale. Scholarship entries can set matching rules for these fields. The current catalog's rules are project-defined examples and have not been verified with providers. The catalog dates are project-set planning dates, not verified provider deadlines. Confirm official eligibility and deadlines before relying on any entry.

## Included workflows

Student features include registration, login, profile and password updates, scholarship browsing/search, eligibility and recommendations, saved scholarships, application tracking, and deadline alerts. Admin features include scholarship management, application review, student lookup, statistics, data backup/restore, and CSV application export.

## Web application (development/demo)

The existing web app is in `web/frontend` and its Express/SQLite API is in `web/backend`. From the `web/backend` folder, install the package dependencies once with `npm install`, then use two terminals:

```text
npm start
npm run start:frontend
```

Open `http://localhost:5500` on the host computer. Both servers print same-network URLs when a LAN IPv4 address is available. To try the app on a phone or tablet connected to the same Wi-Fi, open the frontend URL printed by `start:frontend` (for example, `http://192.168.x.x:5500`). The API URL follows that hostname automatically and uses port 3000. The phone is only a browser client; Node.js, SQLite, and the C executable run on the host. Host firewall rules must allow incoming connections to ports 5500 and 3000 on the private network.

On an HTTP LAN page, the default browser API base is `http://<page-hostname>:3000/api`. HTTPS pages use the same origin at `/api`; the frontend server proxies those requests to the Express backend on `localhost:3000`. To point a page at another API, define `window.SCHOLARSYNC_API_BASE` before `api-config.js` loads (for example, in a small configuration script immediately before it). `SCHOLARSYNC_HOST` (default `0.0.0.0`) and `SCHOLARSYNC_FRONTEND_HOST` (default `0.0.0.0`) control the bind addresses; `PORT` (default `3000`) and `SCHOLARSYNC_FRONTEND_PORT` (default `5500`) control ports. Existing `SCHOLARSYNC_DATABASE_PATH`, `SCHOLARSYNC_BACKUP_DIR`, `SCHOLARSYNC_C_PROGRAM`, `SCHOLARSYNC_C_TIMEOUT_MS`, and `SCHOLARSYNC_CORS_ORIGINS` settings remain supported. The C bridge requires the project-root `ScholarSync.exe` on Windows, or `SCHOLARSYNC_C_PROGRAM` set to a compatible executable.

### Zero-cost public demo with Cloudflare Quick Tunnel

The project user manually verified public access through this Quick Tunnel URL:
`https://primarily-pig-void-converter.trycloudflare.com`

To start a new public demo, first start the backend and frontend as above, then run this in another terminal:

```text
cloudflared.exe tunnel --url http://localhost:5500
```

Use the HTTPS URL printed by `cloudflared`. The tunnel targets the frontend; `/api` is proxied by the frontend server to the backend on `localhost:3000`, so the browser uses one public URL. Do not point the tunnel at port 3000. The tunnel provides public HTTPS while the local origin remains HTTP.

This is a temporary demonstration, not permanent production hosting. The laptop must remain on, with the ScholarSync backend, frontend, and `cloudflared` processes running. The Quick Tunnel URL is random and may change each time a new tunnel is started. This does not provide 24/7 uptime or a permanent custom domain. LAN HTTP access remains available as described above; for LAN use, the host firewall must allow the existing frontend and backend ports on the private network.

## Phase 7 verification

See [PHASE7_REPORT.md](PHASE7_REPORT.md) for the final regression results, physical iPhone verification, and the project user's public Quick Tunnel/device checks. Android public-link access was verified; broader Android workflow and physical tablet testing are not claimed.

## Phase 8 completion audit

Phase 8 is complete. Phase 5 security checks passed 81/81, Phase 6 E2E checks passed 60/60, and combined Phase 7 regression coverage passed 141/141. The project owner manually verified public HTTPS login, dashboard access, and scholarship save/unsave. The historical saved-scholarship count discrepancy remains unresolved because earlier row-level snapshots are unavailable; current database integrity checks passed. The audit report containing production row identifiers is excluded from this public repository. The Cloudflare Quick Tunnel is temporary and requires the laptop and application services to remain running.
