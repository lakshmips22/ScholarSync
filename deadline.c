#include <stdio.h>
#include <string.h>
#include <time.h>
#include "shared.h"

#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define LINE_SIZE 1200
#define ALERT_WINDOW_DAYS 30

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

    if (fields == 7) {
        strcpy(scholarship->eligible_course, "Any");
    }
    if (fields == 7 || fields == 8) return 1;
    return fields == 12 || fields == 13 || fields == 14;
}

static int daysUntil(const char *dateText, int *days)
{
    int year;
    int month;
    int day;
    char extra;
    struct tm deadline = {0};
    struct tm today;
    time_t deadlineTime;
    time_t now = time(NULL);
    time_t todayTime;
    struct tm *localToday = localtime(&now);
    double difference;

    if (strlen(dateText) != 10 ||
        sscanf(dateText, "%4d-%2d-%2d%c", &year, &month, &day, &extra) != 3 ||
        dateText[4] != '-' || dateText[7] != '-') {
        return 0;
    }
    deadline.tm_year = year - 1900;
    deadline.tm_mon = month - 1;
    deadline.tm_mday = day;
    deadline.tm_hour = 12;
    deadline.tm_isdst = -1;
    deadlineTime = mktime(&deadline);
    if (deadlineTime == (time_t)-1 || deadline.tm_year != year - 1900 ||
        deadline.tm_mon != month - 1 || deadline.tm_mday != day || localToday == NULL) {
        return 0;
    }

    today = *localToday;
    today.tm_hour = 12;
    today.tm_min = 0;
    today.tm_sec = 0;
    today.tm_isdst = -1;
    todayTime = mktime(&today);
    if (todayTime == (time_t)-1) {
        return 0;
    }

    difference = difftime(deadlineTime, todayTime);
    *days = (int)((difference + (difference >= 0.0 ? 43200.0 : -43200.0)) / 86400.0);
    return 1;
}

static void showDeadlines(int alertWindowDays, const char *heading)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    char line[LINE_SIZE];
    Scholarship scholarship;
    int days;
    int foundCatalog = 0;
    int foundAlert = 0;

    puts(heading);
    if (file == NULL) {
        puts("Could not open the scholarship data file.");
        return;
    }
    while (fgets(line, sizeof(line), file) != NULL) {
        if (!readScholarship(line, &scholarship)) {
            continue;
        }
        foundCatalog = 1;
        if (!daysUntil(scholarship.deadline, &days)) {
            printf("Skipping scholarship %d: deadline is missing or not a valid YYYY-MM-DD date.\n",
                   scholarship.id);
            continue;
        }
        if (days > alertWindowDays) {
            continue;
        }

        if (days < 0) {
            printf("\nOVERDUE by %d day(s): %s (ID %d)\n",
                   -days, scholarship.name, scholarship.id);
        } else if (days == 0) {
            printf("\nDUE TODAY: %s (ID %d)\n", scholarship.name, scholarship.id);
        } else {
            printf("\nDue in %d day(s): %s (ID %d)\n",
                   days, scholarship.name, scholarship.id);
        }
        printf("Deadline: %s | Provider: %s\n", scholarship.deadline,
               scholarship.provider);
        foundAlert = 1;
    }
    fclose(file);

    if (!foundCatalog) {
        puts("No scholarships are listed yet.");
    } else if (!foundAlert) {
        printf("No overdue deadlines or deadlines within %d days.\n", alertWindowDays);
    }
}

void showDeadlineTracker(void)
{
    showDeadlines(ALERT_WINDOW_DAYS, "\n-------------------- DEADLINE TRACKER (30 DAYS) --------------------");
}

void showDeadlineAlerts(void)
{
    showDeadlines(7, "\n-------------------- DEADLINE ALERTS (7 DAYS) --------------------");
}

