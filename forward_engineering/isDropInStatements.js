const { generateContainerScript } = require('./generateContainerScript');
const { generateScript } = require('./generateScript');
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
			generateContainerScript(data, logger, callback, app);
		} else if (data.level === 'entity') {
			generateScript(data, logger, callback, app);
		}
	} catch (e) {
		cb({ message: e.message, stack: e.stack });
	}
};

module.exports = {
	isDropInStatements,
};
