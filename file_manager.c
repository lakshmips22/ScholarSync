#include <stdio.h>
#include <string.h>
#include "file_manager.h"

#define FILE_COUNT 5
#define PATH_SIZE 80

static const char *dataFiles[FILE_COUNT] = {
    "data/students.txt",
    "data/scholarships.txt",
    "data/applications.txt",
    "data/saved.txt",
    "data/admin.txt"
};

static int copyFile(const char *sourcePath, const char *destinationPath)
{
    FILE *source = fopen(sourcePath, "rb");
    FILE *destination;
    unsigned char buffer[4096];
    size_t bytesRead;
    int ok = 1;

    if (source == NULL) {
        return 0;
    }
    destination = fopen(destinationPath, "wb");
    if (destination == NULL) {
        fclose(source);
        return 0;
    }
    while ((bytesRead = fread(buffer, 1, sizeof(buffer), source)) > 0) {
        if (fwrite(buffer, 1, bytesRead, destination) != bytesRead) {
            ok = 0;
            break;
        }
    }
    if (ferror(source)) {
        ok = 0;
    }
    if (fclose(source) != 0) {
        ok = 0;
    }
    if (fclose(destination) != 0) {
        ok = 0;
    }
    return ok;
}

static void makeBackupPath(size_t index, char *path, size_t capacity)
{
    snprintf(path, capacity, "%s.bak", dataFiles[index]);
}

void backupData(void)
{
    char backupPath[PATH_SIZE];
    size_t index;
    int copied = 0;
    int failed = 0;
    int skipped = 0;

    puts("\n--- Backup Data ---");
    for (index = 0; index < FILE_COUNT; index++) {
        makeBackupPath(index, backupPath, sizeof(backupPath));
        if (copyFile(dataFiles[index], backupPath)) {
            copied++;
            printf("Backed up %s\n", dataFiles[index]);
        } else {
            FILE *check = fopen(dataFiles[index], "rb");
            if (check == NULL) {
                skipped++;
                printf("Skipped missing file %s\n", dataFiles[index]);
            } else {
                fclose(check);
                failed++;
                printf("Could not back up %s\n", dataFiles[index]);
            }
        }
    }
    printf("Backup finished: %d copied, %d skipped, %d failed.\n",
           copied, skipped, failed);
}

void restoreData(void)
{
    char answer[40];
    char backupPath[PATH_SIZE];
    size_t index;
    int restored = 0;
    int failed = 0;
    int skipped = 0;

    puts("\n--- Restore Data ---");
    puts("This overwrites current data with the saved .bak copies.");
    printf("Type RESTORE to continue: ");
    if (fgets(answer, sizeof(answer), stdin) == NULL) {
        puts("Restore cancelled.");
        return;
    }
    answer[strcspn(answer, "\r\n")] = '\0';
    if (strcmp(answer, "RESTORE") != 0) {
        puts("Restore cancelled.");
        return;
    }

    for (index = 0; index < FILE_COUNT; index++) {
        makeBackupPath(index, backupPath, sizeof(backupPath));
        if (copyFile(backupPath, dataFiles[index])) {
            restored++;
            printf("Restored %s\n", dataFiles[index]);
        } else {
            FILE *check = fopen(backupPath, "rb");
            if (check == NULL) {
                skipped++;
                printf("Skipped missing backup %s\n", backupPath);
            } else {
                fclose(check);
                failed++;
                printf("Could not restore %s\n", dataFiles[index]);
            }
        }
    }
    printf("Restore finished: %d restored, %d skipped, %d failed.\n",
           restored, skipped, failed);
}
