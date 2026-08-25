"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");

class NoticeService {
    get NoticeModel() {
        return getOperationsConnection().model("Notice");
    }

    get BlockModel() {
        return getOperationsConnection().model("Block");
    }

    async createNotice(societyId, userId, data) {
        const notice = new this.NoticeModel({
            ...data,
            societyId,
            createdBy: userId,
        });
        await notice.save();
        return notice;
    }

    async getNotices(societyId, queryParams) {
        const { targetType, targetBlockId } = queryParams;
        const filter = { societyId, isActive: true };

        // For residents, we can pass targetType="ALL" OR targetBlockId from controller
        if (targetType) {
            filter.$or = [{ targetType: "ALL" }];
            if (targetBlockId) {
                filter.$or.push({ targetBlockId });
            }
        }

        const notices = await this.NoticeModel.find(filter)
            .sort({ createdAt: -1 })
            .populate("createdBy", "name")
            .lean();

        const blockDoc = await this.BlockModel.findOne({ societyId }).lean();
        const wingMap = {};
        if (blockDoc && blockDoc.wings) {
            blockDoc.wings.forEach(w => wingMap[w._id.toString()] = w.name);
        }

        notices.forEach(n => {
            if (n.targetType === "BLOCK" && n.targetBlockId) {
                n.targetBlockName = wingMap[n.targetBlockId.toString()] || "Specific Block";
            }
        });

        return notices;
    }

    async getNoticeById(societyId, id) {
        const notice = await this.NoticeModel.findOne({ _id: id, societyId, isActive: true })
            .populate("createdBy", "name")
            .lean();
        
        if (notice && notice.targetType === "BLOCK" && notice.targetBlockId) {
            const blockDoc = await this.BlockModel.findOne({ societyId }).lean();
            const wing = blockDoc?.wings?.find(w => w._id.toString() === notice.targetBlockId.toString());
            notice.targetBlockName = wing ? wing.name : "Specific Block";
        }
        return notice;
    }

    async updateNotice(societyId, id, data) {
        const notice = await this.NoticeModel.findOneAndUpdate(
            { _id: id, societyId },
            { $set: data },
            { new: true }
        );
        return notice;
    }

    async deleteNotice(societyId, id) {
        const notice = await this.NoticeModel.findOneAndUpdate(
            { _id: id, societyId },
            { $set: { isActive: false } },
            { new: true }
        );
        return notice;
    }
}

module.exports = new NoticeService();
