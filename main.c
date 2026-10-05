#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "student.h"
#include "admin.h"
#include "api.h"

static void showMainMenu(void)
{
    system("cls");
    puts("============================================================");
    puts("                         SCHOLARSYNC");
    puts("             Smart Scholarship Management System");
    puts("============================================================");
    puts("              Discover  |  Match  |  Apply  |  Track");
    puts("------------------------------------------------------------");
    puts("                    1. Student Portal");
    puts("                    2. Admin Portal");
    puts("                    3. Exit");
    puts("------------------------------------------------------------");
}

static int readMainChoice(void)
{
    char input[64];
    char *end;
    long choice;

    printf("Enter your choice: ");
    if (fgets(input, sizeof(input), stdin) == NULL) {
        return -2;
    }
    choice = strtol(input, &end, 10);
    while (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n') {
        end++;
    }
    if (end == input || *end != '\0' || choice < 1 || choice > 3) {
        return -1;
    }
    return (int)choice;
}

int main(int argc, char *argv[])
{
    int choice;

    if (argc > 1) {
        if (argc == 3 && strcmp(argv[1], "--api") == 0 &&
            strcmp(argv[2], "scholarships") == 0) {
            return runScholarshipsApi();
        }
        fprintf(stderr, "Usage: scholarsync.exe --api scholarships\n");
        return 2;
    }

    for (;;) {
        showMainMenu();
        choice = readMainChoice();
        if (choice == -2) {
            puts("Goodbye!");
            return 0;
        }
        switch (choice) {
        case 1:
            studentPortal();
            break;
        case 2:
            adminPortal();
            break;
        case 3:
            puts("Goodbye!");
            return 0;
        default:
            puts("[ERROR] Invalid choice. Please enter 1, 2, or 3.");
        }
    }
}
