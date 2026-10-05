const path = require("node:path");
const { DATABASE_PATH, initializeDatabase } = require("../database/database");

let database;

try {
    database = initializeDatabase();
    const version = database.prepare("PRAGMA user_version;").get().user_version;
    const actualPath = path.resolve(DATABASE_PATH);
    console.log(`ScholarSync database ready: ${actualPath} (schema version ${version})`);
} catch (error) {
    console.error(`Database initialization failed: ${error.message}`);
    process.exitCode = 1;
} finally {
    if (database) database.close();
}
