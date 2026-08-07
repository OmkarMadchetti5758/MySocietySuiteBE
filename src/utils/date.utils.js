"use strict";

/**
 * Check if a given date is in the past
 */
const isExpired = (date) => {
    if (!date) return true;
    return new Date() > new Date(date);
};

/**
 * Add minutes to current date
 */
const addMinutes = (minutes) => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
};

/**
 * Add days to current date
 */
const addDays = (days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
};

module.exports = {
    isExpired,
    addMinutes,
    addDays,
};
