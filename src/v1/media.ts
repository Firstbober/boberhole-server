import config from "../../config/default";
import { FastifyInstance, FastifySchema } from "fastify";
import { DataTypes, Sequelize } from "sequelize";
import * as fs from "fs";

import * as util from "util";
import { pipeline } from "stream";
const pump = util.promisify(pipeline);

import { genBasicResponses, genAuthHeader, Status, generateIdForModel, getAuthorizationFromHeader } from "./common";
import { ContentTypes, MiBtoBytes, IContentType } from "./content";

import * as unzipper from "unzipper";
import * as mime from "mime-types";
import * as dayjs from "dayjs";

const mediaDb = new Sequelize({
	dialect: 'sqlite',
	storage: `${config.data.database}/media.db`
});

const Resource = mediaDb.define('Resource', {
	resource_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	files: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	used_in_contents: {
		type: DataTypes.TEXT,
		allowNull: false
	}
});

Resource.sync();
fs.mkdirSync(config.data.media.resource, { recursive: true });

interface IResourceUploadParams {
	resource_info: string
}

interface IResourceGetInfoParams {
	resource_id: string
}

interface IResourceGetFileParams {
	resource_id: string,
	filename: string
}

setInterval(() => {
	Resource.findAll({}).then((value) => {
		value.forEach((resource) => {
			let date = new Date(resource.getDataValue("createdAt"));

			if (dayjs(date).add(15, 'minutes') <= dayjs()) {
				if (JSON.parse(resource.getDataValue("used_in_contents")).length == 0) {
					resource.destroy();
				}
			}
		});
	});
}, 900000); // 15 minutes

export async function checkIfResourceExists(resource_id: string): Promise<boolean> {
	let resource = await Resource.findOne({
		where: {
			resource_id: resource_id
		}
	});

	return resource != null;
}

export async function markAsUsedInContent(resource_id: string, content_id: string) {
	let resource = await Resource.findOne({
		where: {
			resource_id: resource_id
		}
	});

	if (resource == null) {
		return;
	}

	let usedInContents: Array<string> = JSON.parse(resource.getDataValue("used_in_contents"));
	usedInContents.push(content_id);

	resource.setDataValue("used_in_contents", JSON.stringify(usedInContents));
	resource.save();
}

export async function removeContentFromBeingUsed(resource_id: string, content_id: string) {
	let resource = await Resource.findOne({
		where: {
			resource_id: resource_id
		}
	});

	if (resource == null) {
		return;
	}

	let usedInContents: Array<string> = JSON.parse(resource.getDataValue("used_in_contents"));
	let index = usedInContents.indexOf(content_id);

	if (index == -1) {
		return;
	}

	usedInContents.splice(index, 1);

	resource.setDataValue("used_in_contents", JSON.stringify(usedInContents));
	resource.save();
}

export default function (app: FastifyInstance, _opts: any, done: any) {
	app.put<{
		Params: IResourceUploadParams
	}>("/resource/upload/:resource_info", {
		schema: {
			tags: ["Media"],
			headers: genAuthHeader(),
			consumes: ["multipart/form-data"],
			response: genBasicResponses({
				resource_id: { type: 'string' }
			}),
			params: {
				type: 'object',
				properties: {
					resource_info: {
						type: 'string',
						example: `{"content_type": "type", "zipped_multiple": true/false} - Both aren't required`
					}
				}
			}
		} as FastifySchema,
		preHandler: app.rateLimit({
			max: 5,
			timeWindow: '1 minute'
		})
	}, async (req, res) => {
		if (await getAuthorizationFromHeader(req, res)) {
			let fileSizeLimit = MiBtoBytes(16);
			let zippedMultiple = false;

			/* Check file size limit and zipiness based on content type */
			let resource_info = {}
			let content_type: IContentType = null;

			if (req.params.resource_info) {
				try {
					let tmp_resource_info = JSON.parse(req.params.resource_info);
					if (tmp_resource_info["content_type"]) {
						resource_info["content_type"] = tmp_resource_info["content_type"];
					}
					if (tmp_resource_info["zipped_multiple"]) {
						resource_info["zipped_multiple"] = tmp_resource_info["zipped_multiple"];
					}
				} catch { }

				if (resource_info["content_type"]) {
					content_type = ContentTypes.getTypeByName(resource_info["content_type"]);
				}
			}

			if (content_type && resource_info["content_type"]) {
				if (content_type.resourceFileSize)
					fileSizeLimit = content_type.resourceFileSize;
			} else if (content_type != null) {
				res.code(400).send({
					status: Status.BH_ERROR,
					content: "content_type || bad json"
				});
			}

			if (resource_info["zipped_multiple"] == true) {
				zippedMultiple = true;
			}
			/* Check file size limit and zipiness based on content type */

			try {
				const file = await req.file({
					limits: {
						fileSize: fileSizeLimit,
						fieldSize: fileSizeLimit,
						fields: 0,
						files: 1
					}
				});

				let resource_id = await generateIdForModel(Resource, "resource");
				let resource_fs_base_path = `${config.data.media.resource}/${resource_id}`;
				let files = [];

				fs.mkdirSync(resource_fs_base_path);

				await pump(file.file, fs.createWriteStream(`${resource_fs_base_path}/${file.filename}`));

				if (zippedMultiple && file.mimetype == "application/zip") {
					fs.renameSync(`${resource_fs_base_path}/${file.filename}`, `${resource_fs_base_path}/rsc_tmp_${resource_id}_${file.filename}`);

					fs.createReadStream(`${resource_fs_base_path}/rsc_tmp_${resource_id}_${file.filename}`)
						.pipe(unzipper.Parse())
						.on('entry', (entry: unzipper.Entry) => {
							files.push(entry.path);
							entry.pipe(fs.createWriteStream(`${resource_fs_base_path}/${entry.path}`));
						})
						.on('close', () => {
							fs.rmSync(`${resource_fs_base_path}/rsc_tmp_${resource_id}_${file.filename}`);

							Resource.create({
								resource_id: resource_id,
								files: JSON.stringify(files),
								used_in_contents: JSON.stringify([])
							});

							res.send({
								status: Status.BH_SUCCESS,
								content: {
									resource_id: resource_id
								}
							});
						});
				} else {
					files.push(`${file.filename}`);

					Resource.create({
						resource_id: resource_id,
						files: JSON.stringify(files),
						used_in_contents: JSON.stringify([])
					});

					res.send({
						status: Status.BH_SUCCESS,
						content: {
							resource_id: resource_id
						}
					});
				}
			} catch (error) {
				if (error instanceof app.multipartErrors.InvalidMultipartContentTypeError) {
					res.code(400).send({
						status: Status.BH_NO_DATA,
						content: ""
					});
					return;
				}

				if (
					error instanceof app.multipartErrors.FilesLimitError ||
					error instanceof app.multipartErrors.RequestFileTooLargeError
				) {
					res.code(400).send({
						status: Status.BH_TOO_LARGE,
						content: ""
					});
					return;
				}

				console.error(error);

				res.code(400).send({
					status: Status.BH_UNKNOWN,
					content: ""
				});
				return;
			}
		}
	});

	app.get<{
		Params: IResourceGetInfoParams
	}>("/resource/:resource_id/info", {
		schema: {
			tags: ["Media"],
			response: genBasicResponses({
				files: { type: 'array' }
			}),
			params: {
				type: 'object',
				properties: {
					resource_id: { type: 'string' }
				}
			}
		} as FastifySchema
	}, async (req, res) => {
		let resources = await Resource.findAll({
			where: {
				resource_id: req.params.resource_id
			}
		});

		if (resources.length == 0) {
			res.code(400).send({
				status: Status.BH_NOT_FOUND,
				content: ""
			});
			return;
		}

		let resource = resources[0];

		res.send({
			status: Status.BH_SUCCESS,
			content: {
				files: JSON.parse(resource.getDataValue('files'))
			}
		})
	});

	app.get<{
		Params: IResourceGetFileParams
	}>("/resource/:resource_id/:filename", {
		schema: {
			tags: ["Media"],
			params: {
				type: 'object',
				properties: {
					resource_id: { type: 'string' },
					filename: { type: 'string' }
				}
			}
		} as FastifySchema
	}, async (req, res) => {
		let resources = await Resource.findAll({
			where: {
				resource_id: req.params.resource_id
			}
		});

		if (resources.length == 0) {
			res.code(400).send({
				status: Status.BH_NOT_FOUND,
				content: ""
			});
			return;
		}

		let resource = resources[0];
		let files: Array<string> = JSON.parse(resource.getDataValue('files'));

		if (!files.includes(req.params.filename)) {
			res.code(400).send({
				status: Status.BH_NOT_FOUND,
				content: ""
			});
			return;
		}

		let type = mime.lookup(req.params.filename);

		res
			.type(type ? type : "")
			.send(fs.createReadStream(`${config.data.media.resource}/${req.params.resource_id}/${req.params.filename}`));
	});


	done();
}