const _ = require('lodash');
const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getViewScript } = require('./helpers/viewHelper');
const { buildScript } = require('./helpers/buildScript');

const generateViewScript = (data, logger, callback, app) => {
	try {
		const viewSchema = JSON.parse(data.jsonSchema || '{}');

		const databaseStatement = getDatabaseStatement(data.containerData);

		const script = getViewScript({
			schema: viewSchema,
			viewData: data.viewData,
			containerData: data.containerData,
			collectionRefsDefinitionsMap: data.collectionRefsDefinitionsMap,
			isKeyspaceActivated: true,
		});

		callback(null, buildScript(databaseStatement, script));
	} catch (error) {
		logger.log('error', { message: error.message, stack: error.stack }, 'Hive Forward-Engineering Error');

		callback({ message: error.message, stack: error.stack });
	}
};

module.exports = {
	generateViewScript,
};
