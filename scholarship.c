#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "scholarship.h"
#include "eligibility.h"

#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define LINE_SIZE 1200

int parseScholarshipRecord(const char *line, Scholarship *scholarship)
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

static void showScholarship(const Scholarship *scholarship)
{
    printf("\n[%d] %s\n", scholarship->id, scholarship->name);
    printf("Provider: %s\n", scholarship->provider);
    printf("Description: %s\n", scholarship->description);
    printf("Award amount: %.2f\n", scholarship->amount);
    if (scholarship->minimum_income < 0.0f) puts("Maximum family income: Not specified");
    else if (scholarship->minimum_income == 0.0f) puts("Maximum family income: No limit listed");
    else printf("Maximum family income: %.2f\n", scholarship->minimum_income);
    printf("Deadline: %s\n", scholarship->deadline);
    printf("Eligible course: %s\n", scholarship->eligible_course);
    printf("Student profile rules: category %s; state %s; gender %s; disability %s\n",
           scholarship->eligible_category, scholarship->eligible_state,
           scholarship->eligible_gender, scholarship->disability_required);
    printf("Scholarship category: %s\n", scholarship->category);
    if (scholarship->minimum_cgpa > 0.0f)
        printf("Minimum CGPA: %.2f / 10.00\n", scholarship->minimum_cgpa);
    else puts("Minimum CGPA: No minimum listed");
}

void browseScholarships(void)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    Scholarship scholarship;
    int found = 0;

    puts("\n-------------------- SCHOLARSHIP FINDER --------------------");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }

    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseScholarshipRecord(line, &scholarship)) {
            showScholarship(&scholarship);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("No scholarships are listed yet.");
    }
}

static int containsIgnoreCase(const char *text, const char *query)
{
    size_t textIndex;
    size_t queryIndex;

    if (query[0] == '\0') {
        return 1;
    }
    for (textIndex = 0; text[textIndex] != '\0'; textIndex++) {
        for (queryIndex = 0; query[queryIndex] != '\0'; queryIndex++) {
            if (text[textIndex + queryIndex] == '\0' ||
                tolower((unsigned char)text[textIndex + queryIndex]) !=
                tolower((unsigned char)query[queryIndex])) {
                break;
            }
        }
        if (query[queryIndex] == '\0') {
            return 1;
        }
    }
    return 0;
}

void searchScholarships(void)
{
    FILE *file;
    char query[150];
    char line[LINE_SIZE];
    Scholarship scholarship;
    int found = 0;

    puts("\n-------------------- SEARCH SCHOLARSHIPS --------------------");
    printf("Search by scholarship name or provider: ");
    if (fgets(query, sizeof(query), stdin) == NULL) {
        puts("Search cancelled.");
        return;
    }
    query[strcspn(query, "\r\n")] = '\0';
    if (query[0] == '\0') {
        puts("Enter a word to search for.");
        return;
    }

    file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseScholarshipRecord(line, &scholarship) &&
            (containsIgnoreCase(scholarship.name, query) ||
             containsIgnoreCase(scholarship.provider, query))) {
            showScholarship(&scholarship);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("No scholarships matched that search.");
    }
}

#define SAVED_DATA_FILE "data/saved.txt"
#define SAVED_TEMP_FILE "data/saved.tmp"

static int readPositiveId(const char *prompt, int *id)
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

static int showScholarshipById(int scholarshipId)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    Scholarship scholarship;

    if (file == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (parseScholarshipRecord(line, &scholarship) && scholarship.id == scholarshipId) {
            showScholarship(&scholarship);
            fclose(file);
            return 1;
        }
    }
    fclose(file);
    return 0;
}

static int savedRecordExists(int studentId, int scholarshipId)
{
    FILE *file = fopen(SAVED_DATA_FILE, "r");
    int savedStudentId;
    int savedScholarshipId;

    if (file == NULL) {
        return 0;
    }
    while (fscanf(file, "%d|%d", &savedStudentId, &savedScholarshipId) == 2) {
        if (savedStudentId == studentId && savedScholarshipId == scholarshipId) {
            fclose(file);
            return 1;
        }
    }
    fclose(file);
    return 0;
}

void saveScholarshipForStudent(const Student *student)
{
    int scholarshipId;
    FILE *file;

    puts("\n-------------------- SAVE SCHOLARSHIP --------------------");
    if (!readPositiveId("Enter scholarship ID: ", &scholarshipId)) {
        puts("Please enter a valid positive scholarship ID.");
        return;
    }
    if (!showScholarshipById(scholarshipId)) {
        puts("That scholarship ID was not found.");
        return;
    }
    if (savedRecordExists(student->id, scholarshipId)) {
        puts("You have already saved this scholarship.");
        return;
    }

    file = fopen(SAVED_DATA_FILE, "a");
    if (file == NULL) {
        puts("Could not open the saved scholarships file.");
        return;
    }
    if (fprintf(file, "%d|%d\n", student->id, scholarshipId) < 0) {
        puts("Could not save this scholarship.");
        fclose(file);
        return;
    }
    fclose(file);
    puts("[SUCCESS] Scholarship saved successfully.");
}

void viewSavedScholarshipsForStudent(const Student *student)
{
    FILE *file = fopen(SAVED_DATA_FILE, "r");
    int savedStudentId;
    int scholarshipId;
    int found = 0;

    puts("\n-------------------- SAVED SCHOLARSHIPS --------------------");
    if (file == NULL) {
        puts("You have no saved scholarships.");
        return;
    }
    while (fscanf(file, "%d|%d", &savedStudentId, &scholarshipId) == 2) {
        if (savedStudentId == student->id && showScholarshipById(scholarshipId)) {
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("You have no saved scholarships.");
    }
}

void removeSavedScholarshipForStudent(const Student *student)
{
    FILE *source;
    FILE *temporary;
    int savedStudentId;
    int scholarshipId;
    int targetId;
    int found = 0;
    int writeOk = 1;

    puts("\n-------------------- REMOVE SAVED SCHOLARSHIP --------------------");
    if (!readPositiveId("Enter scholarship ID to remove: ", &targetId)) {
        puts("Please enter a valid positive scholarship ID.");
        return;
    }
    source = fopen(SAVED_DATA_FILE, "r");
    if (source == NULL) {
        puts("You have no saved scholarships.");
        return;
    }
    temporary = fopen(SAVED_TEMP_FILE, "w");
    if (temporary == NULL) {
        fclose(source);
        puts("Could not update the saved scholarships file.");
        return;
    }

    while (fscanf(source, "%d|%d", &savedStudentId, &scholarshipId) == 2) {
        if (savedStudentId == student->id && scholarshipId == targetId) {
            found = 1;
        } else if (fprintf(temporary, "%d|%d\n", savedStudentId, scholarshipId) < 0) {
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
    if (!writeOk) {
        remove(SAVED_TEMP_FILE);
        puts("Could not update the saved scholarships file.");
        return;
    }
    if (!found) {
        remove(SAVED_TEMP_FILE);
        puts("That scholarship is not in your saved list.");
        return;
    }
    if (remove(SAVED_DATA_FILE) != 0 || rename(SAVED_TEMP_FILE, SAVED_DATA_FILE) != 0) {
        puts("Could not replace the saved scholarships file.");
        return;
    }
    puts("[SUCCESS] Saved scholarship removed.");
}


#define RECOMMENDATION_COUNT 5

void recommendScholarships(const Student *student)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    Scholarship top[RECOMMENDATION_COUNT];
    Scholarship scholarship;
    char line[LINE_SIZE];
    int topCount = 0;
    int eligibleCount = 0;
    int position;
    int index;

    puts("\n-------------------- SCHOLARSHIP RECOMMENDATIONS --------------------");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }

    while (fgets(line, sizeof(line), file) != NULL) {
        if (!parseScholarshipRecord(line, &scholarship)) {
            continue;
        }
        if (!scholarshipMatchesStudent(&scholarship, student)) {
            continue;
        }
        eligibleCount++;
        if (topCount == RECOMMENDATION_COUNT &&
            scholarship.amount <= top[topCount - 1].amount) {
            continue;
        }

        position = topCount < RECOMMENDATION_COUNT ? topCount : RECOMMENDATION_COUNT - 1;
        while (position > 0 && top[position - 1].amount < scholarship.amount) {
            if (position < RECOMMENDATION_COUNT) {
                top[position] = top[position - 1];
            }
            position--;
        }
        top[position] = scholarship;
        if (topCount < RECOMMENDATION_COUNT) {
            topCount++;
        }
    }
    fclose(file);

    if (eligibleCount == 0) {
        puts("No scholarships matched the profile criteria in the catalog.");
        return;
    }
    printf("Top %d of %d profile-matched scholarships, ranked by award amount:\n",
           topCount, eligibleCount);
    for (index = 0; index < topCount; index++) {
        showScholarship(&top[index]);
    }
    puts("The matcher checks listed profile rules only; confirm every scheme requirement with the provider.");
}

void filterScholarships(const Student *student)
{
    FILE *file;
    char input[100];
    char *end;
    float minimumAward;
    char line[LINE_SIZE];
    Scholarship scholarship;
    int found = 0;

    puts("\n-------------------- FILTER SCHOLARSHIPS --------------------");
    printf("Minimum award amount (0 for any amount): ");
    if (fgets(input, sizeof(input), stdin) == NULL) {
        puts("Filter cancelled.");
        return;
    }
    input[strcspn(input, "\r\n")] = '\0';
    minimumAward = strtof(input, &end);
    while (*end == ' ' || *end == '\t') {
        end++;
    }
    if (end == input || *end != '\0' || minimumAward < 0.0f || !isfinite(minimumAward)) {
        puts("Enter a valid non-negative amount.");
        return;
    }

    file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (!parseScholarshipRecord(line, &scholarship)) {
            continue;
        }
        if (scholarshipMatchesStudent(&scholarship, student) &&
            scholarship.amount >= minimumAward) {
            showScholarship(&scholarship);
            found = 1;
        }
    }
    fclose(file);
    if (!found) {
        puts("No scholarships match your course, income, and minimum award filter.");
    }
}



