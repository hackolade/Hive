const _ = require('lodash');
const schemaHelper = require('./jsonSchemaHelper');
const { getName, getTab, commentDeactivatedStatements, replaceSpaceWithUnderscore } = require('./generalHelper');

const getIdToNameHashTable = (
	relationships,
	entities,
	jsonSchemas,
	internalDefinitions,
	otherDefinitions,
	relatedSchemas,
) => {
	const entitiesForHashing = entities
		.concat(Object.keys(relatedSchemas))
		.filter(entityId =>
			relationships.find(
				relationship => relationship.childCollection === entityId || relationship.parentCollection === entityId,
			),
		);

	return entitiesForHashing.reduce((hashTable, entityId) => {
		return {
			...hashTable,
			...schemaHelper.getIdToNameHashTable(
				[
					jsonSchemas[entityId] ?? relatedSchemas[entityId],
					internalDefinitions[entityId],
					...otherDefinitions,
				].filter(Boolean),
			),
		};
	}, {});
};

const getForeignKeyHashTable = ({
	relationships,
	entities,
	entityData,
	jsonSchemas,
	internalDefinitions,
	otherDefinitions,
	isContainerActivated,
	relatedSchemas,
}) => {
	const idToNameHashTable = getIdToNameHashTable(
		relationships,
		entities,
		jsonSchemas,
		internalDefinitions,
		otherDefinitions,
		relatedSchemas,
	);

	return relationships.reduce((hashTable, relationship) => {
		if (!hashTable[relationship.childCollection]) {
			hashTable[relationship.childCollection] = {};
		}

		const constraintName = relationship.name;
		const parentDifferentSchemaName =
			replaceSpaceWithUnderscore(relatedSchemas[relationship.parentCollection]?.bucketName) || '';
		const parentTableData = getTab(0, entityData[relationship.parentCollection]);
		const parentTableSingleName =
			replaceSpaceWithUnderscore(
				getName(parentTableData) || relatedSchemas[relationship.parentCollection].collectionName,
			) || '';
		const parentTableName = parentDifferentSchemaName
			? `${parentDifferentSchemaName}.${parentTableSingleName}`
			: parentTableSingleName;
		const childTableData = getTab(0, entityData[relationship.childCollection]);
		const childTableName =
			replaceSpaceWithUnderscore(
				getName(childTableData) || relatedSchemas[relationship.childCollection].collectionName,
			) || '';
		const groupKey = parentTableName + constraintName;
		const childFieldActivated = relationship.childField.reduce((isActivated, field) => {
			const fieldData = schemaHelper.getItemByPath(
				field.slice(1),
				jsonSchemas[relationship.childCollection] ?? relatedSchemas[relationship.childCollection],
			);
			return isActivated && _.get(fieldData, 'isActivated');
		}, true);
		const parentFieldActivated = relationship.parentField.reduce((isActivated, field) => {
			const fieldData = schemaHelper.getItemByPath(
				field.slice(1),
				jsonSchemas[relationship.parentCollection] ?? relatedSchemas[relationship.parentCollection],
			);
			return isActivated && _.get(fieldData, 'isActivated');
		}, true);

		if (!hashTable[relationship.childCollection][groupKey]) {
			hashTable[relationship.childCollection][groupKey] = [];
		}
		const disableNoValidate = relationship?.customProperties?.disableNoValidate;

		hashTable[relationship.childCollection][groupKey].push({
			name: relationship.name,
			disableNoValidate: disableNoValidate,
			parentTableName: parentTableName,
			childTableName: childTableName,
			parentColumn: getPreparedForeignColumns(relationship.parentField, idToNameHashTable),
			childColumn: getPreparedForeignColumns(relationship.childField, idToNameHashTable),
			isActivated:
				isContainerActivated &&
				_.get(parentTableData, 'isActivated') &&
				_.get(childTableData, 'isActivated') &&
				childFieldActivated &&
				parentFieldActivated,
		});

		return hashTable;
	}, {});
};

const getForeignKeyStatementsByHashItem = hashItem => {
	return Object.keys(hashItem || {})
		.map(groupKey => {
			const keys = hashItem[groupKey];
			const firstKey = keys[0] || {};
			const keyName = firstKey.name || '';
			const constraintName = keyName.includes(' ') ? `\`${keyName}\`` : keyName;
			const parentTableName = firstKey.parentTableName;
			const childTableName = firstKey.childTableName;
			const disableNoValidate = keys.some(item => item?.disableNoValidate);
			const childColumns = keys.map(item => item.childColumn).join(', ');
			const parentColumns = keys.map(item => item.parentColumn).join(', ');
			const isActivated = firstKey.isActivated;

			const statement = `ALTER TABLE ${childTableName} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${childColumns}) REFERENCES ${parentTableName}(${parentColumns}) ${disableNoValidate ? 'DISABLE NOVALIDATE' : ''};`;

			return commentDeactivatedStatements(statement, isActivated);
		})
		.join('\n');
};

const getPreparedForeignColumns = (columnsPaths, idToNameHashTable) => {
	if (columnsPaths.length > 0 && Array.isArray(columnsPaths[0])) {
		return columnsPaths
			.map(path => schemaHelper.getNameByPath(idToNameHashTable, (path || []).slice(1)))
			.join(', ');
	} else {
		return schemaHelper.getNameByPath(idToNameHashTable, (columnsPaths || []).slice(1));
	}
};

const getForeignKeys = (data, foreignKeyHashTable, areForeignPrimaryKeyConstraintsAvailable) => {
	if (!areForeignPrimaryKeyConstraintsAvailable) {
		return null;
	}

	const dbName = replaceSpaceWithUnderscore(getName(getTab(0, data.containerData)));

	const foreignKeysStatements = data.entities
		.reduce((result, entityId) => {
			const foreignKeyStatement = getForeignKeyStatementsByHashItem(foreignKeyHashTable[entityId] || {});

			if (foreignKeyStatement) {
				return [...result, foreignKeyStatement];
			}

			return result;
		}, [])
		.join('\n');

	return foreignKeysStatements ? `\nUSE ${dbName};${foreignKeysStatements}` : '';
};

module.exports = {
	getForeignKeyHashTable,
	getForeignKeys,
};
