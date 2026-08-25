"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { POLL_STATUS } = require("../../common/constants");

class PollService {
    get PollModel() {
        return getOperationsConnection().model("Poll");
    }

    get PollVoteModel() {
        return getOperationsConnection().model("PollVote");
    }

    get BlockModel() {
        return getOperationsConnection().model("Block");
    }

    async createPoll(societyId, userId, data) {
        const poll = new this.PollModel({
            ...data,
            societyId,
            createdBy: userId,
        });
        await poll.save();
        return poll;
    }

    async getPolls(societyId, queryParams, userId) {
        const { targetType, targetBlockId } = queryParams;
        const filter = { societyId };

        if (targetType) {
            filter.$or = [{ targetType: "ALL" }];
            if (targetBlockId) {
                filter.$or.push({ targetBlockId });
            }
        }

        const polls = await this.PollModel.find(filter)
            .sort({ createdAt: -1 })
            .populate("createdBy", "name")
            .lean();

        const now = new Date();

        // Fetch this user's votes for all these polls in one query
        let userVotesMap = {};
        if (userId) {
            const pollIds = polls.map(p => p._id);
            const userVotes = await this.PollVoteModel.find({
                pollId: { $in: pollIds },
                residentId: userId,
            }).lean();
            userVotes.forEach(v => {
                userVotesMap[v.pollId.toString()] = v.optionId.toString();
            });
        }

        const blockDoc = await this.BlockModel.findOne({ societyId }).lean();
        const wingMap = {};
        if (blockDoc && blockDoc.wings) {
            blockDoc.wings.forEach(w => wingMap[w._id.toString()] = w.name);
        }

        polls.forEach(poll => {
            if (new Date(poll.closingDate) <= now) {
                poll.status = POLL_STATUS.CLOSED;
            }
            // Attach the user's voted optionId (null if not voted)
            poll.myVote = userVotesMap[poll._id.toString()] || null;

            if (poll.targetType === "BLOCK" && poll.targetBlockId) {
                poll.targetBlockName = wingMap[poll.targetBlockId.toString()] || "Specific Block";
            }
        });

        return polls;
    }

    async getPollById(societyId, id) {
        const poll = await this.PollModel.findOne({ _id: id, societyId })
            .populate("createdBy", "name")
            .lean();
        
        if (poll) {
            if (new Date(poll.closingDate) <= new Date()) {
                poll.status = POLL_STATUS.CLOSED;
            }
            if (poll.targetType === "BLOCK" && poll.targetBlockId) {
                const blockDoc = await this.BlockModel.findOne({ societyId }).lean();
                const wing = blockDoc?.wings?.find(w => w._id.toString() === poll.targetBlockId.toString());
                poll.targetBlockName = wing ? wing.name : "Specific Block";
            }
        }

        return poll;
    }

    async votePoll(societyId, pollId, residentId, optionId) {
        const poll = await this.PollModel.findOne({ _id: pollId, societyId });
        if (!poll) {
            throw new Error("Poll not found");
        }
        if (new Date(poll.closingDate) <= new Date() || poll.status === POLL_STATUS.CLOSED) {
            throw new Error("Poll is closed for voting");
        }

        // Validate optionId exists
        const optionExists = poll.options.some(opt => opt._id.toString() === optionId.toString());
        if (!optionExists) {
            throw new Error("Invalid option selected");
        }

        const vote = new this.PollVoteModel({
            pollId,
            optionId,
            residentId,
        });

        // The unique index will throw an error if the user already voted
        await vote.save();
        return vote;
    }

    async getPollResults(societyId, pollId) {
        const poll = await this.PollModel.findOne({ _id: pollId, societyId }).lean();
        if (!poll) throw new Error("Poll not found");

        const votes = await this.PollVoteModel.find({ pollId });
        
        const totalVotes = votes.length;
        const results = poll.options.map(opt => {
            const count = votes.filter(v => v.optionId.toString() === opt._id.toString()).length;
            const percentage = totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(2) : 0;
            return {
                optionId: opt._id,
                text: opt.text,
                count,
                percentage
            };
        });

        return {
            totalVotes,
            results,
            poll
        };
    }

    async updatePoll(societyId, id, data) {
        const poll = await this.PollModel.findOneAndUpdate(
            { _id: id, societyId },
            { $set: data },
            { new: true }
        );
        return poll;
    }

    async deletePoll(societyId, id) {
        // Here we could just mark it inactive or physically delete
        const poll = await this.PollModel.findOneAndDelete({ _id: id, societyId });
        if (poll) {
            await this.PollVoteModel.deleteMany({ pollId: id });
        }
        return poll;
    }
}

module.exports = new PollService();
