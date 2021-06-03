import { FastifyInstance, FastifySchema } from "fastify";
import { genBasicResponses, genAuthHeader, Status, generateIdForModel, getAuthorizationFromHeader } from "./common";
import config from "../../config/default";
import * as dayjs from "dayjs";
const captcha = require("nodejs-captcha");

import { User, Session, generateSessionToken } from "./user";
import { sendActivationEmail, verifyActivationId, isUserVerified } from "./mail";
import { AdminPermissions } from "./admin";
import * as argon2 from "argon2";

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
	BH_SIGN_IN_EMAIL_NOT_VERIFIED = "BH_SIGN_IN_EMAIL_NOT_VERIFIED",
	BH_SIGN_IN_USER_NOT_FOUND = "BH_SIGN_IN_USER_NOT_FOUND"
}

interface ISignUpBody {
	username: string,
	password: string,
	email: string,
	challenge_response: string
}

interface ISignInBody {
	username: string,
	password: string
}

interface IConfirmEmailParams {
	activation_id: string
}

interface IRevokeSessionParams {
	session_id: string
}

export default function (app: FastifyInstance, _opts: any, done: any) {
	app.post<{
		Body: ISignUpBody
	}>("/sign_up", {
		schema: {
			tags: ["Account"],
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
		}  as FastifySchema
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
						req.body.password.length <= 255
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

			let user_id = await generateIdForModel(User, "user");

			await User.create({
				user_id: user_id,
				username: req.body.username,
				email: req.body.email,
				avatar: null,
				password: await argon2.hash(req.body.password, {
					type: argon2.argon2id
				}),
				permissions: await User.count() == 0 ? JSON.stringify([AdminPermissions.ADMIN_ALL]) : null
			});

			sendActivationEmail(req.body.email, user_id);

			res.send({
				status: Status.BH_SUCCESS,
				content: {}
			});
		});
	});

	app.post<{
		Body: ISignInBody
	}>("/sign_in", {
		schema: {
			tags: ["Account"],
			body: {
				type: 'object',
				properties: {
					username: { type: 'string', minimum: 3, maxLength: 32, pattern: "[A-Za-z0-9_]+" },
					password: { type: 'string', minimum: 12, maxLength: 255 }
				},
				required: ['username', 'password']
			},
			response: genBasicResponses({
				token: { type: 'string' }
			})
		}  as FastifySchema
	}, (req, res) => {
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
			)
		) {
			res.code(400).send({
				status: StatusAccount.BH_SIGN_UP_IN_INVALID_FIELD,
				content: ""
			});
			return;
		}

		User.findAll({
			where: {
				username: req.body.username
			}
		}).then(async (users) => {
			if (users.length == 0) {
				res.code(400).send({
					status: StatusAccount.BH_SIGN_IN_USER_NOT_FOUND,
					content: ""
				});
				return;
			}

			let user = users[0];

			if (!(await argon2.verify(user.getDataValue("password"), req.body.password, {
				type: argon2.argon2id
			}))) {
				res.code(400).send({
					status: StatusAccount.BH_SIGN_UP_IN_INVALID_FIELD,
					content: ""
				});
				return;
			}

			if (!(await isUserVerified(user.getDataValue("user_id")))) {
				res.code(400).send({
					status: StatusAccount.BH_SIGN_IN_EMAIL_NOT_VERIFIED,
					content: ""
				});

				sendActivationEmail(user.getDataValue("email"), user.getDataValue("user_id"));

				return;
			}

			let session_id = await generateIdForModel(Session, "session");
			Session.create({
				session_id: session_id,
				user_id: user.getDataValue("user_id"),
				user_agent: req.headers["user-agent"]
			}).then(() => {
				res.send({
					status: Status.BH_SUCCESS,
					content: {
						token: generateSessionToken(session_id, user.getDataValue("user_id"))
					}
				});
				return;
			});
		});
	});

	app.post("/log_out", {
		schema: {
			tags: ["Account"],
			headers: genAuthHeader(),
			response: genBasicResponses({})
		}  as FastifySchema
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then(async (auth) => {
			if (auth) {
				let sessions = await Session.findAll({
					where: {
						session_id: auth.session_id
					}
				});

				if (sessions.length == 0) {
					res.code(400).send({
						status: Status.BH_ERROR,
						content: ""
					});
					return;
				}

				sessions[0].destroy().then(() => {
					res.send({
						status: Status.BH_SUCCESS,
						content: {}
					});
					return;
				});
			}
		});
	});

	app.get("/challenge/image", {
		schema: {
			tags: ["Account"],
			response: genBasicResponses({
				image: { type: 'string' }
			})
		}  as FastifySchema
	}, (_req, res) => {
		let cap = captcha();
		Challenge.create({ value: cap.value });

		res.send({
			status: Status.BH_SUCCESS,
			content: {
				image: cap.image
			}
		});
	});

	app.get<{
		Params: IConfirmEmailParams
	}>("/confirm_email/:activation_id", {
		schema: {
			tags: ["Account"],
			response: genBasicResponses({})
		}  as FastifySchema
	}, (req, res) => {
		verifyActivationId(req.params.activation_id).then((result) => {
			if (result) {
				res.send({
					status: Status.BH_SUCCESS,
					content: ""
				});
			} else {
				res.code(400).send({
					status: Status.BH_ERROR,
					content: ""
				});
			}
		});
	});

	app.get("/sessions", {
		schema: {
			tags: ["Account"],
			headers: genAuthHeader(),
			response: genBasicResponses({
				sessions: {
					type: 'array'
				}
			})
		}  as FastifySchema
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then(async (auth) => {
			if (auth) {
				let sessions = await Session.findAll({
					where: {
						user_id: auth.user_id
					}
				});

				let array_resp = [];

				sessions.forEach((session) => {
					array_resp.push({
						session_id: session.getDataValue("session_id"),
						user_agent: session.getDataValue("user_agent")
					});
					console.log('aaa');
				});

				res.send({
					status: Status.BH_SUCCESS,
					content: {
						sessions: array_resp
					}
				});
				return;
			}
		});
	});

	app.get<{
		Params: IRevokeSessionParams
	}>("/:session_id/revoke", {
		schema: {
			tags: ["Account"],
			headers: genAuthHeader(),
			response: genBasicResponses({})
		}  as FastifySchema
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then(async (auth) => {
			if (auth) {
				let sessions = await Session.findAll({
					where: {
						session_id: req.params.session_id,
						user_id: auth.user_id
					}
				});

				if (sessions.length == 0) {
					res.code(400).send({
						status: Status.BH_ERROR,
						content: ""
					});
					return;
				}

				sessions[0].destroy().then(() => {
					res.send({
						status: Status.BH_SUCCESS,
						content: {}
					});
				});
			}
		});
	});

	done();
}