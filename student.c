#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "student.h"
#include "password.h"
#include "application.h"
#include "scholarship.h"
#include "eligibility.h"
#include "deadline.h"

#define STUDENT_DATA_FILE "data/students.txt"
#define STUDENT_TEMP_FILE "data/students.tmp"
#define INPUT_SIZE 256
#define RECORD_SIZE 1024

typedef enum {
    INPUT_OK,
    INPUT_TOO_LONG,
    INPUT_END
} InputResult;

static InputResult readLine(const char *prompt, char *buffer, size_t size)
{
    size_t length;
    int character;

    printf("%s", prompt);
    if (fgets(buffer, (int)size, stdin) == NULL) {
        return INPUT_END;
    }

    length = strlen(buffer);
    if (length > 0 && buffer[length - 1] == '\n') {
        buffer[length - 1] = '\0';
        return INPUT_OK;
    }

    while ((character = getchar()) != '\n' && character != EOF) {
    }
    return INPUT_TOO_LONG;
}

static int containsDelimiter(const char *text)
{
    return strchr(text, '|') != NULL;
}

static int validEmail(const char *email)
{
    const char *at = strchr(email, '@');
    const char *dot;
    const unsigned char *character;

    if (at == NULL || at == email || strchr(at + 1, '@') != NULL) return 0;
    dot = strchr(at + 1, '.');
    if (dot == NULL || dot == at + 1 || dot[1] == '\0') return 0;
    for (character = (const unsigned char *)email; *character != '\0'; character++) {
        if (isspace(*character) || *character == '|') return 0;
    }
    return 1;
}

static int parseStudent(const char *line, Student *student)
{
    int fields;
    memset(student, 0, sizeof(*student));
    fields = sscanf(line, "%d|%99[^|]|%99[^|]|%127[^|]|%99[^|]|%f|%29[^|]|%59[^|]|%19[^|]|%9[^|\r\n]|%f",
                  &student->id, student->name, student->email,
                  student->password, student->course,
                  &student->annual_income, student->category, student->state,
                  student->gender, student->disability, &student->cgpa);
    if (fields == 6) {
        strcpy(student->category, "Any");
        strcpy(student->state, "Any");
        strcpy(student->gender, "Any");
        strcpy(student->disability, "No");
        return 1;
    }
    if (fields == 10) student->cgpa = 0.0f;
    return fields == 10 || fields == 11;
}

static int readProfileValue(const char *prompt, char *value, size_t size)
{
    InputResult result = readLine(prompt, value, size);
    return result == INPUT_OK && value[0] != '\0' && !containsDelimiter(value);
}

static int nextStudentId(void)
{
    FILE *file = fopen(STUDENT_DATA_FILE, "r");
    char line[RECORD_SIZE];
    Student student;
    int largestId = 0;

    if (file == NULL) {
        return 1;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseStudent(line, &student) && student.id > largestId) {
            largestId = student.id;
        }
    }
    fclose(file);
    return largestId + 1;
}

static int emailExists(const char *email)
{
    FILE *file = fopen(STUDENT_DATA_FILE, "r");
    char line[RECORD_SIZE];
    Student student;

    if (file == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseStudent(line, &student) && strcmp(student.email, email) == 0) {
            fclose(file);
            return 1;
        }
    }
    fclose(file);
    return 0;
}

static int saveUpdatedStudent(const Student *updatedStudent);

static void registerStudent(void)
{
    Student student = {0};
    char plainPassword[100];
    char incomeText[INPUT_SIZE];
    char *end;
    FILE *file;
    InputResult result;

    puts("\n-------------------- STUDENT REGISTRATION --------------------");
    result = readLine("Name: ", student.name, sizeof(student.name));
    if (result != INPUT_OK || student.name[0] == '\0' || containsDelimiter(student.name)) {
        puts("Please enter a name of up to 99 characters without '|'.");
        return;
    }
    result = readLine("Email: ", student.email, sizeof(student.email));
    if (result != INPUT_OK || student.email[0] == '\0' || !validEmail(student.email) || containsDelimiter(student.email)) {
        puts("Please enter an email of up to 99 characters without '|'.");
        return;
    }
    if (emailExists(student.email)) {
        puts("That email is already registered.");
        return;
    }
    result = readLine("Password: ", plainPassword, sizeof(plainPassword));
    if (result != INPUT_OK || plainPassword[0] == '\0') {
        puts("Please enter a password of up to 99 characters.");
        return;
    }
    if (!hashPassword(plainPassword, student.password, sizeof(student.password))) {
        puts("Could not securely store the password.");
        return;
    }
    result = readLine("Course: ", student.course, sizeof(student.course));
    if (result != INPUT_OK || student.course[0] == '\0' || containsDelimiter(student.course)) {
        puts("Please enter a course of up to 99 characters without '|'.");
        return;
    }
    result = readLine("Annual family income: ", incomeText, sizeof(incomeText));
    if (result != INPUT_OK || incomeText[0] == '\0') {
        puts("Please enter a valid non-negative income.");
        return;
    }
    student.annual_income = strtof(incomeText, &end);
    if (end == incomeText || *end != '\0' || student.annual_income < 0.0f || !isfinite(student.annual_income)) {
        puts("Please enter a valid non-negative income.");
        return;
    }
    result = readLine("CGPA (0.00 to 10.00): ", incomeText, sizeof(incomeText));
    if (result != INPUT_OK || incomeText[0] == '\0') {
        puts("Please enter a CGPA between 0 and 10.");
        return;
    }
    student.cgpa = strtof(incomeText, &end);
    if (end == incomeText || *end != '\0' || student.cgpa < 0.0f ||
        student.cgpa > 10.0f || !isfinite(student.cgpa)) {
        puts("Please enter a CGPA between 0 and 10.");
        return;
    }
    puts("Use Any when a detail does not apply or you prefer not to specify it.");
    if (!readProfileValue("Category (General/SC/ST/OBC/EBC/DNT/Minority/Any): ", student.category, sizeof(student.category)) ||
        !readProfileValue("State/UT: ", student.state, sizeof(student.state)) ||
        !readProfileValue("Gender (Female/Male/Other/Any): ", student.gender, sizeof(student.gender)) ||
        !readProfileValue("Benchmark disability? (Yes/No): ", student.disability, sizeof(student.disability)) ||
        (strcmp(student.disability, "Yes") != 0 && strcmp(student.disability, "No") != 0)) {
        puts("Please enter valid profile details; disability must be Yes or No.");
        return;
    }

    student.id = nextStudentId();
    file = fopen(STUDENT_DATA_FILE, "a");
    if (file == NULL) {
        puts("Could not open the student data file.");
        return;
    }
    if (fprintf(file, "%d|%s|%s|%s|%s|%.2f|%s|%s|%s|%s|%.2f\n", student.id, student.name,
                student.email, student.password, student.course,
                student.annual_income, student.category, student.state,
                student.gender, student.disability, student.cgpa) < 0) {
        puts("Could not save the student record.");
        fclose(file);
        return;
    }
    fclose(file);
    printf("[SUCCESS] Registration complete. Your student ID is %d.\n", student.id);
}

static int studentLogin(Student *loggedInStudent)
{
    char email[100];
    char password[100];
    char line[RECORD_SIZE];
    Student student;
    FILE *file;

    puts("\n-------------------- STUDENT LOGIN --------------------");
    if (readLine("Email: ", email, sizeof(email)) != INPUT_OK ||
        readLine("Password: ", password, sizeof(password)) != INPUT_OK) {
        puts("Please try again with shorter input.");
        return 0;
    }
    file = fopen(STUDENT_DATA_FILE, "r");
    if (file == NULL) {
        puts("No student accounts are registered yet.");
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (!parseStudent(line, &student) || strcmp(student.email, email) != 0 ||
            !verifyPassword(password, student.password)) {
            continue;
        }

        if (!passwordIsHashed(student.password)) {
            if (!hashPassword(password, student.password, sizeof(student.password))) {
                fclose(file);
                puts("Could not upgrade the saved password securely.");
                return 0;
            }
            fclose(file);
            if (!saveUpdatedStudent(&student)) {
                puts("Warning: login succeeded, but the old password record could not be upgraded.");
            }
        } else {
            fclose(file);
        }
        *loggedInStudent = student;
                printf("[SUCCESS] Login successful!\nWelcome, %s.\n", student.name);
        return 1;
    }
    fclose(file);
    puts("[ERROR] Email or password is incorrect.");
    return 0;
}

static void showProfile(const Student *student)
{
    puts("\n-------------------- MY PROFILE --------------------");
    printf("Student ID: %d\n", student->id);
    printf("Name: %s\n", student->name);
    printf("Email: %s\n", student->email);
    printf("Course: %s\n", student->course);
    printf("Annual family income: %.2f\n", student->annual_income);
    printf("CGPA: %.2f / 10.00\n", student->cgpa);
    printf("Category: %s\nState/UT: %s\nGender: %s\nBenchmark disability: %s\n",
           student->category, student->state, student->gender, student->disability);
}

static int saveUpdatedStudent(const Student *updatedStudent)
{
    FILE *source = fopen(STUDENT_DATA_FILE, "r");
    FILE *temporary;
    char line[RECORD_SIZE];
    Student current;
    int found = 0;
    int writeOk = 1;

    if (source == NULL) {
        return 0;
    }
    temporary = fopen(STUDENT_TEMP_FILE, "w");
    if (temporary == NULL) {
        fclose(source);
        return 0;
    }

    while (fgets(line, sizeof(line), source) != NULL) {
        if (parseStudent(line, &current) && current.id == updatedStudent->id) {
            if (fprintf(temporary, "%d|%s|%s|%s|%s|%.2f|%s|%s|%s|%s|%.2f\n",
                        updatedStudent->id, updatedStudent->name,
                        updatedStudent->email, updatedStudent->password,
                        updatedStudent->course,
                        updatedStudent->annual_income, updatedStudent->category,
                        updatedStudent->state, updatedStudent->gender,
                        updatedStudent->disability, updatedStudent->cgpa) < 0) {
                writeOk = 0;
                break;
            }
            found = 1;
        } else if (fputs(line, temporary) == EOF) {
            writeOk = 0;
            break;
        }
    }

    if (ferror(source) || fclose(source) != 0) {
        writeOk = 0;
    }
    if (fclose(temporary) != 0) {
        writeOk = 0;
    }
    if (!writeOk || !found) {
        remove(STUDENT_TEMP_FILE);
        return 0;
    }

    /* Keep the replacement file beside the data file for a simple rename. */
    if (remove(STUDENT_DATA_FILE) != 0 || rename(STUDENT_TEMP_FILE, STUDENT_DATA_FILE) != 0) {
        puts("Could not replace the student data file.");
        return 0;
    }
    return 1;
}

static void editProfile(Student *student)
{
    Student updated = *student;
    char input[INPUT_SIZE];
    char *end;
    InputResult result;

    puts("\n-------------------- EDIT PROFILE --------------------");
    puts("Press Enter to keep a current value.");
    result = readLine("Name: ", input, sizeof(input));
    if (result != INPUT_OK) {
        puts("Name was too long; no changes were saved.");
        return;
    }
    if (input[0] != '\0') {
        if (containsDelimiter(input) || strlen(input) >= sizeof(updated.name)) {
            puts("Invalid name; no changes were saved.");
            return;
        }
        strcpy(updated.name, input);
    }

    result = readLine("Category (press Enter to keep): ", input, sizeof(input));
    if (result != INPUT_OK || (input[0] && (containsDelimiter(input) || strlen(input) >= sizeof(updated.category)))) { puts("Invalid category; no changes saved."); return; }
    if (input[0]) strcpy(updated.category, input);
    result = readLine("State/UT (press Enter to keep): ", input, sizeof(input));
    if (result != INPUT_OK || (input[0] && (containsDelimiter(input) || strlen(input) >= sizeof(updated.state)))) { puts("Invalid state; no changes saved."); return; }
    if (input[0]) strcpy(updated.state, input);
    result = readLine("Gender (press Enter to keep): ", input, sizeof(input));
    if (result != INPUT_OK || (input[0] && (containsDelimiter(input) || strlen(input) >= sizeof(updated.gender)))) { puts("Invalid gender; no changes saved."); return; }
    if (input[0]) strcpy(updated.gender, input);
    result = readLine("Benchmark disability Yes/No (press Enter to keep): ", input, sizeof(input));
    if (result != INPUT_OK || (input[0] && strcmp(input, "Yes") != 0 && strcmp(input, "No") != 0)) { puts("Enter Yes or No; no changes saved."); return; }
    if (input[0]) strcpy(updated.disability, input);

    result = readLine("Course: ", input, sizeof(input));
    if (result != INPUT_OK) {
        puts("Course was too long; no changes were saved.");
        return;
    }
    if (input[0] != '\0') {
        if (containsDelimiter(input) || strlen(input) >= sizeof(updated.course)) {
            puts("Invalid course; no changes were saved.");
            return;
        }
        strcpy(updated.course, input);
    }

    result = readLine("CGPA (0.00 to 10.00; press Enter to keep): ", input, sizeof(input));
    if (result != INPUT_OK) {
        puts("CGPA input was too long; no changes were saved.");
        return;
    }
    if (input[0] != '\0') {
        updated.cgpa = strtof(input, &end);
        if (end == input || *end != '\0' || updated.cgpa < 0.0f ||
            updated.cgpa > 10.0f || !isfinite(updated.cgpa)) {
            puts("Enter a CGPA between 0 and 10; no changes were saved.");
            return;
        }
    }

    result = readLine("Annual family income: ", input, sizeof(input));
    if (result != INPUT_OK) {
        puts("Income input was too long; no changes were saved.");
        return;
    }
    if (input[0] != '\0') {
        updated.annual_income = strtof(input, &end);
        if (end == input || *end != '\0' || updated.annual_income < 0.0f || !isfinite(updated.annual_income)) {
            puts("Invalid income; no changes were saved.");
            return;
        }
    }

    if (saveUpdatedStudent(&updated)) {
        *student = updated;
        puts("Profile updated successfully.");
    } else {
        puts("Could not save the profile changes.");
    }
}

static void changePassword(Student *student)
{
    Student updated = *student;
    char currentPassword[100];
    char newPassword[100];
    char confirmation[100];

    puts("\n-------------------- CHANGE PASSWORD --------------------");
    if (readLine("Current password: ", currentPassword, sizeof(currentPassword)) != INPUT_OK ||
        !verifyPassword(currentPassword, student->password)) {
        puts("Current password is incorrect.");
        return;
    }
    if (readLine("New password: ", newPassword, sizeof(newPassword)) != INPUT_OK ||
        newPassword[0] == '\0') {
        puts("Enter a password of up to 99 characters.");
        return;
    }
    if (readLine("Confirm new password: ", confirmation, sizeof(confirmation)) != INPUT_OK ||
        strcmp(newPassword, confirmation) != 0) {
        puts("The new passwords did not match.");
        return;
    }

    if (!hashPassword(newPassword, updated.password, sizeof(updated.password))) {
        puts("Could not securely store the new password.");
        return;
    }
    if (saveUpdatedStudent(&updated)) {
        *student = updated;
        puts("Password changed successfully.");
    } else {
        puts("Could not save the new password.");
    }
}
static int readMenuChoice(int maximum)
{
    char input[INPUT_SIZE];
    char *end;
    long choice;

    InputResult result = readLine("Enter your choice: ", input, sizeof(input));
    if (result == INPUT_END) return -2;
    if (result != INPUT_OK) return -1;
    choice = strtol(input, &end, 10);
    while (*end == ' ' || *end == '\t') {
        end++;
    }
    if (end == input || *end != '\0' || choice < 1 || choice > maximum) {
        return -1;
    }
    return (int)choice;
}

static void studentDashboard(Student *student)
{
    int choice;

    for (;;) {
        puts("\n============================================================");
        puts("                    STUDENT DASHBOARD");
        puts("============================================================");
        puts("  1. My Profile");
        puts("  2. Edit Profile");
        puts("  3. Change Password");
        puts("  4. Scholarship Finder");
        puts("  5. Search Scholarships");
        puts("  6. Eligibility Matcher");
        puts("  7. Recommendations");
        puts("  8. Filter Scholarships");
        puts("  9. Save Scholarship");
        puts(" 10. View Saved Scholarships");
        puts(" 11. Remove Saved Scholarship");
        puts(" 12. Apply for Scholarship");
        puts(" 13. Application Tracker");
        puts(" 14. Deadline Tracker");
        puts(" 15. Deadline Alerts");
        puts(" 16. Logout");
        puts("------------------------------------------------------------");
        choice = readMenuChoice(16);
        if (choice == -2) { puts("Input ended; returning to the previous menu."); return; }
        switch (choice) {
        case 1: showProfile(student); break;
        case 2: editProfile(student); break;
        case 3: changePassword(student); break;
        case 4: browseScholarships(); break;
        case 5: searchScholarships(); break;
        case 6: findEligibleScholarships(student); break;
        case 7: recommendScholarships(student); break;
        case 8: filterScholarships(student); break;
        case 9: saveScholarshipForStudent(student); break;
        case 10: viewSavedScholarshipsForStudent(student); break;
        case 11: removeSavedScholarshipForStudent(student); break;
        case 12: applyForScholarship(student); break;
        case 13: trackStudentApplications(student); break;
        case 14: showDeadlineTracker(); break;
        case 15: showDeadlineAlerts(); break;
        case 16:
            puts("Logged out.");
            return;
        default:
            puts("[ERROR] Invalid choice. Please enter a number from 1 to 16.");
        }
    }
}

void studentPortal(void)
{
    int choice;
    Student loggedInStudent;

    for (;;) {
        puts("\n========================================");
        puts("             STUDENT PORTAL");
        puts("========================================");
        puts("1. Register");
        puts("2. Login");
        puts("3. Back");
        choice = readMenuChoice(3);
        if (choice == -2) { puts("Input ended; returning to the previous menu."); return; }
        switch (choice) {
        case 1:
            registerStudent();
            break;
        case 2:
            if (studentLogin(&loggedInStudent)) {
                showDeadlineAlerts();
                studentDashboard(&loggedInStudent);
            }
            break;
        case 3:
            return;
        default:
            puts("Invalid choice. Please select 1, 2, or 3.");
        }
    }
}















