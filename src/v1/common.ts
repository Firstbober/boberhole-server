export enum Status {
	BH_SUCCESS = "BH_SUCCESS",
	BH_RATE_LIMITED = "BH_RATE_LIMITED",
	BH_ERROR = "BH_ERROR",
	BH_INVALID_AUTHORIZATION = "BH_INVALID_AUTHORIZATION",
	BH_BAD_JSON = "BH_BAD_JSON",
	BH_NOT_FOUND = "BH_NOT_FOUND",
	BH_UNKNOWN = "BH_UNKNOWN",
	BH_TOO_LARGE = "BH_TOO_LARGE"
}

function enumToKeyArray(status: any) {
	let arr = [];

	for (let status in Status) {
		if (isNaN(status as any)) {
			arr.push(status)
		}
	}

	return arr;
}

export const VERSION = "1.17.0";

export function genAuthHeader() {
	return {
		type: 'object',
		properties: {
			'Authorization': { type: 'string' }
		},
		required: ['Authorization']
	};
}

export function genBasicResponses(content: any, error_content: any = { type: 'string' }) {
	return {
		200: {
			type: 'object',
			properties: {
				status: { type: 'string' },
				content: {
					type: 'object',
					properties: content
				}
			}
		},
		400: {
			type: 'object',
			properties: {
				status: { type: 'string', enum: enumToKeyArray(Status) },
				content: error_content
			}
		}
	}
}

import * as cryptoRandomString from 'crypto-random-string';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Session } from './user';

export async function generateIdForModel(model: any, model_name: string, len: number = 12) {
	let id: string;
	let found_good_id = false;

	let where = {};

	do {
		id = cryptoRandomString({ length: len, type: 'alphanumeric' });
		where[model_name + "_id"] = id;
		let models = await model.findAll({
			where: where
		});

		if (models.length == 0) {
			found_good_id = true;
		}
	} while (!found_good_id);

	return id;
}

interface IAuthorization {
	user_id: string,
	session_id: string
}

export async function getAuthorizationFromHeader(req: FastifyRequest, res: FastifyReply): Promise<IAuthorization> {
	const invalid_authorization = () => {
		res.code(400).send({
			status: Status.BH_INVALID_AUTHORIZATION,
			content: ""
		});
		return undefined;
	}

	if (req.headers.authorization == undefined) {
		return invalid_authorization();
	}

	let token = atob(req.headers.authorization);
	let token_split = token.split(";");

	if (token_split.length != 3) {
		return invalid_authorization();
	}

	let sessions = await Session.findAll({
		where: {
			session_id: token_split[1],
			user_id: token_split[0]
		}
	});

	if (sessions.length == 0) {
		return invalid_authorization();
	}

	return {
		user_id: token_split[0],
		session_id: token_split[1]
	} as IAuthorization;
}