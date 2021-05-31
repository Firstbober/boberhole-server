import fastify from "fastify";
import config from "../config/default";
import fastify_swagger from "fastify-swagger";

import { VERSION, Status } from "./v1/common";
import account from "./v1/account";
import user from "./v1/user";
import { exit } from "process";

const app = fastify({
	logger: true
});
app.register(fastify_swagger, {
	routePrefix: "/docs",
	swagger: {
		info: {
			title: "Boberhole API",
			version: VERSION
		},
		schemes: ['http'],
		consumes: ['application/json'],
		tags: [
			{ name: "Account", description: "Account related stuff" },
			{ name: "User", description: "User related stuff" }
		]
	},
	staticCSP: true,
	transformStaticCSP: (header) => header,
	exposeRoute: true
})

app.register(account, { prefix: "/api/v1/account" });
app.register(user, { prefix: "/api/v1/user" });

app.setErrorHandler((error, _req, res) => {
	if (error.validation) {
		res.status(400).send({
			status: Status.BH_ERROR,
			content: error.message
		});
	}

	if (error.stack) {
		let status: Status;
		switch (error.message) {
			case "Unexpected end of JSON input":
				status = Status.BH_BAD_JSON;
				break;

			default:
				status = Status.BH_ERROR;
				break;
		}

		res.status(400).send({
			status: status,
			content: error.message
		});
	}
});

app.listen(config.www.port, (_err, address) => {
	if (_err) {
		console.error(_err);
		exit(1);
	}

	console.log(`Server listening on ${address}`);
	app.swagger();
});