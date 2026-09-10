"use strict";

const { PAGINATION } = require("../common/constants");

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
