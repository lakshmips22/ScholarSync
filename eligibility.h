#ifndef SCHOLARSYNC_ELIGIBILITY_H
#define SCHOLARSYNC_ELIGIBILITY_H

#include "shared.h"

int scholarshipMatchesStudent(const Scholarship *scholarship, const Student *student);
void findEligibleScholarships(const Student *student);

#endif
