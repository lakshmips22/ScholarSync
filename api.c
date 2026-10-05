#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "api.h"
#include "scholarship.h"

#define SCHOLARSHIP_DATA_FILE "data/scholarships.txt"
#define LINE_SIZE 2048

static int writeJsonString(const char *value)
{
    const unsigned char *cursor = (const unsigned char *)value;

    if (putchar('"') == EOF) {
        return 0;
    }
    while (*cursor != '\0') {
        unsigned char character = *cursor++;
        switch (character) {
        case '"':
            if (fputs("\\\"", stdout) == EOF) return 0;
            break;
        case '\\':
            if (fputs("\\\\", stdout) == EOF) return 0;
            break;
        case '\b':
            if (fputs("\\b", stdout) == EOF) return 0;
            break;
        case '\f':
            if (fputs("\\f", stdout) == EOF) return 0;
            break;
        case '\n':
            if (fputs("\\n", stdout) == EOF) return 0;
            break;
        case '\r':
            if (fputs("\\r", stdout) == EOF) return 0;
            break;
        case '\t':
            if (fputs("\\t", stdout) == EOF) return 0;
            break;
        default:
            if (character < 0x20) {
                if (fprintf(stdout, "\\u%04x", character) < 0) return 0;
            } else if (putchar(character) == EOF) {
                return 0;
            }
        }
    }
    return putchar('"') != EOF;
}

static int writeScholarshipJson(const Scholarship *scholarship)
{
    if (!isfinite(scholarship->amount) ||
        !isfinite(scholarship->minimum_income) ||
        !isfinite(scholarship->minimum_cgpa)) {
        return 0;
    }

    if (printf("  {\n    \"id\": %d,\n    \"name\": ", scholarship->id) < 0 ||
        !writeJsonString(scholarship->name) ||
        fputs(",\n    \"provider\": ", stdout) == EOF ||
        !writeJsonString(scholarship->provider) ||
        fputs(",\n    \"description\": ", stdout) == EOF ||
        !writeJsonString(scholarship->description) ||
        printf(",\n    \"amount\": %.9g,\n    \"minimum_income\": %.9g,\n    \"deadline\": ",
               (double)scholarship->amount,
               (double)scholarship->minimum_income) < 0 ||
        !writeJsonString(scholarship->deadline) ||
        fputs(",\n    \"eligible_course\": ", stdout) == EOF ||
        !writeJsonString(scholarship->eligible_course) ||
        fputs(",\n    \"eligible_category\": ", stdout) == EOF ||
        !writeJsonString(scholarship->eligible_category) ||
        fputs(",\n    \"eligible_state\": ", stdout) == EOF ||
        !writeJsonString(scholarship->eligible_state) ||
        fputs(",\n    \"eligible_gender\": ", stdout) == EOF ||
        !writeJsonString(scholarship->eligible_gender) ||
        fputs(",\n    \"disability_required\": ", stdout) == EOF ||
        !writeJsonString(scholarship->disability_required) ||
        fputs(",\n    \"category\": ", stdout) == EOF ||
        !writeJsonString(scholarship->category) ||
        printf(",\n    \"minimum_cgpa\": %.9g\n  }",
               (double)scholarship->minimum_cgpa) < 0) {
        return 0;
    }
    return 1;
}

int runScholarshipsApi(void)
{
    FILE *file = fopen(SCHOLARSHIP_DATA_FILE, "r");
    Scholarship *scholarships = NULL;
    size_t count = 0;
    size_t capacity = 0;
    char line[LINE_SIZE];
    int ok = 1;

    if (file == NULL) {
        fprintf(stderr, "API error: could not open %s.\n", SCHOLARSHIP_DATA_FILE);
        return 1;
    }

    while (fgets(line, sizeof(line), file) != NULL) {
        Scholarship scholarship;
        size_t length = strlen(line);

        if (length == sizeof(line) - 1 && line[length - 1] != '\n') {
            fprintf(stderr, "API error: scholarship record is too long.\n");
            ok = 0;
            break;
        }
        if (!parseScholarshipRecord(line, &scholarship)) {
            fprintf(stderr, "API error: invalid scholarship record at row %zu.\n",
                    count + 1);
            ok = 0;
            break;
        }
        if (!isfinite(scholarship.amount) ||
            !isfinite(scholarship.minimum_income) ||
            !isfinite(scholarship.minimum_cgpa)) {
            fprintf(stderr, "API error: non-finite numeric value at row %zu.\n",
                    count + 1);
            ok = 0;
            break;
        }
        if (count == capacity) {
            size_t newCapacity = capacity == 0 ? 8 : capacity * 2;
            Scholarship *resized;

            if (newCapacity < capacity ||
                newCapacity > (size_t)-1 / sizeof(*scholarships)) {
                fprintf(stderr, "API error: too many scholarship records.\n");
                ok = 0;
                break;
            }
            resized = realloc(scholarships, newCapacity * sizeof(*scholarships));
            if (resized == NULL) {
                fprintf(stderr, "API error: not enough memory to read scholarships.\n");
                ok = 0;
                break;
            }
            scholarships = resized;
            capacity = newCapacity;
        }
        scholarships[count++] = scholarship;
    }

    if (ferror(file)) {
        fprintf(stderr, "API error: could not finish reading %s.\n",
                SCHOLARSHIP_DATA_FILE);
        ok = 0;
    }
    if (fclose(file) != 0) {
        fprintf(stderr, "API error: could not close %s cleanly.\n",
                SCHOLARSHIP_DATA_FILE);
        ok = 0;
    }

    if (ok) {
        size_t index;

        if (putchar('[') == EOF) {
            ok = 0;
        }
        for (index = 0; ok && index < count; index++) {
            if ((index > 0 && putchar(',') == EOF) ||
                putchar('\n') == EOF || !writeScholarshipJson(&scholarships[index])) {
                ok = 0;
            }
        }
        if (ok && count > 0 && putchar('\n') == EOF) {
            ok = 0;
        }
        if (ok && puts("]") == EOF) {
            ok = 0;
        }
        if (ok && fflush(stdout) != 0) {
            ok = 0;
        }
        if (!ok) {
            fprintf(stderr, "API error: could not write valid JSON output.\n");
        }
    }

    free(scholarships);
    return ok ? 0 : 1;
}
