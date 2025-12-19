const _ = require('lodash');
const { getAlterScript } = require('./helpers/alterScriptFromDeltaHelper');
const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getTableStatement } = require('./helpers/tableHelper');
const { getIndexes } = require('./helpers/indexHelper');
const { buildScript } = require('./helpers/buildScript');
const { getIsPkOrFkConstraintAvailable, getIsConstraintAvailable } = require('./helpers/constraintHelper');

const generateScript = (data, logger, callback, app) => {
	try {
		const jsonSchema = JSON.parse(data.jsonSchema);
		const modelDefinitions = JSON.parse(data.modelDefinitions);
		const internalDefinitions = JSON.parse(data.internalDefinitions);
		const externalDefinitions = JSON.parse(data.externalDefinitions);
		const containerData = data.containerData;
		const entityData = data.entityData;
		const areColumnConstraintsAvailable = getIsConstraintAvailable(data);
		const isPkOrFkConstraintAvailable = getIsPkOrFkConstraintAvailable(data);

		if (data.isUpdateScript) {
			const definitions = [modelDefinitions, internalDefinitions, externalDefinitions];
			const scripts = getAlterScript(jsonSchema, definitions, data, app);
			callback(null, scripts);
			return;
		}

		callback(
			null,
			buildScript(
				getDatabaseStatement(containerData),
				getTableStatement(
					containerData,
					entityData,
					jsonSchema,
					[modelDefinitions, internalDefinitions, externalDefinitions],
					null,
					areColumnConstraintsAvailable,
					isPkOrFkConstraintAvailable,
				),
				getIndexes(
					containerData,
					entityData,
					jsonSchema,
					[modelDefinitions, internalDefinitions, externalDefinitions],
					areColumnConstraintsAvailable,
				),
			),
		);
	} catch (e) {
		logger.log('error', { message: e.message, stack: e.stack }, 'Hive Forward-Engineering Error');

		setTimeout(() => {
			callback({ message: e.message, stack: e.stack });
		}, 150);
	}
};

module.exports = {
	generateScript,
};
