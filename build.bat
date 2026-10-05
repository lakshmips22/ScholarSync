@echo off
gcc -std=c11 -Wall -Wextra -pedantic main.c student.c scholarship.c application.c admin.c file_manager.c eligibility.c deadline.c api.c password.c -lbcrypt -o scholarsync.exe
if errorlevel 1 exit /b %errorlevel%
echo Build successful: scholarsync.exe
