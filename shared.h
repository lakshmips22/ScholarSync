#ifndef SCHOLARSYNC_SHARED_H
#define SCHOLARSYNC_SHARED_H

/* Shared data models for the ScholarSync modules. */
typedef struct {
    int id;
    char name[100];
    char email[100];
    char password[128];
    char course[100];
    float annual_income;
    char category[30];
    char state[60];
    char gender[20];
    char disability[10];
    float cgpa;
} Student;

typedef struct {
    int id;
    char name[150];
    char provider[100];
    char description[500];
    float amount;
    float minimum_income;
    char deadline[20];
    char eligible_course[100];
    char eligible_category[30];
    char eligible_state[60];
    char eligible_gender[20];
    char disability_required[10];
    char category[40];
    float minimum_cgpa;
} Scholarship;

typedef struct {
    int id;
    int student_id;
    int scholarship_id;
    char status[30];
    char applied_on[20];
} Application;

typedef struct {
    int student_id;
    int scholarship_id;
} SavedScholarship;

#endif


