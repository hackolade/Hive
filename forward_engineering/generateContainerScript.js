const _ = require('lodash');
const sqlFormatter = require('sql-formatter');
const foreignKeyHelper = require('./helpers/foreignKeyHelper');
const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getAlterScript } = require('./helpers/alterScriptFromDeltaHelper');
const { getViewScript } = require('./helpers/viewHelper');
const { getTableStatement } = require('./helpers/tableHelper');
const { getIndexes } = require('./helpers/indexHelper');
const { buildScript } = require('./helpers/buildScript');
const { parseEntities } = require('./helpers/parseEntities');
const { getWorkloadManagementStatements } = require('./helpers/getWorkloadManagementStatements');
const { getIsPkOrFkConstraintAvailable } = require('./helpers/constraintHelper');

const generateContainerScript = (data, logger, callback, app) => {
	try {
		const containerData = data.containerData;
		const modelDefinitions = JSON.parse(data.modelDefinitions);
		const externalDefinitions = JSON.parse(data.externalDefinitions);
		const workloadManagementStatements = getWorkloadManagementStatements(data.modelData);
		const databaseStatement = getDatabaseStatement(containerData);
		const jsonSchema = parseEntities(data.entities, data.jsonSchema);
		const internalDefinitions = parseEntities(
			data.entities.concat(data.relatedEntities ?? []),
			data.internalDefinitions,
		);
		const relatedSchemas = parseEntities(data.relatedEntities ?? [], data.relatedSchemas);
		const areColumnConstraintsAvailable = data.modelData[0].dbVersion.startsWith('3');
		const isPkOrFkConstraintAvailable = getIsPkOrFkConstraintAvailable(data);
		const needMinify = _.get(data, 'options.additionalOptions', []).find(option => option.id === 'minify')?.value;

		if (data.isUpdateScript) {
			const deltaModelSchema = _.first(Object.values(jsonSchema)) || {};
			const definitions = [modelDefinitions, internalDefinitions, externalDefinitions];
			const scripts = getAlterScript(deltaModelSchema, definitions, data, app, needMinify, sqlFormatter);
			callback(null, scripts);
			return;
		}

		const viewsScripts = data.views.map(viewId => {
			const viewSchema = JSON.parse(data.jsonSchema[viewId] || '{}');

			return getViewScript({
				schema: viewSchema,
				viewData: data.viewData[viewId],
				containerData: data.containerData,
				collectionRefsDefinitionsMap: data.collectionRefsDefinitionsMap,
				isKeyspaceActivated: true,
			});
		});

		const foreignKeyHashTable = foreignKeyHelper.getForeignKeyHashTable({
			relationships: data.relationships,
			entities: data.entities,
			entityData: data.entityData,
			jsonSchemas: jsonSchema,
			internalDefinitions: internalDefinitions,
			otherDefinitions: [modelDefinitions, externalDefinitions],
			isContainerActivated: containerData[0]?.isActivated,
			relatedSchemas: relatedSchemas,
		});

		const entities = data.entities.reduce((result, entityId) => {
			const foreignKeys = foreignKeyHelper.getForeignKeyStatementsByHashItem(foreignKeyHashTable[entityId] || {});

			const args = [
				containerData,
				data.entityData[entityId],
				jsonSchema[entityId],
				[internalDefinitions[entityId], modelDefinitions, externalDefinitions],
			];

			return result.concat([
				getTableStatement(...args, foreignKeys, areColumnConstraintsAvailable, isPkOrFkConstraintAvailable),
				getIndexes(...args, areColumnConstraintsAvailable),
			]);
		}, []);

		callback(
			null,
			buildScript(needMinify)(...workloadManagementStatements, databaseStatement, ...entities, ...viewsScripts),
		);
	} catch (e) {
		logger.log('error', { message: e.message, stack: e.stack }, 'Hive Forward-Engineering Error');

		setTimeout(() => {
			callback({ message: e.message, stack: e.stack });
		}, 150);
	}
};

module.exports = {
	generateContainerScript,
};
