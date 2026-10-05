#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include "eligibility.h"

#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define LINE_SIZE 1200

static int readScholarship(const char *line, Scholarship *scholarship)
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

    if (fields == 12) return 1;
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

static int sameCourse(const char *left, const char *right)
{
    while (*left && *right && tolower((unsigned char)*left) == tolower((unsigned char)*right)) {
        left++; right++;
    }
    return *left == '\0' && *right == '\0';
}

static int matchesRule(const char *rule, const char *value)
{
    return rule[0] == '\0' || sameCourse(rule, "Any") || sameCourse(rule, value);
}

static int matchesCategory(const char *rule, const char *value)
{
    const char *start = rule;
    const char *end;
    char option[40];
    size_t length;

    if (rule[0] == '\0' || sameCourse(rule, "Any")) return 1;
    while (*start) {
        end = strchr(start, ',');
        length = end ? (size_t)(end - start) : strlen(start);
        if (length < sizeof(option)) {
            memcpy(option, start, length);
            option[length] = '\0';
            if (sameCourse(option, value)) return 1;
        }
        if (!end) break;
        start = end + 1;
    }
    return 0;
}

static int isNorthEasternState(const char *state)
{
    static const char *states[] = {
        "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
        "Mizoram", "Nagaland", "Sikkim", "Tripura"
    };
    size_t index;
    for (index = 0; index < sizeof(states) / sizeof(states[0]); index++) {
        if (sameCourse(state, states[index])) return 1;
    }
    return 0;
}

static int matchesState(const char *rule, const char *value)
{
    if (sameCourse(rule, "North East")) return isNorthEasternState(value);
    return matchesRule(rule, value);
}

int scholarshipMatchesStudent(const Scholarship *scholarship, const Student *student)
{
    int incomeMatches = scholarship->minimum_income <= 0.0f ||
                        student->annual_income <= scholarship->minimum_income;
    int courseMatches = scholarship->eligible_course[0] == '\0' ||
                        sameCourse(scholarship->eligible_course, "Any") ||
                        sameCourse(scholarship->eligible_course, student->course);
    int categoryMatches = matchesCategory(scholarship->eligible_category, student->category);
    int stateMatches = matchesState(scholarship->eligible_state, student->state);
    int genderMatches = matchesRule(scholarship->eligible_gender, student->gender);
    int disabilityMatches = matchesRule(scholarship->disability_required, student->disability);
    int cgpaMatches = scholarship->minimum_cgpa <= 0.0f ||
                      student->cgpa >= scholarship->minimum_cgpa;
    return incomeMatches && courseMatches && categoryMatches && stateMatches &&
           genderMatches && disabilityMatches && cgpaMatches;
}

void findEligibleScholarships(const Student *student)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    Scholarship scholarship;
    int listed = 0;
    int eligible = 0;

    puts("\n-------------------- ELIGIBILITY MATCHER --------------------");
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }

    while (fgets(line, sizeof(line), file) != NULL) {
        if (!readScholarship(line, &scholarship)) {
            continue;
        }
        listed = 1;
        if (scholarshipMatchesStudent(&scholarship, student)) {
            printf("\nPotential match: %s (ID %d)\n", scholarship.name, scholarship.id);
            printf("Provider: %s\n", scholarship.provider);
            printf("Award amount: %.2f\n", scholarship.amount);
            if (scholarship.minimum_income < 0.0f) puts("Maximum family income: Not specified");
            else if (scholarship.minimum_income == 0.0f) puts("Maximum family income: No limit listed");
            else printf("Maximum family income: %.2f\n", scholarship.minimum_income);
            printf("Deadline: %s\n", scholarship.deadline);
            printf("Eligible course: %s\n", scholarship.eligible_course);
            printf("Student profile rules: category %s; state %s; gender %s; disability %s\n",
                   scholarship.eligible_category, scholarship.eligible_state,
                   scholarship.eligible_gender, scholarship.disability_required);
            printf("Scholarship category: %s\n", scholarship.category);
            if (scholarship.minimum_cgpa > 0.0f)
                printf("Minimum CGPA: %.2f / 10.00\n", scholarship.minimum_cgpa);
            else puts("Minimum CGPA: No minimum listed");
            eligible++;
        }
    }
    fclose(file);

    if (!listed) {
        puts("No scholarships are listed yet.");
    } else if (eligible == 0) {
        puts("No scholarships matched the profile criteria listed in the catalog.");
    } else {
        printf("\nFound %d potential profile match(es).\n", eligible);
        puts("Matches course, income, category, state, gender, disability, and CGPA rules when listed.");
        puts("These are potential matches only. Confirm eligibility and deadlines with the provider.");
    }
}

