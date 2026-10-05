function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveId(value) {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

module.exports = { isRecord, positiveId };