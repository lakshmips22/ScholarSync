const fs = require("node:fs");
const path = require("node:path");
const { getDatabase, closeDatabase } = require("../database/database");

const projectRoot = path.resolve(__dirname, "..", "..", "..");
const credentialFile = path.join(projectRoot, "data", "admin.txt");
const HASH_PATTERN = /^P1\$[0-9a-fA-F]{32}\$[0-9a-fA-F]{64}$/;

function main() {
    let db;
    try {
        if (!fs.existsSync(credentialFile)) {
            throw new Error("No C admin account file exists yet. Create the first admin from the C Admin Portal, then run this command again.");
        }
        const line = fs.readFileSync(credentialFile, "utf8").split(/\r?\n/, 1)[0];
        const separator = line.indexOf("|");
        if (separator < 1) throw new Error("The C admin credential record is malformed.");
        const username = line.slice(0, separator);
        const passwordHash = line.slice(separator + 1);
        if (Buffer.byteLength(username, "utf8") > 99 || username.includes("|") || !HASH_PATTERN.test(passwordHash)) {
            throw new Error("The C admin credential must have a valid username and a salted P1 password hash. Sign in through the C Admin Portal once if this is a legacy account.");
        }
        db = getDatabase();
        db.prepare(`
            INSERT INTO admins (username, password_hash, role)
            VALUES (?, ?, 'admin')
            ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, role = 'admin'
        `).run(username, passwordHash);
        console.log(`Imported the hashed C admin credential for ${username}.`);
    } catch (error) {
        console.error(`Admin credential import failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        closeDatabase();
    }
}

main();
