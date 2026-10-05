/*
 * c_behavior_fixture.c - controlled stand-ins for ScholarSync.exe used by
 * scripts/security-tests.js. The same source is compiled several times with a
 * -DSS_MODE_* flag so the security suite can point SCHOLARSYNC_C_PROGRAM at a
 * program that misbehaves in each of the ways the server must survive:
 *
 *   (no define)      SS default : prints output that is not JSON at all
 *   -DSS_MODE_SHAPE  : prints valid JSON with the wrong structure
 *   -DSS_MODE_FLOOD  : prints more than the server's 1 MB output cap
 *   -DSS_MODE_HANG   : never answers (server must enforce its timeout)
 *   -DSS_MODE_EXITFAIL : exits with a non-zero status
 */
#include <stdio.h>

#if defined(SS_MODE_HANG)
#include <windows.h>
int main(void) {
    Sleep(60000);
    return 0;
}
#elif defined(SS_MODE_FLOOD)
int main(void) {
    long i;
    putchar('[');
    for (i = 0; i < 2000000; i++) {
        putchar('x');
        if (i % 1000 == 0) fflush(stdout);
    }
    return 0;
}
#elif defined(SS_MODE_EXITFAIL)
int main(void) {
    return 3;
}
#elif defined(SS_MODE_SHAPE)
int main(void) {
    puts("{\"data\":[1,2,3]}");
    return 0;
}
#else
int main(void) {
    puts("this is definitely not JSON {{{");
    return 0;
}
#endif
