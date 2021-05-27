export enum Status {
	BH_SUCCESS = "BH_SUCCESS",
	BH_RATE_LIMITED = "BH_RATE_LIMITED",
	BH_ERROR = "BH_ERROR",
	BH_INVALID_AUTHORIZATION = "BH_INVALID_AUTHORIZATION",
	BH_BAD_JSON = "BH_BAD_JSON",
	BN_NOT_FOUND = "BN_NOT_FOUND",
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

export function genBasicResponses(content: any) {
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
				content: { type: 'string' }
			}
		}
	}
}

import * as cryptoRandomString from 'crypto-random-string';

export async function generateIdForModel(model: any, len: number = 12) {
	let id: string;
	let found_good_id = false;

	do {
		id = cryptoRandomString({ length: len, type: 'alphanumeric' });
		let models = await model.findAll({
			where: {
				id: id
			}
		});

		if (models.length == 0) {
			found_good_id = true;
		}
	} while (!found_good_id);

	return id;
}