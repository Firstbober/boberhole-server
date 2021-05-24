import config from "../../config/default";

export enum FollowStatus {
	BH_FOLLOW_ALREADY_FOLLOWING = "BH_FOLLOW_ALREADY_FOLLOWING"
}

import { DataTypes, Sequelize } from "sequelize";
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

	// Personal / auth info
	email: {
		type: DataTypes.STRING,
		allowNull: false
	},

	password: {
		type: DataTypes.TEXT,
		allowNull: false
	},

	avatar: {
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
})

User.sync();
Session.sync();