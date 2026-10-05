#ifndef SCHOLARSYNC_SCHOLARSHIP_H
#define SCHOLARSYNC_SCHOLARSHIP_H

#include "shared.h"

int parseScholarshipRecord(const char *line, Scholarship *scholarship);
void browseScholarships(void);
void searchScholarships(void);
void recommendScholarships(const Student *student);
void filterScholarships(const Student *student);
void saveScholarshipForStudent(const Student *student);
void viewSavedScholarshipsForStudent(const Student *student);
void removeSavedScholarshipForStudent(const Student *student);

#endif



