"use strict";

function toPaise(rupeesFloat) {
    if (rupeesFloat === null || rupeesFloat === undefined || isNaN(rupeesFloat)) return 0;
    // Math.round implements round-half-up for positive numbers (ties go up)
    return Math.round(Number(rupeesFloat) * 100);
}

function fromPaise(paiseInt) {
    return (Math.round(Number(paiseInt)) / 100).toFixed(2);
}

function formatINR(paiseInt) {
    const rupees = Math.abs(Math.round(Number(paiseInt))) / 100;
    // Indian grouping: last 3 digits, then groups of 2
    const [intPart, decPart] = rupees.toFixed(2).split(".");
    const lastThree = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const formatted = rest
        ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree
        : lastThree;
    const sign = paiseInt < 0 ? "-" : "";
    return `${sign}₹${formatted}.${decPart}`;
}

function addPaise(a, b) {
    return (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0);
}

module.exports = { toPaise, fromPaise, formatINR, addPaise };
