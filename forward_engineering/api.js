const applyToInstanceHelper = require('./helpers/applyToInstanceHelper');
const { connect } = require('../reverse_engineering/api');
const { generateScript } = require('./generateScript');
const { generateViewScript } = require('./generateViewScript');
const { generateContainerScript } = require('./generateContainerScript');
const { isDropInStatements } = require('./isDropInStatements');

module.exports = {
	generateScript,

	generateViewScript,

	generateContainerScript,

	isDropInStatements,

	testConnection: function (connectionInfo, logger, cb, app) {
		logInfo('Test connection', connectionInfo, logger);
		connect(
			connectionInfo,
			logger,
			err => {
				if (err) {
					logger.log('error', { message: err.message, stack: err.stack, error: err }, 'Connection failed');
				}

				return cb(err);
			},
			app,
		);
	},

	async applyToInstance(connectionInfo, logger, callback, app) {
		logger.clear();
		logInfo('info', connectionInfo, logger);

		try {
			await applyToInstanceHelper.applyToInstance(connectionInfo, logger, app);
			callback();
		} catch (error) {
			callback(error);
		}
	},
};

const logInfo = (step, connectionInfo, logger) => {
	logger.clear();
	logger.log('info', connectionInfo, 'connectionInfo', connectionInfo.hiddenKeys);
};
