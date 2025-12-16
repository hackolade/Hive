const _ = require('lodash');
const { getName, prepareName, commentDeactivatedStatements } = require('../generalHelper');
const templates = require('./config/templates');
const { generateFullEntityName, getDefaultConstraintName } = require('./generalHelper');

const postfix = 'pk';

const getPropertyNameByGuid = (collection, guid) => {
	const property = _.toPairs(collection?.role?.properties).find(([name, jsonSchema]) => jsonSchema.GUID === guid);
	return property?.[0] && prepareName(property[0]);
};

const getPropertiesNamesByGUIDs = (collection, guids) => {
	return guids.map(guid => getPropertyNameByGuid(collection, guid)).filter(Boolean);
};

const didCompositePkChange = collection => {
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];
	const oldPrimaryKeys = pkDto.old || [];
	if (newPrimaryKeys.length !== oldPrimaryKeys.length) {
		return true;
	}
	if (newPrimaryKeys.length === 0 && oldPrimaryKeys.length === 0) {
		return false;
	}

	return !_.isEmpty(_.differenceWith(oldPrimaryKeys, newPrimaryKeys, _.isEqual));
};

const getDropCompositePkScripts = ({ collection, provider }) => {
	const didPkChange = didCompositePkChange(collection);

	if (!didPkChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const oldPrimaryKeys = pkDto.old || [];

	return oldPrimaryKeys.map(oldPk => {
		const pkConstraintName = oldPk.constraintName || getDefaultConstraintName(collection, postfix);
		const constraintName = prepareName(pkConstraintName);

		return provider.assignTemplates(templates.dropConstraint, {
			tableName,
			constraintName,
		});
	});
};

const getAddCompositePkScripts = ({ collection, provider }) => {
	const didPkChange = didCompositePkChange(collection);

	if (!didPkChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const pkDto = collection?.role?.compMod?.primaryKey || {};
	const newPrimaryKeys = pkDto.new || [];

	return newPrimaryKeys.map(newPk => {
		const compositePrimaryKey = newPk.compositePrimaryKey || [];
		const guidsOfColumnsInPk = compositePrimaryKey.map(compositePkEntry => compositePkEntry.keyId);
		const columnNames = getPropertiesNamesByGUIDs(collection, guidsOfColumnsInPk);
		const pkConstraintName = newPk.constraintName || getDefaultConstraintName(collection, postfix);
		const constraintName = prepareName(pkConstraintName);
		const noValidate = newPk.noValidateSpecification ? ` ${newPk.noValidateSpecification}` : '';
		const rely = newPk.rely ? ` ${newPk.rely}` : '';

		return provider.assignTemplates(templates.addPkConstraint, {
			tableName,
			constraintName,
			columnNames,
			noValidate,
			rely,
		});
	});
};

const getModifyCompositePkScripts = ({ collection, provider }) => {
	const dropCompositePkScripts = getDropCompositePkScripts({ collection, provider });
	const addCompositePkScripts = getAddCompositePkScripts({ collection, provider });

	return [...dropCompositePkScripts, ...addCompositePkScripts];
};

const getDropPkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName(collection, postfix);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const oldJsonSchema = collection.role.properties[oldName];
			const wasTheFieldARegularPrimaryKey = oldJsonSchema?.primaryKey && !oldJsonSchema?.compositePrimaryKey;

			const isNotAPrimaryKey = !jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
			return wasTheFieldARegularPrimaryKey && isNotAPrimaryKey;
		})
		.map(([name, jsonSchema]) => {
			return provider.assignTemplates(templates.dropConstraint, {
				tableName,
				constraintName,
			});
		});
};

const getAddPkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName(collection, postfix);

	return _.toPairs(collection.properties)
		.filter(([name, jsonSchema]) => {
			const isRegularPrimaryKey = jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
			const oldName = jsonSchema.compMod.oldField.name;
			const wasTheFieldAPrimaryKey = Boolean(collection.role.properties[oldName]?.primaryKey);
			return isRegularPrimaryKey && !wasTheFieldAPrimaryKey;
		})
		.map(([name, jsonSchema]) => {
			const columnNames = [prepareName(name)];
			const noValidate = jsonSchema.noValidateSpecification ? ` ${jsonSchema.noValidateSpecification}` : '';
			const rely = jsonSchema.rely ? ` ${jsonSchema.rely}` : '';

			return provider.assignTemplates(templates.addPkConstraint, {
				tableName,
				constraintName,
				columnNames,
				noValidate,
				rely,
			});
		});
};

const getModifyPkScripts = ({ collection, provider }) => {
	const dropPkScripts = getDropPkScripts({ collection, provider });
	const addPkScripts = getAddPkScripts({ collection, provider });

	return [...dropPkScripts, ...addPkScripts];
};

const getModifyPkConstraintsScripts = ({ collection, provider }) => {
	const modifyCompositePkScripts = getModifyCompositePkScripts({ collection, provider });
	const modifyPkScripts = getModifyPkScripts({ collection, provider });
	const isActivated = collection.role.isActivated;

	return [...modifyCompositePkScripts, ...modifyPkScripts].map(statement =>
		commentDeactivatedStatements(statement, isActivated),
	);
};

module.exports = {
	getModifyPkConstraintsScripts,
};
