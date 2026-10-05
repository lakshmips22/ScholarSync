CREATE TABLE IF NOT EXISTS students (
    student_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    course TEXT NOT NULL,
    annual_income REAL NOT NULL CHECK (annual_income >= 0),
    category TEXT NOT NULL,
    state TEXT NOT NULL,
    gender TEXT NOT NULL,
    disability TEXT NOT NULL CHECK (disability IN ('Yes', 'No')),
    cgpa REAL NOT NULL CHECK (cgpa >= 0 AND cgpa <= 10),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS scholarships (
    scholarship_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    minimum_income REAL NOT NULL CHECK (minimum_income >= -1),
    deadline TEXT NOT NULL,
    eligible_course TEXT NOT NULL,
    eligible_category TEXT NOT NULL,
    eligible_state TEXT NOT NULL,
    eligible_gender TEXT NOT NULL,
    disability_required TEXT NOT NULL,
    category TEXT NOT NULL,
    minimum_cgpa REAL NOT NULL CHECK (minimum_cgpa >= 0 AND minimum_cgpa <= 10)
) STRICT;

CREATE TABLE IF NOT EXISTS admins (
    admin_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE IF NOT EXISTS saved_scholarships (
    student_id INTEGER NOT NULL,
    scholarship_id INTEGER NOT NULL,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (student_id, scholarship_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
    FOREIGN KEY (scholarship_id) REFERENCES scholarships(scholarship_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS applications (
    application_id INTEGER PRIMARY KEY,
    student_id INTEGER NOT NULL,
    scholarship_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    applied_on TEXT NOT NULL,
    UNIQUE (student_id, scholarship_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE RESTRICT,
    FOREIGN KEY (scholarship_id) REFERENCES scholarships(scholarship_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE IF NOT EXISTS documents (
    document_id INTEGER PRIMARY KEY,
    application_id INTEGER NOT NULL,
    document_name TEXT NOT NULL,
    document_type TEXT,
    storage_path TEXT,
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Submitted', 'Verified', 'Rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES applications(application_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_scholarships_category
    ON scholarships(category);
CREATE INDEX IF NOT EXISTS idx_scholarships_deadline
    ON scholarships(deadline);
CREATE INDEX IF NOT EXISTS idx_saved_scholarships_scholarship
    ON saved_scholarships(scholarship_id);
CREATE INDEX IF NOT EXISTS idx_applications_student
    ON applications(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_scholarship
    ON applications(scholarship_id);
CREATE INDEX IF NOT EXISTS idx_documents_application
    ON documents(application_id);
