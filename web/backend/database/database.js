const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATABASE_PATH = process.env.SCHOLARSYNC_DATABASE_PATH ||
    path.join(__dirname, "scholarsync.sqlite");
const MIGRATIONS = [
    { version: 1, file: "001_initial_schema.sql" },
    { version: 2, file: "002_auth_sessions.sql" },
    { version: 3, file: "003_admin_sessions.sql" }
];
const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function initializeDatabase(databasePath = DATABASE_PATH) {
    if (databasePath !== ":memory:") {
        fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    const database = new DatabaseSync(databasePath, {
        enableForeignKeyConstraints: true,
        timeout: 5000
    });

    try {
        database.exec("PRAGMA foreign_keys = ON;");

        const versionRow = database.prepare("PRAGMA user_version;").get();
        const currentVersion = versionRow.user_version;

        if (currentVersion > CURRENT_SCHEMA_VERSION) {
            throw new Error(
                `Database schema version ${currentVersion} is newer than supported version ${CURRENT_SCHEMA_VERSION}.`
            );
        }

        for (const migration of MIGRATIONS) {
            if (migration.version <= currentVersion) continue;

            const migrationPath = path.join(__dirname, "migrations", migration.file);
            const migrationSql = fs.readFileSync(migrationPath, "utf8");
            database.exec("BEGIN IMMEDIATE;");
            try {
                database.exec(migrationSql);
                database.exec(`PRAGMA user_version = ${migration.version};`);
                database.exec("COMMIT;");
            } catch (error) {
                database.exec("ROLLBACK;");
                throw error;
            }
        }

        return database;
    } catch (error) {
        database.close();
        throw error;
    }
}

let sharedDatabase;

function getDatabase() {
    if (!sharedDatabase) {
        sharedDatabase = initializeDatabase();
    }
    return sharedDatabase;
}

function closeDatabase() {
    if (sharedDatabase) {
        sharedDatabase.close();
        sharedDatabase = undefined;
    }
}

module.exports = {
    DATABASE_PATH,
    closeDatabase,
    getDatabase,
    initializeDatabase
};

