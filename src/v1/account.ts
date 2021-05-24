import { FastifyInstance } from "fastify";
import { genBasicResponses, genAuthHeader, Status } from "./common";
import config from "../../config/default";
import * as dayjs from "dayjs";
const captcha = require("nodejs-captcha");

import { User, Session } from "./user";
import * as argon2 from "argon2";
import * as cryptoRandomString from 'crypto-random-string';

import { DataTypes, Sequelize } from "sequelize";
const challengeDb = new Sequelize({
	dialect: 'sqlite',
	storage: `${config.data.database}/challenge.db`
});

const Challenge = challengeDb.define('Challenge', {
	value: {
		type: DataTypes.TEXT,
		allowNull: false
	}
});

challengeDb.authenticate().then(() => {
	Challenge.sync({ alter: true });
}).catch((err) => {
	console.error(err);
	process.exit(1);
})

setInterval(() => {
	Challenge.findAll({}).then((value) => {
		value.forEach((challenge) => {
			let date = new Date(challenge.getDataValue("createdAt"));

			if (dayjs(date).add(15, 'minutes') <= dayjs()) {
				challenge.destroy();
			}
		});
	});
}, 900000); // 15 minutes

enum StatusAccount {
	BH_SIGN_UP_USERNAME_TAKEN = "BH_SIGN_UP_USERNAME_TAKEN",
	BH_SIGN_UP_EMAIL_TAKEN = "BH_SIGN_UP_EMAIL_TAKEN",
	BH_SIGN_UP_IN_INVALID_FIELD = "BH_SIGN_UP_IN_INVALID_FIELD",
	BH_SIGN_UP_CHALLENGE_FAILED = "BH_SIGN_UP_CHALLENGE_FAILED",
	BH_SIGN_IN_EMAIL_NOT_VERIFIED = "BH_SIGN_IN_EMAIL_NOT_VERIFIED"
}

interface ISignUpBody {
	username: string,
	password: string,
	email: string,
	challenge_response: string
}

export default function (app: FastifyInstance, _opts, done) {
	app.post<{
		Body: ISignUpBody
	}>("/sign_up", {
		schema: {
			body: {
				type: 'object',
				properties: {
					username: { type: 'string', minimum: 3, maxLength: 32, pattern: "[A-Za-z0-9_]+" },
					password: { type: 'string', minimum: 12, maxLength: 255 },
					email: { type: 'string', maxLength: 255 },
					challenge_response: { type: 'string', maxLength: 255 }
				},
				required: ['username', 'password', 'email', 'challenge_response']
			},
			response: genBasicResponses({})
		}
	}, (req, res) => {
		Challenge.findAll({}).then(async (value) => {
			let failed = value.length > 0 ? false : true;

			for (const challenge of value) {
				let date = new Date(challenge.getDataValue("createdAt"));

				console.log(challenge.getDataValue("value"));

				if ((dayjs(date).add(15, 'minutes') <= dayjs()) || challenge.getDataValue("value") != req.body.challenge_response) {
					failed = true;
				} else {
					failed = false;
					break;
				}
			}

			if (failed) {
				res.code(400).send({
					status: StatusAccount.BH_SIGN_UP_CHALLENGE_FAILED,
					content: ""
				});
				return;
			}

			if (
				!(
					(
						req.body.username.length >= 3 &&
						req.body.username.length <= 32 &&
						/[A-Za-z0-9_]+/.test(req.body.username)
					)
					&&
					(
						req.body.password.length >= 12 &&
						req.body.username.length <= 255
					)
					&& req.body.email.length <= 255
					&& req.body.challenge_response.length <= 255
				)
			) {
				res.code(400).send({
					status: StatusAccount.BH_SIGN_UP_IN_INVALID_FIELD,
					content: ""
				});
				return;
			}

			let foundUsers = await User.findAll({
				where: {
					username: req.body.username,
					email: req.body.email
				}
			});

			if (foundUsers.length > 0) {
				let error: StatusAccount;

				if (foundUsers[0].getDataValue("username") == req.body.username) {
					error = StatusAccount.BH_SIGN_UP_USERNAME_TAKEN;
				} else {
					error = StatusAccount.BH_SIGN_UP_EMAIL_TAKEN;
				}

				res.code(400).send({
					status: error,
					content: ""
				});

				return;
			}

			let user_id: string;
			let found_good_id = false;

			do {
				user_id = cryptoRandomString({ length: 12, type: 'alphanumeric' });
				let users = await User.findAll({
					where: {
						user_id: user_id
					}
				});

				if (users.length == 0) {
					found_good_id = true;
				}
			} while (!found_good_id);

			await User.create({
				user_id: user_id,
				username: req.body.username,
				email: req.body.email,
				avatar: null,
				password: await argon2.hash(req.body.password, {
					type: argon2.argon2id
				})
			});

			res.send({
				status: Status.BH_SUCCESS,
				content: {}
			});
		});
	});

	app.get("/challenge/image", {
		schema: {
			response: genBasicResponses({
				image: { type: 'string' }
			})
		}
	}, (req, res) => {
		let cap = captcha();
		Challenge.create({ value: cap.value });

		res.send({
			status: Status.BH_SUCCESS,
			content: {
				image: cap.image
			}
		});
	});

	done();
}