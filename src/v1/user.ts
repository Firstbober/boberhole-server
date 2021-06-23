import config from "../../config/default";
import { FastifyInstance, FastifySchema } from "fastify";
import { genBasicResponses, genAuthHeader, Status, generateIdForModel, getAuthorizationFromHeader } from "./common";
import * as argon2 from "argon2";
import { Events, sendEvent, listenEvent } from "../events";

import { DataTypes, Sequelize } from "sequelize";
import { RateLimitOptions } from "fastify-rate-limit";
const userDb = new Sequelize({
	dialect: 'sqlite',
	storage: `${config.data.database}/user.db`
});

export const User = userDb.define('User', {
	user_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	username: {
		type: DataTypes.STRING(32),
		allowNull: false
	},

	avatar: {
		type: DataTypes.TEXT,
		allowNull: true
	},

	// Personal / auth info
	email: {
		type: DataTypes.STRING,
		allowNull: false
	},

	password: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	permissions: {
		type: DataTypes.TEXT,
		allowNull: true
	}
});

export const Session = userDb.define('Session', {
	session_id: {
		type: DataTypes.TEXT,
		allowNull: false,
	},

	user_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	user_agent: {
		type: DataTypes.TEXT,
		allowNull: false
	}
});

export function generateSessionToken(session_id: string, user_id: string) {
	return btoa(`${user_id};${session_id};${+Date.now()}`);
}

User.sync();
Session.sync();

listenEvent(Events.USER_REMOVE_ACCOUNT, (data) => {
	Session.findAll({
		where: {
			user_id: data.user_id
		}
	}).then((sessions) => {
		if (sessions.length == 0) {
			return;
		}

		sessions.forEach((session) => {
			session.destroy();
		});
	});

	User.findAll({
		where: {
			user_id: data.user_id
		}
	}).then((users) => {
		if (users.length == 0) {
			return;
		}

		users[0].destroy();
	});
});

interface IGetUserInfoParams {
	user_id: string
}

interface IUserChangeInfoBody {
	avatar?: string,
	email?: string,
	password?: string
}

interface IUserRemoveAccountBody {
	password: string
}

const UserRateLimit: RateLimitOptions = {
	max: 10,
	timeWindow: '1 minute'
};

export default function (app: FastifyInstance, _opts: any, done: any) {
	app.get("/email", {
		schema: {
			tags: ["User"],
			headers: genAuthHeader(),
			response: genBasicResponses({
				email: { type: 'string' }
			})
		} as FastifySchema
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then((auth) => {
			if (auth) {
				User.findOne({
					where: {
						user_id: auth.user_id
					}
				}).then((user) => {
					res.send({
						status: Status.BH_SUCCESS,
						content: {
							email: user.getDataValue("email")
						}
					});
				});
			}
		});
	});

	app.get<{
		Params: IGetUserInfoParams
	}>("/:user_id/info", {
		schema: {
			tags: ["User"],
			response: genBasicResponses({
				username: { type: 'string' },
				avatar: { type: 'string' },
				creation_date: { type: 'string' }
			})
		}  as FastifySchema
	}, (req, res) => {
		User.findAll({
			where: {
				user_id: req.params.user_id
			}
		}).then((users) => {
			if (users.length == 0) {
				res.code(400).send({
					status: Status.BH_NOT_FOUND,
					content: ""
				});
				return;
			}

			let user = users[0];
			res.send({
				status: Status.BH_SUCCESS,
				content: {
					username: user.getDataValue("username"),
					avatar: user.getDataValue("avatar"),
					creation_date: user.getDataValue("createdAt")
				}
			});
		});
	});

	app.post<{
		Body: IUserChangeInfoBody
	}>("/change/info", {
		schema: {
			tags: ["User"],
			headers: genAuthHeader(),
			body: {
				type: 'object',
				properties: {
					avatar: { type: 'string' },
					email: { type: 'string' },
					password: { type: 'string' }
				}
			},
			response: genBasicResponses({
				changed: { type: 'array' }
			})
		} as FastifySchema,
		preHandler: app.rateLimit(UserRateLimit)
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then(async (auth) => {
			if (auth) {
				let user = await User.findOne({
					where: {
						user_id: auth.user_id
					}
				});

				let changed = [];

				if (req.body.avatar) {
					if (req.body.avatar == "remove") {
						user.setDataValue("avatar", "");
					} else if (req.body.avatar.length < 256) {
						user.setDataValue("avatar", req.body.avatar);
					} else {
						res.code(400).send({
							status: Status.BH_ERROR,
							content: "avatar"
						});
						return;
					}

					changed.push("avatar");
				}

				if (req.body.email) {
					if (req.body.email.length < 256) {
						user.setDataValue("email", req.body.email);
						changed.push("email");
					} else {
						res.code(400).send({
							status: Status.BH_ERROR,
							content: "email"
						});
						return;
					}
				}

				if (req.body.password) {
					if (req.body.password.length >= 12 &&
						req.body.password.length <= 255) {
						user.setDataValue("password", await argon2.hash(req.body.password, {
							type: argon2.argon2id
						}));
						changed.push("password");
					} else {
						res.code(400).send({
							status: Status.BH_ERROR,
							content: "password"
						});
						return;
					}
				}

				user.save().then(() => {
					res.send({
						status: Status.BH_SUCCESS,
						content: {
							changed: changed
						}
					});
				}).catch(() => {
					res.code(400).send({
						status: Status.BH_UNKNOWN,
						content: ""
					});
				});
			}
		})
	});

	app.post<{
		Body: IUserRemoveAccountBody
	}>("/remove_account", {
		schema: {
			tags: ["User"],
			headers: genAuthHeader(),
			body: {
				type: 'object',
				properties: {
					password: { type: 'string' }
				},
				required: ['password']
			},
			response: genBasicResponses({})
		} as FastifySchema,
		preHandler: app.rateLimit(UserRateLimit)
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then((auth) => {
			if (auth) {
				if (req.body.password.length > 255) {
					res.code(400).send({
						status: Status.BH_ERROR,
						content: "password"
					});
					return;
				}

				User.findOne({
					where: {
						user_id: auth.user_id
					}
				}).then(user => {
					argon2.verify(user.getDataValue("password"), req.body.password, {
						type: argon2.argon2id
					}).then((valid) => {
						if (valid) {
							sendEvent(Events.USER_REMOVE_ACCOUNT, {
								user_id: auth.user_id
							});

							res.send({
								status: Status.BH_SUCCESS,
								content: {}
							});
						} else {
							res.code(400).send({
								status: Status.BH_ERROR,
								content: "password"
							});
						}
					});
				});
			}
		});
	});

	app.get("/permissions", {
		schema: {
			tags: ["User"],
			headers: genAuthHeader(),
			response: genBasicResponses({
				permissions: { type: 'array' }
			})
		}  as FastifySchema
	}, (req, res) => {
		getAuthorizationFromHeader(req, res).then(async (auth) => {
			if (auth) {
				let user = await User.findOne({
					where: {
						user_id: auth.user_id
					}
				});

				let perms = [];

				if (user.getDataValue("permissions")) {
					perms = perms.concat(JSON.parse(user.getDataValue("permissions")));
				}

				res.send({
					status: Status.BH_SUCCESS,
					content: {
						permissions: perms
					}
				});
			}
		});
	});

	done();
}