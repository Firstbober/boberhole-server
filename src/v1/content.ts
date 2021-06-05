enum ContentStatus {
	BH_CONTENT_INVALID_TYPE = "BH_CONTENT_INVALID_TYPE",
	BH_CONTENT_INVALID_BODY = "BH_CONTENT_INVALID_BODY",
	BH_CONTENT_INVALID_RESOURCE_REF = "BH_CONTENT_INVALID_RESOURCE_REF"
}

export enum DataFieldType {
	STRING,
	NUMBER,
	BOOLEAN,
	STRING_ARRAY,
	STRING_DATE
}

export interface IContentDataField {
	name: string,
	type: DataFieldType,

	maxLength?: number,
	minLength?: number,

	// Does reference any content or resource?
	contentReference?: boolean,
	resourceReference?: boolean,

	// Requires specified mime-type?
	acceptedMimeTypes?: Array<string>
}

export interface IContentType {
	name: string,

	// Fields in content data
	fields: Array<IContentDataField>,

	// Editable fields
	editable?: Array<string>,

	// Size of the resource file(s) in bytes
	resourceFileSize?: number

	// Blacklists content types that can be attached eg.
	// comment can be added but not the vote
	attachBlacklist?: Array<string>,

	// Is this content attachable to others? Eg. comment
	attachable: boolean
}

interface IContentTypes {
	types: Array<IContentType>,
	getTypeByName: (name: string) => IContentType | null
}

export function MiBtoBytes(mib: number) {
	return mib * 1048576;
}

export const ContentTypes: IContentTypes = {
	types: [
		{
			name: "bh.content.type.video",
			fields: [
				{
					name: "title",
					type: DataFieldType.STRING,
					maxLength: 70,
					minLength: 1
				},
				{
					name: "description",
					type: DataFieldType.STRING,
					maxLength: 2000,
					minLength: 0
				},
				{
					name: "video",
					type: DataFieldType.STRING,
					resourceReference: true,
					acceptedMimeTypes: ["video/*"]
				},
				{
					name: "thumbnail",
					type: DataFieldType.STRING,
					resourceReference: true,
					acceptedMimeTypes: ["image/*"]
				}
			],
			editable: ["title", "description"],
			resourceFileSize: MiBtoBytes(512),
			attachable: false
		},
		{
			name: "bh.content.type.game",
			fields: [
				{
					name: "title",
					type: DataFieldType.STRING,
					maxLength: 70,
					minLength: 1
				},
				{
					name: "original_authors",
					type: DataFieldType.STRING_ARRAY
				},
				{
					name: "release_date",
					type: DataFieldType.STRING_DATE
				},
				{
					name: "type",
					type: DataFieldType.STRING
				},
				{
					name: "game",
					type: DataFieldType.STRING,
					resourceReference: true
				}
			],
			editable: ["title"],
			resourceFileSize: MiBtoBytes(256),
			attachable: false
		},
		{
			name: "bh.content.type.comment",
			fields: [
				{
					name: "content",
					type: DataFieldType.STRING,
					minLength: 1,
					maxLength: 2000
				}
			],
			editable: ["content"],
			attachable: true
		},
		{
			name: "bh.content.type.booru.image",
			fields: [
				{
					name: "tags",
					type: DataFieldType.STRING_ARRAY
				},
				{
					name: "image",
					type: DataFieldType.STRING,
					resourceReference: true,
					acceptedMimeTypes: ["image/*"]
				}
			],
			editable: ["tags"],
			attachable: false,
		}
	],

	getTypeByName(name: string): IContentType | null {
		let type = null;
		this.types.forEach((_type: IContentType) => {
			if (_type.name == name) {
				type = _type;
			}
		});

		return type;
	}
};

import config from "../../config/default";
import { DataTypes, Model, ModelCtor, Sequelize } from "sequelize";

const contentDb = new Sequelize({
	dialect: 'sqlite',
	storage: `${config.data.database}/content.db`
});

let contentModels = new Map<string, ModelCtor<Model<any, any>>>();

ContentTypes.types.forEach(type => {
	let columns = {
		content_id: {
			type: DataTypes.TEXT,
			allowNull: false
		},

		user_id: {
			type: DataTypes.TEXT,
			allowNull: false
		}
	};

	type.fields.forEach(field => {
		let type: any;

		switch (field.type) {
			case DataFieldType.STRING:
			case DataFieldType.STRING_ARRAY:
			case DataFieldType.STRING_DATE:
				type = DataTypes.TEXT;
				break;

			case DataFieldType.BOOLEAN:
				type = DataTypes.BOOLEAN;
				break;

			case DataFieldType.NUMBER:
				type = DataTypes.NUMBER;
				break;

			default:
				break;
		}

		columns[field.name] = {
			type: type,
			allowNull: false
		};
	});

	if (type.attachable) {
		columns["attached_to"] = {
			type: DataTypes.STRING,
			allowNull: false
		};
	}

	let model = contentDb.define(type.name, columns);
	model.sync();

	contentModels.set(type.name, model);
});

const Lookup = contentDb.define('Lookup', {
	lookup_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	content_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	type: {
		type: DataTypes.TEXT,
		allowNull: false
	},
});

Lookup.sync();

import { genBasicResponses, genAuthHeader, Status, generateIdForModel, getAuthorizationFromHeader } from "./common";
import { FastifyInstance, FastifySchema } from "fastify";
import { checkIfResourceExists, markAsUsedInContent, removeContentFromBeingUsed } from "./media";

interface IContentAddBody {
	type: string,
	content: Object
}

interface IOnlyContentIDParam {
	content_id: string
}

async function validateObjectByContentType(content_type: IContentType, object: Object): Promise<[boolean, ContentStatus | null]> {
	let validFields = 0;

	for (const entry of Object.entries(object)) {
		let foundField: IContentDataField = null;

		for (const field of content_type.fields) {
			if (field.name == entry[0]) {
				foundField = field;
			} else {
				continue;
			}
		}

		if (foundField == null) {
			continue;
		}

		let entry_type: DataFieldType = null;

		if (typeof entry[1] === "string") {
			entry_type = DataFieldType.STRING;
		} else if (typeof entry[1] === "number") {
			entry_type = DataFieldType.NUMBER;
		} else if (typeof entry[1] === "boolean") {
			entry_type = DataFieldType.BOOLEAN;
		}

		if (entry_type != foundField.type) {
			continue;
		}

		switch (foundField.type) {
			case DataFieldType.STRING:
			case DataFieldType.STRING_ARRAY:
			case DataFieldType.STRING_DATE:
				if (foundField.maxLength) {
					if (entry[1].length > foundField.maxLength) {
						continue;
					}
				}

				if (foundField.minLength) {
					if (entry[1].length < foundField.minLength) {
						continue;
					}
				}

				validFields += 1;
				break;

			case DataFieldType.BOOLEAN:
				validFields += 1;
				break;

			case DataFieldType.NUMBER:
				if (foundField.maxLength) {
					if (entry[1] > foundField.maxLength) {
						continue;
					}
				}

				if (foundField.minLength) {
					if (entry[1] < foundField.minLength) {
						continue;
					}
				}

				validFields += 1;
				break;

			default:
				break;
		}

		if (
			foundField.type == DataFieldType.STRING &&
			foundField.resourceReference
		) {
			if (!(await checkIfResourceExists(entry[1]))) {
				validFields -= 1;
				return [false, ContentStatus.BH_CONTENT_INVALID_RESOURCE_REF];
			}
		}

		// TODO: Add content check
	}

	if (validFields != content_type.fields.length) {
		return [false, ContentStatus.BH_CONTENT_INVALID_BODY];
	}

	return [true, null];
}

interface ILookedUpContent {
	content: Model<any, any>,
	id: string,
	type: string
}

async function getContentFromLookup(lookup_id: string): Promise<ILookedUpContent | null> {
	let lookupContent = await Lookup.findOne({
		where: {
			lookup_id: lookup_id
		}
	});

	if (lookupContent == null) {
		return null;
	}

	let content = await contentModels.get(lookupContent.getDataValue("type")).findOne({
		where: {
			content_id: lookupContent.getDataValue("content_id")
		}
	});

	if (content == null) {
		return null;
	}

	return {
		content: content,
		id: lookupContent.getDataValue("content_id"),
		type: lookupContent.getDataValue("type")
	};
}

export default function (app: FastifyInstance, _opts: any, done: any) {
	app.post<{
		Body: IContentAddBody
	}>("/add", {
		schema: {
			tags: ["Content"],
			headers: genAuthHeader(),
			body: {
				type: 'object',
				propeties: {
					type: { type: 'string' },
					content: { type: 'object' }
				},
				required: ['type', 'content']
			},
			response: genBasicResponses({
				content_id: { type: 'string' }
			})
		} as FastifySchema
	}, async (req, res) => {
		let auth = await getAuthorizationFromHeader(req, res);
		if (auth) {
			let content_type = ContentTypes.getTypeByName(req.body.type);
			if (content_type == null) {
				res.code(400).send({
					status: ContentStatus.BH_CONTENT_INVALID_TYPE,
					content: ""
				});
				return;
			}

			let validationResult = await validateObjectByContentType(content_type, req.body.content);

			if (validationResult[0] == false) {
				res.code(400).send({
					status: validationResult[1],
					content: ""
				});
				return;
			}

			let lookup_id = await generateIdForModel(Lookup, "lookup");
			let content_id = await generateIdForModel(contentModels.get(req.body.type), "content");
			req.body.content["content_id"] = content_id;
			req.body.content["user_id"] = auth.user_id;

			await Lookup.create({
				lookup_id: lookup_id,
				content_id: content_id,
				type: req.body.type
			});

			contentModels.get(req.body.type).create(req.body.content).then(_ => {
				for (const entry of Object.entries(req.body.content)) {
					for (const field of content_type.fields) {
						if (field.name == entry[0] && field.resourceReference) {
							markAsUsedInContent(entry[1], lookup_id);
						}
					}
				}

				res.send({
					status: Status.BH_SUCCESS,
					content: {
						content_id: lookup_id
					}
				});
			});
		}
	});

	app.post<{
		Params: IOnlyContentIDParam
	}>("/remove/:content_id", {
		schema: {
			tags: ["Content"],
			headers: genAuthHeader(),
			params: {
				type: 'object',
				properties: {
					content_id: { type: 'string' }
				}
			},
			response: genBasicResponses({})
		} as FastifySchema
	}, async (req, res) => {
		let auth = await getAuthorizationFromHeader(req, res);
		if (auth) {
			let content = await getContentFromLookup(req.params.content_id);

			if (content == null) {
				res.code(400).send({
					status: Status.BH_NOT_FOUND,
					content: ""
				});
				return;
			}

			if (content.content.getDataValue("user_id") != auth.user_id) {
				res.code(400).send({
					status: Status.BH_NOT_PERMITTED,
					content: ""
				});
				return;
			}

			let content_type = ContentTypes.getTypeByName(content.type);

			content_type.fields.forEach(async field => {
				if (field.resourceReference) {
					await removeContentFromBeingUsed(content.content.getDataValue(field.name), req.params.content_id);
				}
			});

			Lookup.findOne({
				where: {
					lookup_id: req.params.content_id
				}
			}).then(lookup => {
				lookup.destroy();
			});

			content.content.destroy().then(_ => {
				res.send({
					status: Status.BH_SUCCESS,
					content: {}
				});
			});
		}
	});

	done();
}