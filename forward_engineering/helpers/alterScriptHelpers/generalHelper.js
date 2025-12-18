const _ = require('lodash');
const { getName, prepareName } = require('../generalHelper');

const getContainerName = compMod => compMod.keyspaceName;

const getEntityData = (object, properties = [], type = 'new') =>
	properties.reduce((transformObject, property) => {
		const value = object[property]?.[type];
		return {
			...transformObject,
			...(value ? { [property]: value } : {}),
		};
	}, {});

const getFullEntityName = (dbName, entityName) => (dbName ? `${dbName}.${entityName}` : entityName);

const generateFullEntityName = entity => {
	const compMod = _.get(entity, 'role.compMod', {});
	const entityData = _.get(entity, 'role', {});
	const dbName = prepareName(getContainerName(compMod));
	const entityName = prepareName(getName(entityData));
	return getFullEntityName(dbName, entityName);
};

const getEntityProperties = entity => {
	const propertiesInRole = _.get(entity, 'role.properties', {});
	const propertiesInEntity = _.get(entity, 'properties', {});
	return { ...propertiesInEntity, ...propertiesInRole };
};

const getEntityName = (compMod = {}, type = 'collectionName') => {
	return {
		oldName: prepareName(compMod.code?.old || compMod[type]?.old),
		newName: prepareName(compMod.code?.new || compMod[type]?.new),
	};
};

const prepareScript = (...scripts) => scripts.filter(Boolean);

const isEqualProperty = (compMod, nameProperty) => {
	const { new: newProperty, old: oldProperty } = _.get(compMod, nameProperty, {});
	return _.isEqual(newProperty, oldProperty);
};

const hydrateProperty = (entity, compMod, nameProperty) => {
	return isEqualProperty(compMod, nameProperty) ? null : entity?.role?.[nameProperty];
};

const getDefaultConstraintName = ({ collection, column = {}, postfix }) => {
	const entityData = collection?.role || collection || {};
	const entityName = getName(entityData);
	const columnName = getName(column);
	return prepareName([entityName, columnName, postfix].filter(Boolean).join('_'));
};

module.exports = {
	getEntityData,
	getFullEntityName,
	generateFullEntityName,
	getEntityProperties,
	getContainerName,
	getEntityName,
	prepareScript,
	isEqualProperty,
	hydrateProperty,
	getDefaultConstraintName,
};
