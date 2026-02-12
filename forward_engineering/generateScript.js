const _ = require('lodash');
const { getAlterScript } = require('./helpers/alterScriptFromDeltaHelper');
const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getTableStatement } = require('./helpers/tableHelper');
const { getIndexes } = require('./helpers/indexHelper');
const { buildScript } = require('./helpers/buildScript');
const { getIsPkOrFkConstraintAvailable, getIsConstraintAvailable } = require('./helpers/constraintHelper');
const { setMinify } = require('./helpers/generalHelper');
const { getForeignKeyStatementsByHashItem } = require('./helpers/foreignKeyHelper');
const { parseEntities } = require('./helpers/parseEntities');
const foreignKeyHelper = require('./helpers/foreignKeyHelper');

const getForeignKeyStatements = ({
	jsonSchema,
	entityData,
	modelDefinitions,
	internalDefinitions,
	externalDefinitions,
	relatedCollectionsJsonSchema = [],
	relationships = [],
}) => {
	if (!relationships.length || !relatedCollectionsJsonSchema.length) {
		return null;
	}

	const parsedEntitiesById = relatedCollectionsJsonSchema.reduce((result, schema) => {
		const data = JSON.parse(schema);
		result[data.GUID] = data;
		return result;
	}, {});

	const foreignKeyHashTable = foreignKeyHelper.getForeignKeyHashTable({
		relationships,
		entities: Object.keys(parsedEntitiesById),
		entityData: {
			[jsonSchema.GUID]: entityData,
		},
		jsonSchemas: parsedEntitiesById,
		modelDefinitions,
		internalDefinitions,
		otherDefinitions: [modelDefinitions, externalDefinitions],
		isContainerActivated: true,
		relatedSchemas: {},
	});

	return foreignKeyHashTable[jsonSchema.GUID]
		? foreignKeyHelper.getForeignKeyStatementsByHashItem(foreignKeyHashTable[jsonSchema.GUID])
		: null;
};

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
		const needMinify = _.get(data, 'options.additionalOptions', []).find(option => option.id === 'minify')?.value;
		setMinify(needMinify);

		if (data.isUpdateScript) {
			const definitions = [modelDefinitions, internalDefinitions, externalDefinitions];
			const scripts = getAlterScript(jsonSchema, definitions, data, app);
			callback(null, scripts);
			return;
		}

		const foreignKeys = getForeignKeyStatements({
			jsonSchema,
			entityData,
			modelDefinitions,
			internalDefinitions,
			externalDefinitions,
			relatedCollectionsJsonSchema: data.relatedCollectionsJsonSchema,
			relationships: data.modelData.find(modelData => 'relationships' in modelData)?.relationships,
		});

		callback(
			null,
			buildScript(
				getDatabaseStatement(containerData),
				getTableStatement(
					containerData,
					entityData,
					jsonSchema,
					[modelDefinitions, internalDefinitions, externalDefinitions],
					foreignKeys,
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
