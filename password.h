#ifndef SCHOLARSYNC_PASSWORD_H
#define SCHOLARSYNC_PASSWORD_H

#include <stddef.h>

int hashPassword(const char *password, char *storedValue, size_t capacity);
int verifyPassword(const char *password, const char *storedValue);
int passwordIsHashed(const char *storedValue);

#endif
