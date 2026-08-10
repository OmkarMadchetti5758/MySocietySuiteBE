"use strict";

const { getMasterConnection } = require("../../config/masterDb");

class SocietyRepository {
    async _getSocietyModel() {
        const masterDb = await getMasterConnection();
        return masterDb.model("Society");
    }

    async _getMappingModel() {
        const masterDb = await getMasterConnection();
        return masterDb.model("UserSocietyMapping");
    }

    async checkDatabaseExists(databaseName) {
        const Society = await this._getSocietyModel();
        return Society.findOne({ databaseName: databaseName.toLowerCase() }).lean();
    }

    async checkSocietyExists(name) {
        const Society = await this._getSocietyModel();
        return Society.findOne({ name: name }).lean();
    }

    async checkIdentifierExists(identifier) {
        if (!identifier) return false;
        const Mapping = await this._getMappingModel();
        return Mapping.findOne({ identifier: identifier.toLowerCase() }).lean();
    }

    async createSociety(societyData) {
        const Society = await this._getSocietyModel();
        return Society.create(societyData);
    }

    async createUserMappings(mappings) {
        const Mapping = await this._getMappingModel();
        return Mapping.insertMany(mappings);
    }

    async getActiveSocieties() {
        const Society = await this._getSocietyModel();
        // Return only what is needed for the dropdown
        return Society.find({ status: "active" })
            .select("_id name databaseName")
            .sort({ name: 1 })
            .lean();
    }
}

module.exports = new SocietyRepository();
