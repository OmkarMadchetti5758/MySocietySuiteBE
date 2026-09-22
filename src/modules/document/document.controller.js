"use strict";

const { getOperationsConnection } = require("../../config/operationsDb");
const { sendSuccess } = require("../../utils/response.utils");
const AppError = require("../../common/AppError");
const storageService = require("../../services/storage.service");

class DocumentController {
    async uploadDocument(req, res, next) {
        try {
            const { title, category, description, visibilityScope, blockId } = req.body;
            const file = req.file;

            if (!title || !category || !visibilityScope || !file) {
                return next(new AppError("Title, category, visibilityScope, and file are required", 400));
            }

            const opsDb = getOperationsConnection();
            const Document = opsDb.model("Document");
            const Block = opsDb.model("Block");

            if (visibilityScope === "Specific Block") {
                if (!blockId) {
                    return next(new AppError("blockId is required when visibilityScope is Specific Block", 400));
                }
                const blockDoc = await Block.findOne({ societyId: req.societyId, "wings._id": blockId });
                if (!blockDoc) {
                    return next(new AppError("Invalid blockId or block does not belong to your society", 400));
                }
            }

            // Upload file to Spaces
            const uploadResult = await storageService.uploadMulterFile(
                file,
                storageService.STORAGE_FOLDERS.DOCUMENTS,
                req.societyId
            );

            if (!uploadResult || !uploadResult.url) {
                return next(new AppError("Failed to upload document", 500));
            }

            const newDoc = await Document.create({
                societyId: req.societyId,
                title: title.trim(),
                category,
                description: description ? description.trim() : undefined,
                fileUrl: uploadResult.url,
                fileName: file.originalname,
                fileSize: file.size,
                uploadedBy: req.user.id,
                visibilityScope,
                blockId: visibilityScope === "Specific Block" ? blockId : undefined,
            });

            return sendSuccess(res, 201, "Document uploaded successfully", newDoc);
        } catch (error) {
            next(error);
        }
    }

    async getDocuments(req, res, next) {
        try {
            const { page = 1, limit = 10, category, search, visibilityScope } = req.query;
            const opsDb = getOperationsConnection();
            const Document = opsDb.model("Document");
            const Flat = opsDb.model("Flat");
            const UserSocietyMapping = require("../../config/masterDb").getMasterConnection().model("UserSocietyMapping");

            const filter = { societyId: req.societyId };

            if (category) filter.category = category;
            if (visibilityScope) filter.visibilityScope = visibilityScope;
            if (search) {
                filter.title = { $regex: search, $options: "i" };
            }

            // Enforce RBAC visibility
            const roleKeys = req.user.roleKeys || [];
            if (req.user.role) roleKeys.push(req.user.role);

            const isAdmin = roleKeys.some(r => ["admin", "super_admin", "committee_member"].includes(r));
            const isAccountant = roleKeys.includes("accountant");
            const isResident = roleKeys.some(r => ["resident", "resident_owner", "resident_tenant"].includes(r));

            if (!isAdmin) {
                const allowedVisibilities = [{ visibilityScope: "All Residents" }];

                if (isAccountant) {
                    allowedVisibilities.push({ visibilityScope: "Committee Only" });
                }

                if (isResident) {
                    const mapping = await UserSocietyMapping.findOne({ userId: req.user.id, societyId: req.societyId, roleKeys: { $in: ["resident_owner", "resident_tenant"] } });
                    if (mapping && mapping.flatId) {
                        const flat = await Flat.findById(mapping.flatId);
                        if (flat && flat.blockId) {
                            allowedVisibilities.push({
                                visibilityScope: "Specific Block",
                                blockId: flat.blockId
                            });
                        }
                    }
                }

                // If they have no roles that grant access, this restricts them to 'All Residents'
                filter.$or = allowedVisibilities;
            }

            const skip = (page - 1) * limit;

            const documents = await Document.find(filter)
                .populate("uploadedBy", "name")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean();

            // Manually populate blockId (since it's a wing subdocument _id)
            const blockDoc = await opsDb.model("Block").findOne({ societyId: req.societyId }).lean();
            if (blockDoc && blockDoc.wings) {
                documents.forEach(doc => {
                    if (doc.visibilityScope === "Specific Block" && doc.blockId) {
                        const wing = blockDoc.wings.find(w => String(w._id) === String(doc.blockId));
                        if (wing) {
                            doc.blockId = { _id: wing._id, name: wing.name || wing.wingCode };
                        }
                    }
                });
            }

            const total = await Document.countDocuments(filter);

            return sendSuccess(res, 200, "Documents retrieved successfully", {
                data: documents,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(total / limit),
                }
            });
        } catch (error) {
            next(error);
        }
    }

    async replaceDocument(req, res, next) {
        try {
            const { id } = req.params;
            const { title, category, description, visibilityScope, blockId } = req.body;
            const file = req.file;

            const opsDb = getOperationsConnection();
            const Document = opsDb.model("Document");
            const Block = opsDb.model("Block");

            const document = await Document.findOne({ _id: id, societyId: req.societyId });
            if (!document) {
                return next(new AppError("Document not found", 404));
            }

            if (title) document.title = title.trim();
            if (category) document.category = category;
            if (description !== undefined) document.description = description.trim();
            if (visibilityScope) {
                document.visibilityScope = visibilityScope;
                if (visibilityScope === "Specific Block") {
                    if (!blockId) return next(new AppError("blockId is required for Specific Block", 400));
                    const blockDoc = await Block.findOne({ societyId: req.societyId, "wings._id": blockId });
                    if (!blockDoc) {
                        return next(new AppError("Invalid blockId or block does not belong to your society", 400));
                    }
                    document.blockId = blockId;
                } else {
                    document.blockId = undefined;
                }
            }

            if (file) {
                // Delete old file
                if (document.fileUrl) {
                    await storageService.deleteStoredFile(document.fileUrl);
                }

                // Upload new file
                const uploadResult = await storageService.uploadMulterFile(
                    file,
                    storageService.STORAGE_FOLDERS.DOCUMENTS,
                    req.societyId
                );

                if (!uploadResult || !uploadResult.url) {
                    return next(new AppError("Failed to upload new document file", 500));
                }

                document.fileUrl = uploadResult.url;
                document.fileName = file.originalname;
                document.fileSize = file.size;
                document.uploadedBy = req.user.id;
            }

            await document.save();

            return sendSuccess(res, 200, "Document replaced successfully", document);
        } catch (error) {
            next(error);
        }
    }

    async deleteDocument(req, res, next) {
        try {
            const { id } = req.params;
            const opsDb = getOperationsConnection();
            const Document = opsDb.model("Document");

            const document = await Document.findOne({ _id: id, societyId: req.societyId });
            if (!document) {
                return next(new AppError("Document not found", 404));
            }

            if (document.fileUrl) {
                await storageService.deleteStoredFile(document.fileUrl);
            }

            await Document.deleteOne({ _id: id });

            return sendSuccess(res, 200, "Document deleted successfully");
        } catch (error) {
            next(error);
        }
    }
    async downloadDocument(req, res, next) {
        try {
            const { id } = req.params;
            const opsDb = getOperationsConnection();
            const Document = opsDb.model("Document");
            const Flat = opsDb.model("Flat");
            const UserSocietyMapping = require("../../config/masterDb").getMasterConnection().model("UserSocietyMapping");

            const document = await Document.findOne({ _id: id, societyId: req.societyId });
            if (!document) {
                return next(new AppError("Document not found or does not belong to your society", 404));
            }

            const roleKeys = req.user.roleKeys || [];
            if (req.user.role) roleKeys.push(req.user.role);

            const isAdmin = roleKeys.some(r => ["admin", "super_admin", "committee_member"].includes(r));
            const isAccountant = roleKeys.includes("accountant");
            const isResident = roleKeys.some(r => ["resident", "resident_owner", "resident_tenant"].includes(r));

            if (!isAdmin) {
                let hasAccess = false;

                if (document.visibilityScope === "All Residents") {
                    hasAccess = true;
                } else if (document.visibilityScope === "Committee Only" && isAccountant) {
                    hasAccess = true;
                } else if (document.visibilityScope === "Specific Block" && isResident) {
                    const mapping = await UserSocietyMapping.findOne({ userId: req.user.id, societyId: req.societyId, roleKeys: { $in: ["resident_owner", "resident_tenant"] } });
                    if (mapping && mapping.flatId) {
                        const flat = await Flat.findById(mapping.flatId);
                        if (flat && String(flat.blockId) === String(document.blockId)) {
                            hasAccess = true;
                        }
                    }
                }

                if (!hasAccess) {
                    return next(new AppError("Permission denied to view this document.", 403));
                }
            }

            if (!document.fileUrl) {
                return next(new AppError("File not found in storage", 404));
            }

            // Return the public URL or redirect directly
            return res.redirect(document.fileUrl);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new DocumentController();
