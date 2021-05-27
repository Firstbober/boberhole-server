import * as nodemailer from 'nodemailer';
import config from "../../config/default";

import { DataTypes, Sequelize } from "sequelize";
const userDb = new Sequelize({
	dialect: 'sqlite',
	storage: `${config.data.database}/user.db`
});

import { generateIdForModel } from './common';

export const Activation = userDb.define('Activation', {
	activation_id: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	user_id: {
		type: DataTypes.TEXT,
		allowNull: false
	}
});

const transport = nodemailer.createTransport({
	host: config.mail.smtp.host,
	port: config.mail.smtp.port,
	secure: config.mail.smtp.secure,
	auth: {
		user: config.mail.smtp.auth.user,
		pass: config.mail.smtp.auth.pass
	}
});

export async function sendActivationEmail(email: string, user_id: string) {
	let id = await generateIdForModel(Activation);

	Activation.create({
		activation_id: id,
		user_id: user_id
	}).then(async () => {
		await transport.sendMail({
			from: `Boberhole Account System`,
			to: email,
			subject: "Verify e-mail for your Boberhole Account",
			text: `Go to this link to verify your account: ${config.www.baseURL}/api/v1/user/confirm_email/${id}`
		});
	});
}

export async function verifyActivationId(activation_id: string) {
	let activation_ids = await Activation.findAll({
		where: {
			activation_id: activation_id
		}
	});

	if (activation_ids.length == 0) {
		return false;
	}

	activation_ids = await Activation.findAll({
		where: {
			user_id: activation_ids[0].getDataValue("user_id")
		}
	});

	activation_ids.forEach((activation) => {
		activation.destroy();
	});

	return true;
}

export async function isUserVerified(user_id: string) {
	let activation_ids = await Activation.findAll({
		where: {
			user_id: user_id
		}
	});

	return activation_ids.length == 0;
}