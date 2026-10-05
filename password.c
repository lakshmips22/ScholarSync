#include <windows.h>
#include <bcrypt.h>
#include <stdio.h>
#include <string.h>
#include "password.h"

#define SALT_SIZE 16
#define HASH_SIZE 32
#define PBKDF2_ITERATIONS 210000ULL
#define STORED_SIZE 101

static void toHex(const unsigned char *bytes, size_t count, char *hex)
{
    static const char digits[] = "0123456789abcdef";
    size_t index;

    for (index = 0; index < count; index++) {
        hex[index * 2] = digits[bytes[index] >> 4];
        hex[index * 2 + 1] = digits[bytes[index] & 0x0f];
    }
    hex[count * 2] = '\0';
}

static int hexValue(char character)
{
    if (character >= '0' && character <= '9') return character - '0';
    if (character >= 'a' && character <= 'f') return character - 'a' + 10;
    if (character >= 'A' && character <= 'F') return character - 'A' + 10;
    return -1;
}

static int fromHex(const char *hex, unsigned char *bytes, size_t count)
{
    size_t index;

    if (strlen(hex) != count * 2) return 0;
    for (index = 0; index < count; index++) {
        int high = hexValue(hex[index * 2]);
        int low = hexValue(hex[index * 2 + 1]);
        if (high < 0 || low < 0) return 0;
        bytes[index] = (unsigned char)((high << 4) | low);
    }
    return 1;
}

static int deriveHash(const char *password, const unsigned char *salt,
                      unsigned char *hash)
{
    BCRYPT_ALG_HANDLE algorithm = NULL;
    NTSTATUS status;
    size_t passwordLength = strlen(password);

    status = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM,
                                         NULL, BCRYPT_ALG_HANDLE_HMAC_FLAG);
    if (!BCRYPT_SUCCESS(status)) return 0;
    status = BCryptDeriveKeyPBKDF2(algorithm, (PUCHAR)password,
                                   (ULONG)passwordLength, (PUCHAR)salt,
                                   SALT_SIZE, PBKDF2_ITERATIONS, hash,
                                   HASH_SIZE, 0);
    BCryptCloseAlgorithmProvider(algorithm, 0);
    return BCRYPT_SUCCESS(status);
}

int hashPassword(const char *password, char *storedValue, size_t capacity)
{
    unsigned char salt[SALT_SIZE];
    unsigned char hash[HASH_SIZE];
    char saltHex[SALT_SIZE * 2 + 1];
    char hashHex[HASH_SIZE * 2 + 1];
    NTSTATUS status;

    if (password == NULL || storedValue == NULL || capacity < STORED_SIZE) return 0;
    status = BCryptGenRandom(NULL, salt, SALT_SIZE, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    if (!BCRYPT_SUCCESS(status) || !deriveHash(password, salt, hash)) return 0;
    toHex(salt, SALT_SIZE, saltHex);
    toHex(hash, HASH_SIZE, hashHex);
    if (snprintf(storedValue, capacity, "P1$%s$%s", saltHex, hashHex) >= (int)capacity) {
        return 0;
    }
    return 1;
}

int passwordIsHashed(const char *storedValue)
{
    return storedValue != NULL && strncmp(storedValue, "P1$", 3) == 0;
}

int verifyPassword(const char *password, const char *storedValue)
{
    unsigned char salt[SALT_SIZE];
    unsigned char expected[HASH_SIZE];
    unsigned char actual[HASH_SIZE];
    char saltHex[SALT_SIZE * 2 + 1];
    char hashHex[HASH_SIZE * 2 + 1];
    const char *separator;
    size_t saltLength;
    unsigned int difference = 0;
    size_t index;

    if (password == NULL || storedValue == NULL) return 0;
    if (!passwordIsHashed(storedValue)) {
        /* Legacy plain-text records are accepted once so login can upgrade them. */
        return strcmp(password, storedValue) == 0;
    }
    separator = strchr(storedValue + 3, '$');
    if (separator == NULL) return 0;
    saltLength = (size_t)(separator - (storedValue + 3));
    if (saltLength >= sizeof(saltHex)) return 0;
    memcpy(saltHex, storedValue + 3, saltLength);
    saltHex[saltLength] = '\0';
    if (strlen(separator + 1) >= sizeof(hashHex)) return 0;
    strcpy(hashHex, separator + 1);
    if (!fromHex(saltHex, salt, SALT_SIZE) ||
        !fromHex(hashHex, expected, HASH_SIZE) ||
        !deriveHash(password, salt, actual)) {
        return 0;
    }
    for (index = 0; index < HASH_SIZE; index++) {
        difference |= (unsigned int)(expected[index] ^ actual[index]);
    }
    return difference == 0;
}

