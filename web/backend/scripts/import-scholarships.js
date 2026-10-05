const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { initializeDatabase } = require("../database/database");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const C_PROGRAM = path.join(PROJECT_ROOT, "scholarsync.exe");

const UPSERT_SCHOLARSHIP = `
    INSERT INTO scholarships (
        scholarship_id, name, provider, description, amount, minimum_income,
        deadline, eligible_course, eligible_category, eligible_state,
        eligible_gender, disability_required, category, minimum_cgpa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scholarship_id) DO UPDATE SET
        name = excluded.name,
        provider = excluded.provider,
        description = excluded.description,
        amount = excluded.amount,
        minimum_income = excluded.minimum_income,
        deadline = excluded.deadline,
        eligible_course = excluded.eligible_course,
        eligible_category = excluded.eligible_category,
        eligible_state = excluded.eligible_state,
        eligible_gender = excluded.eligible_gender,
        disability_required = excluded.disability_required,
        category = excluded.category,
        minimum_cgpa = excluded.minimum_cgpa
`;

function validateScholarship(scholarship, index) {
    const requiredTextFields = [
        "name", "provider", "description", "deadline", "eligible_course",
        "eligible_category", "eligible_state", "eligible_gender",
        "disability_required", "category"
    ];
    if (!scholarship || !Number.isInteger(scholarship.id) || scholarship.id < 1) {
        throw new Error(`Scholarship record ${index + 1} has an invalid id.`);
    }
    for (const field of requiredTextFields) {
        if (typeof scholarship[field] !== "string") {
            throw new Error(`Scholarship ${scholarship.id} is missing a valid ${field} field.`);
        }
    }
    for (const field of ["amount", "minimum_income", "minimum_cgpa"]) {
        if (typeof scholarship[field] !== "number" || !Number.isFinite(scholarship[field])) {
            throw new Error(`Scholarship ${scholarship.id} has an invalid ${field} value.`);
        }
    }
}

function main() {
    let database;
    try {
        const output = execFileSync(C_PROGRAM, ["--api", "scholarships"], {
            cwd: PROJECT_ROOT,
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 5 * 1024 * 1024
        });
        const scholarships = JSON.parse(output);
        if (!Array.isArray(scholarships)) {
            throw new Error("The C API did not return a scholarship array.");
        }
        scholarships.forEach(validateScholarship);

        database = initializeDatabase();
        const upsert = database.prepare(UPSERT_SCHOLARSHIP);
        database.exec("BEGIN IMMEDIATE;");
        try {
            for (const scholarship of scholarships) {
                upsert.run(
                    scholarship.id,
                    scholarship.name,
                    scholarship.provider,
                    scholarship.description,
                    scholarship.amount,
                    scholarship.minimum_income,
                    scholarship.deadline,
                    scholarship.eligible_course,
                    scholarship.eligible_category,
                    scholarship.eligible_state,
                    scholarship.eligible_gender,
                    scholarship.disability_required,
                    scholarship.category,
                    scholarship.minimum_cgpa
                );
            }
            database.exec("COMMIT;");
        } catch (error) {
            database.exec("ROLLBACK;");
            throw error;
        }

        console.log(`Imported or updated ${scholarships.length} scholarship record(s) from the C API.`);
        console.log("Existing database rows not present in the C catalog were preserved.");
    } catch (error) {
        console.error(`Scholarship import failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        if (database) database.close();
    }
}

main();
