#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "application.h"

#define APPLICATION_DATA_FILE "data/applications.txt"
#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define LINE_SIZE 1200

static int readId(const char *prompt, int *id)
{
    char input[100];
    char *end;
    long value;

    printf("%s", prompt);
    if (fgets(input, sizeof(input), stdin) == NULL) {
        return 0;
    }
    input[strcspn(input, "\r\n")] = '\0';
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

static int scholarshipExists(int scholarshipId)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    int id;

    if (file == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (sscanf(line, "%d|", &id) == 1 && id == scholarshipId) {
            fclose(file);
            return 1;
        }
    }
    fclose(file);
    return 0;
}

static int applicationExists(int studentId, int scholarshipId)
{
    FILE *file = fopen(APPLICATION_DATA_FILE, "r");
    int id;
    int savedStudentId;
    int savedScholarshipId;
    char status[30];
    char appliedOn[20];

    if (file == NULL) {
        return 0;
    }
    while (fscanf(file, "%d|%d|%d|%29[^|]|%19[^\r\n]", &id,
                  &savedStudentId, &savedScholarshipId, status, appliedOn) == 5) {
        if (savedStudentId == studentId && savedScholarshipId == scholarshipId) {
            fclose(file);
            return 1;
        }
    }
    fclose(file);
    return 0;
}

static int nextApplicationId(void)
{
    FILE *file = fopen(APPLICATION_DATA_FILE, "r");
    int id;
    int studentId;
    int scholarshipId;
    char status[30];
    char appliedOn[20];
    int largestId = 0;

    if (file == NULL) {
        return 1;
    }
    while (fscanf(file, "%d|%d|%d|%29[^|]|%19[^\r\n]", &id,
                  &studentId, &scholarshipId, status, appliedOn) == 5) {
        if (id > largestId) {
            largestId = id;
        }
    }
    fclose(file);
    return largestId + 1;
}

static void currentDate(char *date, size_t size)
{
    time_t now = time(NULL);
    struct tm *local = localtime(&now);

    if (local == NULL || strftime(date, size, "%Y-%m-%d", local) == 0) {
        strncpy(date, "unknown", size);
        date[size - 1] = '\0';
    }
}

void applyForScholarship(const Student *student)
{
    int scholarshipId;
    FILE *file;
    Application application = {0};

    puts("\n-------------------- APPLY FOR SCHOLARSHIP --------------------");
    if (!readId("Enter scholarship ID: ", &scholarshipId)) {
        puts("Please enter a valid positive scholarship ID.");
        return;
    }
    if (!scholarshipExists(scholarshipId)) {
        puts("That scholarship ID was not found.");
        return;
    }
    if (applicationExists(student->id, scholarshipId)) {
        puts("You already have an application for this scholarship.");
        return;
    }

    application.id = nextApplicationId();
    application.student_id = student->id;
    application.scholarship_id = scholarshipId;
    strcpy(application.status, "Pending");
    currentDate(application.applied_on, sizeof(application.applied_on));

    file = fopen(APPLICATION_DATA_FILE, "a");
    if (file == NULL) {
        puts("Could not open the applications file.");
        return;
    }
    if (fprintf(file, "%d|%d|%d|%s|%s\n", application.id,
                application.student_id, application.scholarship_id,
                application.status, application.applied_on) < 0) {
        puts("Could not save the application.");
        fclose(file);
        return;
    }
    fclose(file);
    printf("[SUCCESS] Application submitted. ID: %d | Status: %s.\n",
           application.id, application.status);
}

static void showScholarshipName(int scholarshipId)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    int id;
    char name[150];

    if (file == NULL) {
        printf("Scholarship ID %d", scholarshipId);
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (sscanf(line, "%d|%149[^|]", &id, name) == 2 && id == scholarshipId) {
            printf("%s", name);
            fclose(file);
            return;
        }
    }
    fclose(file);
    printf("Scholarship ID %d", scholarshipId);
}

void trackStudentApplications(const Student *student)
{
    FILE *file = fopen(APPLICATION_DATA_FILE, "r");
    int id;
    int studentId;
    int scholarshipId;
    char status[30];
    char appliedOn[20];
    int found = 0;

    puts("\n-------------------- APPLICATION TRACKER --------------------");
    if (file == NULL) {
        puts("You have no applications yet.");
        return;
    }
    while (fscanf(file, "%d|%d|%d|%29[^|]|%19[^\r\n]", &id,
                  &studentId, &scholarshipId, status, appliedOn) == 5) {
        if (studentId == student->id) {
            printf("\nApplication ID: %d\nScholarship: ", id);
            showScholarshipName(scholarshipId);
            printf("\nStatus: %s\nApplied on: %s\n", status, appliedOn);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("You have no applications yet.");
    }
}

#define APPLICATION_TEMP_FILE "data/applications.tmp"

static int readApplicationRecord(const char *line, Application *application)
{
    return sscanf(line, "%d|%d|%d|%29[^|]|%19[^\r\n]",
                  &application->id, &application->student_id,
                  &application->scholarship_id, application->status,
                  application->applied_on) == 5;
}

static void listAllApplications(void)
{
    FILE *file = fopen(APPLICATION_DATA_FILE, "r");
    char line[LINE_SIZE];
    Application application;
    int found = 0;

    puts("\n-------------------- APPLICATION REVIEW --------------------");
    if (file == NULL) {
        puts("No applications have been submitted.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (readApplicationRecord(line, &application)) {
            printf("\nApplication ID: %d\nStudent ID: %d\nScholarship: ",
                   application.id, application.student_id);
            showScholarshipName(application.scholarship_id);
            printf("\nStatus: %s\nApplied on: %s\n", application.status,
                   application.applied_on);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("No applications have been submitted.");
    }
}

static int readChoice(const char *prompt, int maximum)
{
    char input[100];
    char *end;
    long choice;

    printf("%s", prompt);
    if (fgets(input, sizeof(input), stdin) == NULL) {
        return -1;
    }
    input[strcspn(input, "\r\n")] = '\0';
    choice = strtol(input, &end, 10);
    while (*end == ' ' || *end == '\t') {
        end++;
    }
    if (end == input || *end != '\0' || choice < 1 || choice > maximum) {
        return -1;
    }
    return (int)choice;
}

static int updateApplicationStatus(int targetId, const char *newStatus)
{
    FILE *source = fopen(APPLICATION_DATA_FILE, "r");
    FILE *temporary;
    char line[LINE_SIZE];
    Application application;
    int found = 0;
    int writeOk = 1;

    if (source == NULL) {
        return 0;
    }
    temporary = fopen(APPLICATION_TEMP_FILE, "w");
    if (temporary == NULL) {
        fclose(source);
        return 0;
    }
    while (fgets(line, sizeof(line), source) != NULL) {
        if (readApplicationRecord(line, &application) && application.id == targetId) {
            if (fprintf(temporary, "%d|%d|%d|%s|%s\n", application.id,
                        application.student_id, application.scholarship_id,
                        newStatus, application.applied_on) < 0) {
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
        remove(APPLICATION_TEMP_FILE);
        return 0;
    }
    if (remove(APPLICATION_DATA_FILE) != 0 || rename(APPLICATION_TEMP_FILE, APPLICATION_DATA_FILE) != 0) {
        puts("Could not replace the applications file.");
        return 0;
    }
    return 1;
}

void reviewApplications(void)
{
    int applicationId;
    int choice;
    const char *newStatus;

    listAllApplications();
    puts("\nUpdate an application status:");
    if (!readId("Application ID to update: ", &applicationId)) {
        puts("Please enter a valid application ID.");
        return;
    }
    if (applicationId == 0) {
        return;
    }
    puts("1. Pending");
    puts("2. Approved");
    puts("3. Rejected");
    choice = readChoice("Choose new status: ", 3);
    switch (choice) {
    case 1:
        newStatus = "Pending";
        break;
    case 2:
        newStatus = "Approved";
        break;
    case 3:
        newStatus = "Rejected";
        break;
    default:
        puts("Invalid status choice.");
        return;
    }
    if (updateApplicationStatus(applicationId, newStatus)) {
        printf("Application %d status updated to %s.\n", applicationId, newStatus);
    } else {
        puts("Could not find that application or save the status change.");
    }
}


void exportApplicationReport(void)
{
    FILE *source = fopen(APPLICATION_DATA_FILE, "r");
    FILE *report;
    char line[LINE_SIZE];
    Application application;
    int rows = 0;
    int pending = 0;
    int approved = 0;
    int rejected = 0;

    puts("\n-------------------- EXPORT APPLICATION REPORT --------------------");
    if (source == NULL) {
        puts("Could not open the applications file.");
        return;
    }
    report = fopen("data/application_report.csv", "w");
    if (report == NULL) {
        fclose(source);
        puts("Could not create data/application_report.csv.");
        return;
    }
    if (fputs("ApplicationID,StudentID,ScholarshipID,Status,AppliedOn\n", report) == EOF) {
        fclose(source);
        fclose(report);
        puts("Could not write the report.");
        return;
    }
    while (fgets(line, sizeof(line), source) != NULL) {
        if (!readApplicationRecord(line, &application)) {
            continue;
        }
        if (fprintf(report, "%d,%d,%d,%s,%s\n", application.id,
                    application.student_id, application.scholarship_id,
                    application.status, application.applied_on) < 0) {
            fclose(source);
            fclose(report);
            puts("Could not write the report.");
            return;
        }
        rows++;
        if (strcmp(application.status, "Pending") == 0) pending++;
        else if (strcmp(application.status, "Approved") == 0) approved++;
        else if (strcmp(application.status, "Rejected") == 0) rejected++;
    }
    if (ferror(source)) {
        fclose(source);
        fclose(report);
        puts("Could not read the applications file completely.");
        return;
    }
    if (fclose(source) != 0 || fclose(report) != 0) {
        puts("The report may be incomplete because a file could not be closed cleanly.");
        return;
    }
    printf("Report saved to data/application_report.csv (%d application(s)).\n", rows);
    printf("Pending: %d | Approved: %d | Rejected: %d\n", pending, approved, rejected);
}
