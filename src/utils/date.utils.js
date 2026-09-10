const isExpired = (date) => {
    if (!date) return true;
    return new Date() > new Date(date);
};

const addMinutes = (minutes) => {
    const date = new Date();
    date.setMinutes(date.getMinutes() + minutes);
    return date;
};

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
