const _ = require('lodash');
const { getColumns, getColumnsStatement, getTypeByProperty } = require('../columnHelper');
const { getIndexes } = require('../indexHelper');
const { getTableStatement } = require('../tableHelper');
const { hydrateTableProperties, getDifferentItems, getIsChangeProperties } = require('./common');
const {
	getFullEntityName,
	generateFullEntityName,
	getEntityProperties,
	getContainerName,
	getEntityData,
	getEntityName,
	prepareScript,
	hydrateProperty,
} = require('./generalHelper');
const { hydrateKeys } = require('./tableKeysHelper');
const { replaceSpaceWithUnderscore } = require('../generalHelper');
const { getModifyPkConstraintsScripts } = require('./primaryKeyHelper');
const { getIsPkOrFkConstraintAvailable, getIsConstraintAvailable } = require('../constraintHelper');
const { getModifyUkConstraintsScripts } = require('./uniqueKeyHelper');

const tableProperties = [
	'compositePartitionKey',
	'storedAsTable',
	'fieldsTerminatedBy',
	'fieldsescapedBy',
	'collectionItemsTerminatedBy',
	'mapKeysTerminatedBy',
	'linesTerminatedBy',
	'nullDefinedAs',
	'inputFormatClassname',
	'outputFormatClassname',
];
const otherTableProperties = [
	'code',
	'collectionName',
	'tableProperties',
	'sortedByKey',
	'numBuckets',
	'skewedby',
	'skewedOn',
	'skewStoredAsDir',
	'compositeClusteringKey',
	'description',
	'properties',
	'location',
];

const hydrateSerDeProperties = (compMod, name) => {
	const { serDeProperties, serDeLibrary } = compMod;
	return {
		properties: hydrateTableProperties(serDeProperties || {}, name),
		serDe: !_.isEqual(serDeLibrary?.new, serDeLibrary?.old) && serDeLibrary?.new,
		name,
	};
};

const hydrateAlterTableName = compMod => {
	const { newName, oldName } = getEntityName(compMod);
	if ((!newName && !oldName) || newName === oldName) {
		return {};
	}
	return {
		oldName: getFullEntityName(getContainerName(compMod), oldName),
		newName: getFullEntityName(getContainerName(compMod), newName),
	};
};

const hydrateAlterTable = (collection, fullCollectionName, definition) => {
	const compMod = _.get(collection, 'role.compMod', {});
	const dataProperties = _.get(compMod, 'tableProperties', '');
	const hydratedCollectionData = hydrateCollection(collection, definition);
	return {
		keys: hydrateKeys(hydratedCollectionData, collection, definition, fullCollectionName),
		location: hydrateProperty(collection, compMod, 'location'),
		alterTableName: hydrateAlterTableName(compMod),
		tableProperties: hydrateTableProperties(dataProperties, fullCollectionName, compMod?.description),
		serDeProperties: hydrateSerDeProperties(compMod, fullCollectionName),
		name: fullCollectionName,
	};
};

const hydrateAlterColumns = (entity, definitions) => {
	const collectionName = generateFullEntityName(entity);
	const columns = Object.values(entity.properties).map(property => {
		const compMod = _.get(property, 'compMod', {});
		const { newField = {}, oldField = {} } = compMod;

		const newType = getTypeByProperty(definitions)({ ...property, ...newField });
		const oldType = getTypeByProperty(definitions)({ ...property, ...oldField });

		const oldName = oldField.name;
		const newName = newField.name;

		const newComment = property.description || '';
		const oldComment = entity.role.properties[oldName]?.description || '';

		const isCommentChanged = newComment !== oldComment;
		const isColumnChanged = oldName !== newName || newType !== oldType || isCommentChanged;

		const column = isColumnChanged ? { type: newType, oldName, newName } : null;

		if (column && isCommentChanged) {
			return { ...column, comment: newComment };
		}

		return column;
	});
	return { collectionName, columns: columns.filter(Boolean) };
};

const hydrateDropIndexes = entity => {
	const indexes = _.get(entity, 'SecIndxs', []);
	const name = generateFullEntityName(entity);
	return indexes.map(index => ({ name, indexName: replaceSpaceWithUnderscore(index.name) }));
};

const hydrateAddIndexes = (entity, SecIndxs, properties, definitions) => {
	const compMod = _.get(entity, 'role.compMod', {});
	const entityData = _.get(entity, 'role', {});
	const containerData = { name: getContainerName(compMod) };
	return [[containerData], [entityData, {}, { SecIndxs }], { ...entityData, properties }, definitions];
};

const hydrateIndex = (entity, properties, definitions) => {
	const indexes = _.get(entity, 'role.compMod.SecIndxs', {});
	const { drop, add } = getDifferentItems(indexes.new, indexes.old);
	return {
		hydratedDropIndexes: hydrateDropIndexes({ ...entity, SecIndxs: drop }),
		hydratedAddIndexes: hydrateAddIndexes(entity, add, properties, definitions),
	};
};

const hydrateCollection = (entity, definitions) => {
	const compMod = _.get(entity, 'role.compMod', {});
	const entityData = _.get(entity, 'role', {});
	const properties = getEntityProperties(entity);
	const containerData = { name: getContainerName(compMod) };
	return [[containerData], [entityData], { ...entityData, properties }, definitions];
};

const generateModifyCollectionScript = (entity, definitions, provider) => {
	const compMod = _.get(entity, 'role.compMod', {});
	const isChangedProperties = getIsChangeProperties(compMod, tableProperties);
	const fullCollectionName = generateFullEntityName(entity);
	if (isChangedProperties) {
		const roleData = getEntityData(compMod, tableProperties.concat(otherTableProperties));
		const hydratedCollection = hydrateCollection({ ...entity, role: { ...entity.role, ...roleData } }, definitions);
		const addCollectionScript = getTableStatement(...hydratedCollection, null, true);
		const deleteCollectionScript = provider.dropTable(fullCollectionName);
		return { type: 'new', script: prepareScript(deleteCollectionScript, addCollectionScript) };
	}
	const hydratedAlterTable = hydrateAlterTable(entity, fullCollectionName, definitions);
	return { type: 'modified', script: provider.alterTable(hydratedAlterTable) };
};

const getAddCollectionsScripts = (definitions, data) => entity => {
	const properties = getEntityProperties(entity);
	const indexes = _.get(entity, 'role.SecIndxs', []);
	const hydratedCollection = hydrateCollection(entity, definitions);
	const isPkOrFkConstraintAvailable = getIsPkOrFkConstraintAvailable(data);
	const collectionScript = getTableStatement(...hydratedCollection, null, true, isPkOrFkConstraintAvailable);
	const indexScript = getIndexes(...hydrateAddIndexes(entity, indexes, properties, definitions));

	return prepareScript(collectionScript, indexScript);
};

const getDeleteCollectionsScripts = provider => entity => {
	const entityData = { ...entity, ..._.get(entity, 'role', {}) };
	const fullCollectionName = generateFullEntityName(entity);
	const collectionScript = provider.dropTable(fullCollectionName);
	const indexScript = provider.dropTableIndex(hydrateDropIndexes(entityData));

	return prepareScript(...indexScript, collectionScript);
};

const getModifyCollectionsScripts = (definitions, provider, data) => entity => {
	const properties = getEntityProperties(entity);
	const { script } = generateModifyCollectionScript(entity, definitions, provider);
	const { hydratedAddIndexes, hydratedDropIndexes } = hydrateIndex(entity, properties, definitions);
	const dropIndexScript = provider.dropTableIndex(hydratedDropIndexes);
	const addIndexScript = getIndexes(...hydratedAddIndexes);
	const modifyPKConstraintScripts = getIsPkOrFkConstraintAvailable(data)
		? getModifyPkConstraintsScripts({ collection: entity, provider })
		: [];
	const modifyUKConstraintScripts = getIsConstraintAvailable(data)
		? getModifyUkConstraintsScripts({ collection: entity, provider })
		: [];

	return prepareScript(
		...dropIndexScript,
		...script,
		addIndexScript,
		...modifyPKConstraintScripts,
		...modifyUKConstraintScripts,
	);
};

const getAddColumnsScripts = (definitions, provider) => entity => {
	const entityData = { ...entity, ..._.omit(entity.role, ['properties']) };
	const { columns } = getColumns(entityData, true, definitions);
	const properties = getEntityProperties(entity);
	const columnStatement = getColumnsStatement(columns, null, entityData.disableNoValidate);
	const fullCollectionName = generateFullEntityName(entity);
	const { hydratedAddIndexes, hydratedDropIndexes } = hydrateIndex(entity, properties, definitions);
	const modifyScript = generateModifyCollectionScript(entity, definitions, provider);
	const dropIndexScript = provider.dropTableIndex(hydratedDropIndexes);
	const addIndexScript = getIndexes(...hydratedAddIndexes);
	const addColumnScript = provider.addTableColumns({ name: fullCollectionName, columns: columnStatement });

	return modifyScript.type === 'new'
		? prepareScript(...dropIndexScript, ...modifyScript.script, addIndexScript)
		: prepareScript(...dropIndexScript, addColumnScript, ...modifyScript.script, addIndexScript);
};

const getDeleteColumnsScripts = (definitions, provider) => entity => {
	const deleteColumnsName = Object.keys(entity.properties || {});
	const properties = _.omit(_.get(entity, 'role.properties', {}), deleteColumnsName);
	const entityData = { role: { ..._.omit(entity.role, ['properties']), properties } };
	const { hydratedAddIndexes, hydratedDropIndexes } = hydrateIndex(entity, properties, definitions);
	const fullCollectionName = generateFullEntityName(entity);
	const dropIndexScript = provider.dropTableIndex(hydratedDropIndexes);
	const addIndexScript = getIndexes(...hydratedAddIndexes);
	const deleteCollectionScript = provider.dropTable(fullCollectionName);
	const hydratedCollection = hydrateCollection(entityData, definitions);
	const addCollectionScript = getTableStatement(...hydratedCollection, null, true);

	return prepareScript(...dropIndexScript, deleteCollectionScript, addCollectionScript, addIndexScript);
};

const getModifyColumnsScripts = (definitions, provider) => entity => {
	const properties = _.get(entity, 'properties', {});

	const hydratedAlterColumns = hydrateAlterColumns(entity, definitions);
	const alterColumnScripts = provider.alterTableColumns(hydratedAlterColumns);
	const { hydratedAddIndexes, hydratedDropIndexes } = hydrateIndex(entity, properties, definitions);
	const dropIndexScript = provider.dropTableIndex(hydratedDropIndexes);
	const addIndexScript = getIndexes(...hydratedAddIndexes);

	return prepareScript(...dropIndexScript, ...alterColumnScripts, addIndexScript);
};

module.exports = {
	getAddCollectionsScripts,
	getDeleteCollectionsScripts,
	getModifyCollectionsScripts,
	getAddColumnsScripts,
	getDeleteColumnsScripts,
	getModifyColumnsScripts,
};
