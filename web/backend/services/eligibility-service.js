const NORTH_EAST_STATES = new Set([
    "arunachal pradesh", "assam", "manipur", "meghalaya",
    "mizoram", "nagaland", "sikkim", "tripura"
]);
function sameText(left, right) {
    return String(left).toLocaleLowerCase("en-US") === String(right).toLocaleLowerCase("en-US");
}

function profileProblems(student) {
    const missing = [];
    const invalid = [];
    for (const field of ["course", "category", "state", "gender"]) {
        if (typeof student[field] !== "string" || student[field].trim() === "") missing.push(field);
    }
    if (typeof student.annual_income !== "number" || !Number.isFinite(student.annual_income)) {
        invalid.push("annual_income");
    } else if (student.annual_income < 0) {
        invalid.push("annual_income");
    }
    if (typeof student.cgpa !== "number" || !Number.isFinite(student.cgpa) ||
        student.cgpa < 0 || student.cgpa > 10) {
        invalid.push("cgpa");
    }
    if (student.disability !== "Yes" && student.disability !== "No") {
        invalid.push("disability");
    }
    return { missing, invalid };
}

function evaluateScholarship(student, scholarship) {
    const criteria = [];
    const reasons = [];

    function add(field, requirement, applies, passed, passText, failText) {
        const explanation = applies ? (passed ? passText : failText) : "No restriction is listed for this field.";
        criteria.push({ field, requirement, applies, passed, explanation });
        if (applies && !passed) reasons.push(failText);
    }

    const maxIncome = scholarship.minimum_income;
    const hasIncomeLimit = maxIncome > 0;
    add(
        "minimum_income",
        hasIncomeLimit ? `At most ₹${maxIncome} annual family income` : "No maximum income listed",
        hasIncomeLimit,
        !hasIncomeLimit || student.annual_income <= maxIncome,
        "Your profile meets the listed income limit.",
        "Your profile does not meet the listed income limit."
    );

    const courseRule = scholarship.eligible_course;
    const hasCourseRule = courseRule !== "" && !sameText(courseRule, "Any");
    add(
        "eligible_course",
        hasCourseRule ? courseRule : "Any course",
        hasCourseRule,
        !hasCourseRule || sameText(courseRule, student.course),
        "Your course meets the listed course rule.",
        "Your course does not match the listed course rule."
    );

    const categoryRule = scholarship.eligible_category;
    const hasCategoryRule = categoryRule !== "" && !sameText(categoryRule, "Any");
    const categoryMatches = !hasCategoryRule || categoryRule.split(",").some((option) => sameText(option, student.category));
    add(
        "eligible_category",
        hasCategoryRule ? categoryRule : "Any category",
        hasCategoryRule,
        categoryMatches,
        "Your category matches a listed category.",
        "Your category does not match the listed category rule."
    );

    const stateRule = scholarship.eligible_state;
    const hasStateRule = stateRule !== "" && !sameText(stateRule, "Any");
    const stateMatches = !hasStateRule || (sameText(stateRule, "North East")
        ? NORTH_EAST_STATES.has(String(student.state).toLocaleLowerCase("en-US"))
        : sameText(stateRule, student.state));
    add(
        "eligible_state",
        hasStateRule ? stateRule : "Any state",
        hasStateRule,
        stateMatches,
        "Your state meets the listed state rule.",
        "Your state does not match the listed state rule."
    );

    const genderRule = scholarship.eligible_gender;
    const hasGenderRule = genderRule !== "" && !sameText(genderRule, "Any");
    add(
        "eligible_gender",
        hasGenderRule ? genderRule : "Any gender",
        hasGenderRule,
        !hasGenderRule || sameText(genderRule, student.gender),
        "Your gender meets the listed rule.",
        "Your gender does not match the listed rule."
    );

    const disabilityRule = scholarship.disability_required;
    const hasDisabilityRule = disabilityRule !== "" && !sameText(disabilityRule, "Any");
    add(
        "disability_required",
        hasDisabilityRule ? disabilityRule : "No disability-specific restriction listed",
        hasDisabilityRule,
        !hasDisabilityRule || sameText(disabilityRule, student.disability),
        "Your profile meets the listed disability rule.",
        "Your profile does not match the listed disability rule."
    );

    const minimumCgpa = scholarship.minimum_cgpa;
    const hasCgpaRule = minimumCgpa > 0;
    add(
        "minimum_cgpa",
        hasCgpaRule ? `At least ${minimumCgpa} out of 10` : "No minimum CGPA listed",
        hasCgpaRule,
        !hasCgpaRule || student.cgpa >= minimumCgpa,
        "Your CGPA meets the listed minimum.",
        "Your CGPA is below the listed minimum."
    );

    const eligible = reasons.length === 0;
    return {
        eligible,
        criteria,
        reasons: eligible ? ["Your profile meets all listed eligibility rules."] : reasons
    };
}

function deadlineState(deadline, today = new Date().toISOString().slice(0, 10)) {
    if (typeof deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return "unknown";
    const parsed = new Date(`${deadline}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== deadline) return "unknown";
    return deadline < today ? "expired" : "active";
}

function safeScholarship(row) {
    return {
        scholarship_id: row.scholarship_id,
        name: row.name,
        provider: row.provider,
        description: row.description,
        amount: row.amount,
        minimum_income: row.minimum_income,
        deadline: row.deadline,
        eligible_course: row.eligible_course,
        eligible_category: row.eligible_category,
        eligible_state: row.eligible_state,
        eligible_gender: row.eligible_gender,
        disability_required: row.disability_required,
        category: row.category,
        minimum_cgpa: row.minimum_cgpa
    };
}

module.exports = { deadlineState, evaluateScholarship, profileProblems, safeScholarship };


