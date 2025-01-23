const { DROP_STATEMENTS } = require('./helpers/constants');

const isDropInStatements = (data, logger, cb, app) => {
	try {
		const callback = (error, script = '') => {
			cb(
				error,
				DROP_STATEMENTS.some(statement => script.includes(statement)),
			);
		};

		if (data.level === 'container') {
			this.generateContainerScript(data, logger, callback, app);
		} else if (data.level === 'entity') {
			this.generateScript(data, logger, callback, app);
		}
	} catch (e) {
		cb({ message: e.message, stack: e.stack });
	}
};

module.exports = {
	isDropInStatements,
};
