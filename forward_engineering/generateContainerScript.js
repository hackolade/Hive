const _ = require('lodash');
const foreignKeyHelper = require('./helpers/foreignKeyHelper');
const { getDatabaseStatement } = require('./helpers/databaseHelper');
const { getAlterScript } = require('./helpers/alterScriptFromDeltaHelper');
const { getViewScript } = require('./helpers/viewHelper');
const { getTableStatement } = require('./helpers/tableHelper');
const { getIndexes } = require('./helpers/indexHelper');
const { buildScript } = require('./helpers/buildScript');
const { parseEntities } = require('./helpers/parseEntities');
const { getWorkloadManagementStatements } = require('./helpers/getWorkloadManagementStatements');
const { getIsPkOrFkConstraintAvailable, getIsConstraintAvailable } = require('./helpers/constraintHelper');
const { setMinify } = require('./helpers/generalHelper');

const sortEntitiesByForeignKeyDependencies = ({ entities, relationships }) => {
	const entitySet = new Set(entities);
	const childrenMap = new Map();
	const inDegree = new Map();

	entities.forEach(entityId => {
		inDegree.set(entityId, 0);
		childrenMap.set(entityId, []);
	});

	relationships.forEach(relationship => {
		const { parentCollection, childCollection } = relationship;
		if (entitySet.has(parentCollection) && entitySet.has(childCollection) && parentCollection !== childCollection) {
			childrenMap.get(parentCollection).push(childCollection);
			inDegree.set(childCollection, (inDegree.get(childCollection) || 0) + 1);
		}
	});

	const queue = entities.filter(entityId => (inDegree.get(entityId) || 0) === 0);
	const sorted = [];

	while (queue.length > 0) {
		const current = queue.shift();
		sorted.push(current);

		childrenMap.get(current).forEach(child => {
			const newDegree = (inDegree.get(child) || 0) - 1;
			inDegree.set(child, newDegree);
			if (newDegree === 0) {
				queue.push(child);
			}
		});
	}

	const remaining = entities.filter(entityId => !sorted.includes(entityId));
	return sorted.concat(remaining);
};

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
		const areColumnConstraintsAvailable = getIsConstraintAvailable(data);
		const isPkOrFkConstraintAvailable = getIsPkOrFkConstraintAvailable(data);
		const needMinify = _.get(data, 'options.additionalOptions', []).find(option => option.id === 'minify')?.value;
		setMinify(needMinify);

		if (data.isUpdateScript) {
			const deltaModelSchema = _.first(Object.values(jsonSchema)) || {};
			const definitions = [modelDefinitions, internalDefinitions, externalDefinitions];
			const scripts = getAlterScript(deltaModelSchema, definitions, data, app);
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

		const sortedEntities = sortEntitiesByForeignKeyDependencies({
			entities: data.entities,
			relationships: data.relationships,
		});

		const entities = sortedEntities.reduce((result, entityId) => {
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

		callback(null, buildScript(...workloadManagementStatements, databaseStatement, ...entities, ...viewsScripts));
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
