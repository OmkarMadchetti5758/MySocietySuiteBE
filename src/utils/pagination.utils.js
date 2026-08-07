"use strict";

const { PAGINATION } = require("../common/constants");

/**
 * Calculate pagination metadata.
 *
 * @param {number} totalDocuments - Total items matching the query.
 * @param {number} page - Current page number.
 * @param {number} limit - Items per page.
 * @returns {Object} Pagination metadata object.
 */
const buildPaginationMeta = (totalDocuments, page, limit) => {
    const totalPages = Math.ceil(totalDocuments / limit);

    return {
        totalItems: totalDocuments,
        itemCount: limit,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
    };
};

/**
 * Extract safely parsed pagination options from request query.
 */
const getPaginationOptions = (query) => {
    const page = parseInt(query.page, 10) || PAGINATION.DEFAULT_PAGE;
    let limit = parseInt(query.limit, 10) || PAGINATION.DEFAULT_LIMIT;

    if (limit > PAGINATION.MAX_LIMIT) {
        limit = PAGINATION.MAX_LIMIT;
    }

    const skip = (page - 1) * limit;

    return { page, limit, skip };
};

module.exports = { buildPaginationMeta, getPaginationOptions };
