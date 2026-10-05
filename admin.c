#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <string.h>
#include "admin.h"
#include "password.h"
#include "application.h"
#include "file_manager.h"
#include "scholarship.h"

#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define ADMIN_DATA_FILE "data/admin.txt"
#define INPUT_SIZE 600
#define LINE_SIZE 1200

typedef enum {
    INPUT_OK,
    INPUT_INVALID
} InputResult;

static InputResult readField(const char *prompt, char *value, size_t capacity)
{
    size_t length;
    int character;

    printf("%s", prompt);
    if (fgets(value, (int)capacity, stdin) == NULL) {
        return INPUT_INVALID;
    }
    length = strlen(value);
    if (length > 0 && value[length - 1] == '\n') {
        value[length - 1] = '\0';
        return INPUT_OK;
    }
    while ((character = getchar()) != '\n' && character != EOF) {
    }
    return INPUT_INVALID;
}

static int hasDelimiter(const char *value)
{
    return strchr(value, '|') != NULL;
}

static int validDeadline(const char *value)
{
    int year;
    int month;
    int day;
    char extra;
    struct tm date = {0};

    if (strlen(value) != 10 ||
        sscanf(value, "%4d-%2d-%2d%c", &year, &month, &day, &extra) != 3 ||
        value[4] != '-' || value[7] != '-') {
        return 0;
    }
    date.tm_year = year - 1900;
    date.tm_mon = month - 1;
    date.tm_mday = day;
    date.tm_isdst = -1;
    if (mktime(&date) == (time_t)-1) {
        return 0;
    }
    return date.tm_year == year - 1900 && date.tm_mon == month - 1 &&
           date.tm_mday == day;
}
static int nextScholarshipId(void)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    int id;
    int largestId = 0;

    if (file == NULL) {
        return 1;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (sscanf(line, "%d|", &id) == 1 && id > largestId) {
            largestId = id;
        }
    }
    fclose(file);
    return largestId + 1;
}

static int readAmount(const char *prompt, float *amount)
{
    char input[INPUT_SIZE];
    char *end;

    if (readField(prompt, input, sizeof(input)) != INPUT_OK || input[0] == '\0') {
        return 0;
    }
    *amount = strtof(input, &end);
    return end != input && *end == '\0' && isfinite(*amount) && *amount >= 0.0f;
}

static int readIncomeLimit(const char *prompt, float *amount)
{
    char input[INPUT_SIZE];
    char *end;

    if (readField(prompt, input, sizeof(input)) != INPUT_OK || input[0] == '\0') return 0;
    *amount = strtof(input, &end);
    return end != input && *end == '\0' && isfinite(*amount) &&
           (*amount >= 0.0f || *amount == -1.0f);
}

static void addScholarship(void)
{
    Scholarship scholarship = {0};
    FILE *file;

    puts("\n-------------------- ADD SCHOLARSHIP --------------------");
    if (readField("Scholarship name: ", scholarship.name, sizeof(scholarship.name)) != INPUT_OK ||
        scholarship.name[0] == '\0' || hasDelimiter(scholarship.name)) {
        puts("Invalid name. Use up to 149 characters and do not use '|'.");
        return;
    }
    if (readField("Provider: ", scholarship.provider, sizeof(scholarship.provider)) != INPUT_OK ||
        scholarship.provider[0] == '\0' || hasDelimiter(scholarship.provider)) {
        puts("Invalid provider. Use up to 99 characters and do not use '|'.");
        return;
    }
    if (readField("Description: ", scholarship.description, sizeof(scholarship.description)) != INPUT_OK ||
        scholarship.description[0] == '\0' || hasDelimiter(scholarship.description)) {
        puts("Invalid description. Use up to 499 characters and do not use '|'.");
        return;
    }
    if (readField("Scholarship category (e.g., Merit, Need-Based): ", scholarship.category,
                  sizeof(scholarship.category)) != INPUT_OK ||
        scholarship.category[0] == '\0' || hasDelimiter(scholarship.category)) {
        puts("Enter a category of up to 39 characters without '|'."); return;
    }
    if (!readAmount("Award amount: ", &scholarship.amount)) {
        puts("Enter a valid non-negative award amount.");
        return;
    }
    if (!readIncomeLimit("Maximum family income (-1 not specified, 0 no limit): ", &scholarship.minimum_income)) {
        puts("Enter -1, 0, or a valid non-negative income amount.");
        return;
    }
    if (!readAmount("Minimum CGPA (0 to 10; 0 means no minimum): ", &scholarship.minimum_cgpa) ||
        scholarship.minimum_cgpa > 10.0f) {
        puts("Enter a minimum CGPA from 0 to 10."); return;
    }
    if (readField("Deadline (YYYY-MM-DD): ", scholarship.deadline,
                  sizeof(scholarship.deadline)) != INPUT_OK ||
        !validDeadline(scholarship.deadline)) {
        puts("Enter a real calendar date in YYYY-MM-DD format.");
        return;
    }

    if (readField("Eligible course (enter Any for no restriction): ", scholarship.eligible_course,
                  sizeof(scholarship.eligible_course)) != INPUT_OK ||
        hasDelimiter(scholarship.eligible_course)) {
        puts("Enter a valid course name without '|'.");
        return;
    }
    if (scholarship.eligible_course[0] == '\0') strcpy(scholarship.eligible_course, "Any");

    puts("Use Any when a profile field has no scheme restriction.");
    if (readField("Required student category: ", scholarship.eligible_category, sizeof(scholarship.eligible_category)) != INPUT_OK ||
        readField("Required state/UT: ", scholarship.eligible_state, sizeof(scholarship.eligible_state)) != INPUT_OK ||
        readField("Required gender: ", scholarship.eligible_gender, sizeof(scholarship.eligible_gender)) != INPUT_OK ||
        readField("Disability requirement (Any/Yes): ", scholarship.disability_required, sizeof(scholarship.disability_required)) != INPUT_OK) {
        puts("Could not read the profile criteria."); return;
    }
    if (!scholarship.eligible_category[0]) strcpy(scholarship.eligible_category, "Any");
    if (!scholarship.eligible_state[0]) strcpy(scholarship.eligible_state, "Any");
    if (!scholarship.eligible_gender[0]) strcpy(scholarship.eligible_gender, "Any");
    if (!scholarship.disability_required[0]) strcpy(scholarship.disability_required, "Any");
    if (hasDelimiter(scholarship.eligible_category) || hasDelimiter(scholarship.eligible_state) ||
        hasDelimiter(scholarship.eligible_gender) || hasDelimiter(scholarship.disability_required) ||
        (strcmp(scholarship.disability_required, "Any") != 0 && strcmp(scholarship.disability_required, "Yes") != 0)) {
        puts("Use plain text for profile criteria and disability requirement Any or Yes."); return;
    }

    scholarship.id = nextScholarshipId();
    file = fopen(SCHOLARSHIP_DATA_FILE, "a");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }
    if (fprintf(file, "%d|%s|%s|%s|%.2f|%.2f|%s|%s|%s|%s|%s|%s|%s|%.2f\n", scholarship.id,
                scholarship.name, scholarship.provider, scholarship.description,
                scholarship.amount, scholarship.minimum_income,
                scholarship.deadline, scholarship.eligible_course,
                scholarship.eligible_category, scholarship.eligible_state,
                scholarship.eligible_gender, scholarship.disability_required,
                scholarship.category, scholarship.minimum_cgpa) < 0) {
        puts("Could not save the scholarship.");
        fclose(file);
        return;
    }
    fclose(file);
    printf("Scholarship added with ID %d.\n", scholarship.id);
}

static int readMenuChoice(int maximum)
{
    char input[INPUT_SIZE];
    char *end;
    long choice;

    if (readField("Enter your choice: ", input, sizeof(input)) != INPUT_OK) {
        return feof(stdin) ? -2 : -1;
    }
    choice = strtol(input, &end, 10);
    while (*end == ' ' || *end == '\t') {
        end++;
    }
    if (end == input || *end != '\0' || choice < 1 || choice > maximum) {
        return -1;
    }
    return (int)choice;
}

static int saveAdminCredential(const char *username, const char *storedPassword)
{
    FILE *temporary = fopen("data/admin.tmp", "w");
    int writeOk;

    if (temporary == NULL) return 0;
    writeOk = fprintf(temporary, "%s|%s\n", username, storedPassword) >= 0;
    if (fclose(temporary) != 0) writeOk = 0;
    if (!writeOk) {
        remove("data/admin.tmp");
        return 0;
    }
    /* On first setup the original file may not exist, so its removal is optional. */
    remove(ADMIN_DATA_FILE);
    if (rename("data/admin.tmp", ADMIN_DATA_FILE) != 0) {
        remove("data/admin.tmp");
        return 0;
    }
    return 1;
}

static int authenticateAdmin(void)
{
    FILE *file = fopen(ADMIN_DATA_FILE, "r");
    char line[LINE_SIZE];
    char savedUsername[100];
    char savedPassword[128];
    char username[100];
    char password[100];
    char hashedPassword[128];

    if (file == NULL || fgets(line, sizeof(line), file) == NULL) {
        if (file != NULL) fclose(file);
        puts("No admin account exists yet. Create the first account.");
        if (readField("Choose admin username: ", username, sizeof(username)) != INPUT_OK ||
            username[0] == '\0' || hasDelimiter(username)) {
            puts("Invalid username. Admin setup was not completed.");
            return 0;
        }
        if (readField("Choose admin password: ", password, sizeof(password)) != INPUT_OK ||
            password[0] == '\0') {
            puts("Invalid password. Admin setup was not completed.");
            return 0;
        }
        if (!hashPassword(password, hashedPassword, sizeof(hashedPassword))) {
            puts("Could not securely store the admin password.");
            return 0;
        }
        if (!saveAdminCredential(username, hashedPassword)) {
            puts("Could not save the admin account.");
            return 0;
        }
        puts("[SUCCESS] Admin account created. You are now logged in.");
        return 1;
    }
    if (sscanf(line, "%99[^|]|%127[^\r\n]", savedUsername, savedPassword) != 2) {
        fclose(file);
        puts("The admin account file is invalid.");
        return 0;
    }
    fclose(file);

    puts("\n-------------------- ADMIN LOGIN --------------------");
    if (readField("Username: ", username, sizeof(username)) != INPUT_OK ||
        readField("Password: ", password, sizeof(password)) != INPUT_OK) {
        puts("Please try again with shorter input.");
        return 0;
    }
    if (strcmp(username, savedUsername) != 0 || !verifyPassword(password, savedPassword)) {
        puts("[ERROR] Username or password is incorrect.");
        return 0;
    }
    if (!passwordIsHashed(savedPassword)) {
        if (!hashPassword(password, hashedPassword, sizeof(hashedPassword)) ||
            !saveAdminCredential(savedUsername, hashedPassword)) {
            puts("Warning: admin login succeeded, but the old password record could not be upgraded.");
        }
    }
    puts("[SUCCESS] Admin login successful!");
    return 1;
}

#define SCHOLARSHIP_TEMP_FILE "data/scholarships.tmp"

static int readPositiveId(const char *prompt, int *id)
{
    char input[INPUT_SIZE];
    char *end;
    long value;

    if (readField(prompt, input, sizeof(input)) != INPUT_OK) {
        return 0;
    }
    value = strtol(input, &end, 10);
    while (*end == ' ' || *end == '\t') {
        end++;
    }
    if (end == input || *end != '\0' || value < 1 || value > 2147483647L) {
        return 0;
    }
    *id = (int)value;
    return 1;
}

static int parseScholarship(const char *line, Scholarship *scholarship)
{
    memset(scholarship, 0, sizeof(*scholarship));
    int fields = sscanf(line,
        "%d|%149[^|]|%99[^|]|%499[^|]|%f|%f|%19[^|\r\n]|%99[^|\r\n]|%29[^|\r\n]|%59[^|\r\n]|%19[^|\r\n]|%9[^|\r\n]|%39[^|]|%f",
        &scholarship->id, scholarship->name, scholarship->provider,
        scholarship->description, &scholarship->amount,
        &scholarship->minimum_income, scholarship->deadline,
        scholarship->eligible_course, scholarship->eligible_category,
        scholarship->eligible_state, scholarship->eligible_gender,
        scholarship->disability_required, scholarship->category,
        &scholarship->minimum_cgpa);

    if (fields == 7) {
        strcpy(scholarship->eligible_course, "Any");
    }
    if (fields == 7 || fields == 8) {
        strcpy(scholarship->eligible_category, "Any");
        strcpy(scholarship->eligible_state, "Any");
        strcpy(scholarship->eligible_gender, "Any");
        strcpy(scholarship->disability_required, "Any");
        strcpy(scholarship->category, "Unclassified");
        scholarship->minimum_cgpa = 0.0f;
        return 1;
    }
    if (fields == 12) strcpy(scholarship->category, "Unclassified");
    if (fields == 12 || fields == 13) scholarship->minimum_cgpa = 0.0f;
    return fields == 12 || fields == 13 || fields == 14;
}

static int writeScholarship(FILE *file, const Scholarship *scholarship)
{
    return fprintf(file, "%d|%s|%s|%s|%.2f|%.2f|%s|%s|%s|%s|%s|%s|%s|%.2f\n", scholarship->id,
                   scholarship->name, scholarship->provider,
                   scholarship->description, scholarship->amount,
                   scholarship->minimum_income, scholarship->deadline,
                   scholarship->eligible_course, scholarship->eligible_category,
                   scholarship->eligible_state, scholarship->eligible_gender,
                   scholarship->disability_required, scholarship->category,
                   scholarship->minimum_cgpa) >= 0;
}

static int promptOptionalText(const char *prompt, char *value, size_t capacity)
{
    if (readField(prompt, value, capacity) != INPUT_OK || hasDelimiter(value)) {
        return 0;
    }
    return 1;
}

static int promptOptionalAmount(const char *prompt, float *value)
{
    char input[INPUT_SIZE];
    char *end;
    float parsed;

    if (readField(prompt, input, sizeof(input)) != INPUT_OK) {
        return 0;
    }
    if (input[0] == '\0') {
        return 1;
    }
    parsed = strtof(input, &end);
    if (end == input || *end != '\0' || !isfinite(parsed) || parsed < 0.0f) {
        return 0;
    }
    *value = parsed;
    return 1;
}

static int promptOptionalIncomeLimit(const char *prompt, float *value)
{
    char input[INPUT_SIZE];
    char *end;
    float parsed;

    if (readField(prompt, input, sizeof(input)) != INPUT_OK) return 0;
    if (input[0] == '\0') return 1;
    parsed = strtof(input, &end);
    if (end == input || *end != '\0' || !isfinite(parsed) ||
        (parsed < 0.0f && parsed != -1.0f)) return 0;
    *value = parsed;
    return 1;
}

static int saveEditedScholarship(const Scholarship *updated)
{
    FILE *source = fopen(SCHOLARSHIP_DATA_FILE, "r");
    FILE *temporary;
    char line[LINE_SIZE];
    Scholarship current;
    int found = 0;
    int writeOk = 1;

    if (source == NULL) {
        return 0;
    }
    temporary = fopen(SCHOLARSHIP_TEMP_FILE, "w");
    if (temporary == NULL) {
        fclose(source);
        return 0;
    }
    while (fgets(line, sizeof(line), source) != NULL) {
        if (parseScholarship(line, &current) && current.id == updated->id) {
            if (!writeScholarship(temporary, updated)) {
                writeOk = 0;
                break;
            }
            found = 1;
        } else if (fputs(line, temporary) == EOF) {
            writeOk = 0;
            break;
        }
    }
    if (ferror(source)) {
        writeOk = 0;
    }
    if (fclose(source) != 0) {
        writeOk = 0;
    }
    if (fclose(temporary) != 0) {
        writeOk = 0;
    }
    if (!writeOk || !found) {
        remove(SCHOLARSHIP_TEMP_FILE);
        return 0;
    }
    if (remove(SCHOLARSHIP_DATA_FILE) != 0 || rename(SCHOLARSHIP_TEMP_FILE, SCHOLARSHIP_DATA_FILE) != 0) {
        puts("Could not replace the scholarship file.");
        return 0;
    }
    return 1;
}

static void editScholarship(void)
{
    int id;
    int found = 0;
    FILE *file;
    char line[LINE_SIZE];
    char text[INPUT_SIZE];
    Scholarship scholarship;

    puts("\n-------------------- EDIT SCHOLARSHIP --------------------");
    if (!readPositiveId("Scholarship ID to edit: ", &id)) {
        puts("Enter a valid positive scholarship ID.");
        return;
    }
    file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseScholarship(line, &scholarship) && scholarship.id == id) {
            found = 1;
            break;
        }
    }
    fclose(file);
    if (!found) {
        puts("That scholarship ID was not found.");
        return;
    }

    puts("Press Enter to keep each current value.");
    if (!promptOptionalText("Name: ", text, sizeof(text))) {
        puts("Invalid name."); return;
    }
    if (text[0] != '\0') {
        if (strlen(text) >= sizeof(scholarship.name)) { puts("Name is too long."); return; }
        strcpy(scholarship.name, text);
    }
    if (!promptOptionalText("Provider: ", text, sizeof(text))) {
        puts("Invalid provider."); return;
    }
    if (text[0] != '\0') {
        if (strlen(text) >= sizeof(scholarship.provider)) { puts("Provider is too long."); return; }
        strcpy(scholarship.provider, text);
    }
    if (!promptOptionalText("Description: ", text, sizeof(text))) {
        puts("Invalid description."); return;
    }
    if (text[0] != '\0') {
        if (strlen(text) >= sizeof(scholarship.description)) { puts("Description is too long."); return; }
        strcpy(scholarship.description, text);
    }
    if (!promptOptionalText("Scholarship category: ", text, sizeof(text))) {
        puts("Invalid scholarship category."); return;
    }
    if (text[0] != '\0') {
        if (strlen(text) >= sizeof(scholarship.category)) { puts("Category is too long."); return; }
        strcpy(scholarship.category, text);
    }
    if (!promptOptionalAmount("Award amount: ", &scholarship.amount) ||
        !promptOptionalIncomeLimit("Maximum family income (-1 not specified, 0 no limit): ", &scholarship.minimum_income)) {
        puts("Enter valid non-negative amounts.");
        return;
    }
    if (!promptOptionalAmount("Minimum CGPA (0 to 10; 0 means no minimum): ", &scholarship.minimum_cgpa) ||
        scholarship.minimum_cgpa > 10.0f) {
        puts("Enter a minimum CGPA from 0 to 10."); return;
    }
    if (!promptOptionalText("Deadline (YYYY-MM-DD): ", text, sizeof(text))) {
        puts("Invalid deadline."); return;
    }
    if (text[0] != '\0') {
        if (!validDeadline(text)) { puts("Enter a real date in YYYY-MM-DD format."); return; }
        if (strlen(text) >= sizeof(scholarship.deadline)) { puts("Deadline is too long."); return; }
        strcpy(scholarship.deadline, text);
    }

    if (!promptOptionalText("Eligible course (Any means unrestricted): ", text, sizeof(text))) {
        puts("Invalid course."); return;
    }
    if (text[0] != '\0') {
        if (strlen(text) >= sizeof(scholarship.eligible_course)) { puts("Course is too long."); return; }
        strcpy(scholarship.eligible_course, text);
    }

    if (!promptOptionalText("Required student category (Any means unrestricted): ", text, sizeof(text))) { puts("Invalid category."); return; }
    if (text[0] && strlen(text) >= sizeof(scholarship.eligible_category)) { puts("Category is too long."); return; }
    if (text[0]) strcpy(scholarship.eligible_category, text);
    if (!promptOptionalText("Required state/UT (Any means unrestricted): ", text, sizeof(text))) { puts("Invalid state."); return; }
    if (text[0] && strlen(text) >= sizeof(scholarship.eligible_state)) { puts("State is too long."); return; }
    if (text[0]) strcpy(scholarship.eligible_state, text);
    if (!promptOptionalText("Required gender (Any means unrestricted): ", text, sizeof(text))) { puts("Invalid gender."); return; }
    if (text[0] && strlen(text) >= sizeof(scholarship.eligible_gender)) { puts("Gender is too long."); return; }
    if (text[0]) strcpy(scholarship.eligible_gender, text);
    if (!promptOptionalText("Disability requirement Any or Yes: ", text, sizeof(text))) { puts("Invalid disability rule."); return; }
    if (text[0] && strcmp(text, "Any") != 0 && strcmp(text, "Yes") != 0) { puts("Use Any or Yes."); return; }
    if (text[0]) strcpy(scholarship.disability_required, text);

    if (saveEditedScholarship(&scholarship)) {
        puts("Scholarship updated.");
    } else {
        puts("Could not save the scholarship changes.");
    }
}

static int scholarshipHasReferences(int scholarshipId)
{
    FILE *file;
    int first;
    int second;
    int third;
    char status[30];
    char date[20];

    file = fopen("data/saved.txt", "r");
    if (file != NULL) {
        while (fscanf(file, "%d|%d", &first, &second) == 2) {
            if (second == scholarshipId) { fclose(file); return 1; }
        }
        fclose(file);
    }
    file = fopen("data/applications.txt", "r");
    if (file != NULL) {
        while (fscanf(file, "%d|%d|%d|%29[^|]|%19[^\r\n]",
                      &first, &second, &third, status, date) == 5) {
            if (third == scholarshipId) { fclose(file); return 1; }
        }
        fclose(file);
    }
    return 0;
}

static int removeScholarshipRecord(int scholarshipId)
{
    FILE *source = fopen(SCHOLARSHIP_DATA_FILE, "r");
    FILE *temporary;
    char line[LINE_SIZE];
    Scholarship scholarship;
    int found = 0;
    int writeOk = 1;

    if (source == NULL) return 0;
    temporary = fopen(SCHOLARSHIP_TEMP_FILE, "w");
    if (temporary == NULL) { fclose(source); return 0; }
    while (fgets(line, sizeof(line), source) != NULL) {
        if (parseScholarship(line, &scholarship) && scholarship.id == scholarshipId) {
            found = 1;
        } else if (fputs(line, temporary) == EOF) {
            writeOk = 0; break;
        }
    }
    if (ferror(source)) writeOk = 0;
    if (fclose(source) != 0) writeOk = 0;
    if (fclose(temporary) != 0) writeOk = 0;
    if (!writeOk || !found) { remove(SCHOLARSHIP_TEMP_FILE); return 0; }
    if (remove(SCHOLARSHIP_DATA_FILE) != 0 || rename(SCHOLARSHIP_TEMP_FILE, SCHOLARSHIP_DATA_FILE) != 0) {
        puts("Could not replace the scholarship file."); return 0;
    }
    return 1;
}

static void removeScholarship(void)
{
    int id;
    char answer[INPUT_SIZE];

    puts("\n-------------------- REMOVE SCHOLARSHIP --------------------");
    if (!readPositiveId("Scholarship ID to remove: ", &id)) {
        puts("Enter a valid positive scholarship ID."); return;
    }
    if (scholarshipHasReferences(id)) {
        puts("This scholarship has saved entries or applications and cannot be removed yet.");
        return;
    }
    if (readField("Type YES to confirm removal: ", answer, sizeof(answer)) != INPUT_OK ||
        strcmp(answer, "YES") != 0) {
        puts("Removal cancelled."); return;
    }
    if (removeScholarshipRecord(id)) {
        printf("Scholarship %d removed.\n", id);
    } else {
        puts("That scholarship was not found or could not be removed.");
    }
}
static int parseStudentRecord(const char *line, Student *student)
{
    int fields;
    memset(student, 0, sizeof(*student));
    fields = sscanf(line, "%d|%99[^|]|%99[^|]|%127[^|]|%99[^|]|%f|%29[^|]|%59[^|]|%19[^|]|%9[^|\r\n]|%f",
                  &student->id, student->name, student->email,
                  student->password, student->course,
                  &student->annual_income, student->category, student->state,
                  student->gender, student->disability, &student->cgpa);
    if (fields == 6) {
        strcpy(student->category, "Any"); strcpy(student->state, "Any");
        strcpy(student->gender, "Any"); strcpy(student->disability, "No");
        return 1;
    }
    if (fields == 10) student->cgpa = 0.0f;
    return fields == 10 || fields == 11;
}

static void listStudents(void)
{
    FILE *file = fopen("data/students.txt", "r");
    char line[1200];
    Student student;
    int found = 0;

    puts("\n-------------------- REGISTERED STUDENTS --------------------");
    if (file == NULL) {
        puts("Could not open the student data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseStudentRecord(line, &student)) {
            printf("\nStudent ID: %d\nName: %s\nEmail: %s\nCourse: %s\n",
                   student.id, student.name, student.email, student.course);
            printf("Annual family income: %.2f\n", student.annual_income);
            printf("CGPA: %.2f / 10.00\n", student.cgpa);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("No student accounts are registered yet.");
    }
}
static void searchStudent(void)
{
    FILE *file;
    char line[1200];
    Student student;
    int studentId;
    int found = 0;

    puts("\n-------------------- SEARCH STUDENT --------------------");
    if (!readPositiveId("Student ID: ", &studentId)) {
        puts("Enter a valid positive student ID.");
        return;
    }
    file = fopen("data/students.txt", "r");
    if (file == NULL) {
        puts("Could not open the student data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseStudentRecord(line, &student) && student.id == studentId) {
            printf("\nStudent ID: %d\nName: %s\nEmail: %s\nCourse: %s\n",
                   student.id, student.name, student.email, student.course);
            printf("Annual family income: %.2f\n", student.annual_income);
            printf("CGPA: %.2f / 10.00\n", student.cgpa);
            found = 1;
            break;
        }
    }
    fclose(file);
    if (!found) {
        puts("Student ID was not found.");
    }
}
static int countValidRecords(const char *path, int recordType, int *pending,
                             int *approved, int *rejected)
{
    FILE *file = fopen(path, "r");
    char line[1200];
    int count = 0;

    if (file == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        int id;
        int studentId;
        int scholarshipId;
        int savedStudentId;
        int savedScholarshipId;
        char name[150];
        Scholarship parsedScholarship;
        char status[30];
        char date[20];
        char email[100];
        char password[128];
        char course[100];
        float income;

        if (recordType == 1 &&
            sscanf(line, "%d|%99[^|]|%99[^|]|%127[^|]|%99[^|]|%f", &id,
                   name, email, password, course, &income) == 6) {
            count++;
        } else if (recordType == 2 && parseScholarship(line, &parsedScholarship)) {
            count++;
        } else if (recordType == 3 &&
            sscanf(line, "%d|%d|%d|%29[^|]|%19[^\r\n]", &id, &studentId,
                   &scholarshipId, status, date) == 5) {
            count++;
            if (strcmp(status, "Pending") == 0) (*pending)++;
            else if (strcmp(status, "Approved") == 0) (*approved)++;
            else if (strcmp(status, "Rejected") == 0) (*rejected)++;
        } else if (recordType == 4 &&
                   sscanf(line, "%d|%d", &savedStudentId, &savedScholarshipId) == 2) {
            count++;
        }
    }
    fclose(file);
    return count;
}

static void showStatistics(void)
{
    int pending = 0;
    int approved = 0;
    int rejected = 0;
    int students = countValidRecords("data/students.txt", 1, &pending, &approved, &rejected);
    int scholarships = countValidRecords("data/scholarships.txt", 2, &pending, &approved, &rejected);
    int applications = countValidRecords("data/applications.txt", 3, &pending, &approved, &rejected);
    int saved = countValidRecords("data/saved.txt", 4, &pending, &approved, &rejected);

    puts("\n-------------------- SCHOLARSYNC STATISTICS --------------------");
    printf("Registered students: %d\n", students);
    printf("Scholarships: %d\n", scholarships);
    printf("Saved scholarship entries: %d\n", saved);
    printf("Applications: %d\n", applications);
    printf("  Pending: %d\n", pending);
    printf("  Approved: %d\n", approved);
    printf("  Rejected: %d\n", rejected);
}
static void adminDashboard(void)
{
    int choice;

    for (;;) {
        puts("\n============================================================");
        puts("                     ADMIN DASHBOARD");
        puts("============================================================");
        puts("  1. Add Scholarship");
        puts("  2. List Scholarships");
        puts("  3. Edit Scholarship");
        puts("  4. Remove Scholarship");
        puts("  5. Review Applications");
        puts("  6. List Students");
        puts("  7. Search Student by ID");
        puts("  8. Statistics");
        puts("  9. Backup Data");
        puts(" 10. Restore Data");
        puts(" 11. Export Application Report");
        puts(" 12. Logout");
        puts("------------------------------------------------------------");

        choice = readMenuChoice(12);
        if (choice == -2) { puts("Input ended; returning to the previous menu."); return; }
        switch (choice) {
        case 1:
            addScholarship();
            break;
        case 2:
            browseScholarships();
            break;
        case 3:
            editScholarship();
            break;
        case 4:
            removeScholarship();
            break;
        case 5:
            reviewApplications();
            break;
        case 6:
            listStudents();
            break;
        case 7:
            searchStudent();
            break;
        case 8:
            showStatistics();
            break;
        case 9:
            backupData();
            break;
        case 10:
            restoreData();
            break;
        case 11:
            exportApplicationReport();
            break;
        case 12:
            puts("Admin logged out.");
            return;
        default:
            puts("[ERROR] Invalid choice. Please enter a number from 1 to 12.");
        }
    }
}

void adminPortal(void)
{
    int choice;

    for (;;) {
        puts("\n========================================");
        puts("               ADMIN PORTAL");
        puts("========================================");
        puts("1. Login");
        puts("2. Back");
        choice = readMenuChoice(2);
        if (choice == -2) { puts("Input ended; returning to the previous menu."); return; }
        switch (choice) {
        case 1:
            if (authenticateAdmin()) {
                adminDashboard();
            }
            break;
        case 2:
            return;
        default:
            puts("Invalid choice. Please select 1 or 2.");
        }
    }
}














