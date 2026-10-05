# ScholarSync Walkthrough Guide

## Build and start
1. Open a terminal in the `ScholarSync` folder.
2. Run `build.bat` using Windows GCC with BCrypt support.
3. Run `scholarsync.exe` from this folder. The program uses relative paths into `data/`.

## First-time setup
1. Choose Admin > Login and create the first Admin username and password.
2. Choose Student > Register to create a student account. Enter a CGPA from 0 to 10.
3. Sign in and try the scholarship catalog and matching rules.

## Student workflow
1. Show My Profile, including CGPA.
2. Browse or search the ten catalog entries.
3. Try Eligibility Matcher and Recommendations. They compare course, income, category, state, gender, disability, and CGPA when rules are listed.
4. Save a scholarship and create an in-app application tracking record, then view Saved Scholarships and Application Tracker.
5. Try Deadline Tracker. Catalog deadlines are project-set dates for December 2026 and January 2027; verify official dates before applying.

## Admin workflow
1. List, add, edit, or remove catalog entries. Scholarship category is separate from a student's category requirement. Minimum CGPA is on a 0–10 scale.
2. Review an application tracking record and update its local status.
3. Show List Students, Search Student by ID, and Statistics.
4. Export Application Report to create `data/application_report.csv`.
5. Use Backup Data before demonstrating Restore Data. Restore overwrites current data and requires typing `RESTORE`.

## Notes
The catalog's names, providers, amounts, and categories were supplied for this project. Eligibility rules are project-defined examples and are not official provider criteria. Catalog dates are project-set planning dates, not verified provider deadlines. Backups may contain account hashes and personal data, so keep them private.
