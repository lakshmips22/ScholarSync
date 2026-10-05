function safeStudent(row) {
    return {
        student_id: row.student_id,
        name: row.name,
        email: row.email,
        course: row.course,
        annual_income: row.annual_income,
        category: row.category,
        state: row.state,
        gender: row.gender,
        disability: row.disability,
        cgpa: row.cgpa,
        created_at: row.created_at
    };
}

module.exports = { safeStudent };
