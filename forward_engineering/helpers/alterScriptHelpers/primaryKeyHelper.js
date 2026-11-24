const _ = require('lodash');
const { prepareName, commentDeactivatedStatements, commentDeactivatedInlineKeys } = require('../generalHelper');
const templates = require('./config/templates');
const {
	generateFullEntityName,
	getDefaultConstraintName,
	isCollectionInDeltaModelActivated,
} = require('./generalHelper');
const { CONSTRAINT_POSTFIX } = require('../constants');
const { getCompositeColumns } = require('./uniqueKeyHelper');

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
	const isActivated = isCollectionInDeltaModelActivated(collection);

	return oldPrimaryKeys.map(oldPk => {
		const pkConstraintName =
			oldPk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.primaryKey });
		const constraintName = prepareName(pkConstraintName);
		const statement = provider.assignTemplates(templates.dropConstraint, {
			tableName,
			constraintName,
		});

		return commentDeactivatedStatements(statement, isActivated);
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
	const isCollectionActivated = isCollectionInDeltaModelActivated(collection);

	return newPrimaryKeys.map(newPk => {
		const columns = getCompositeColumns(collection, newPk.compositePrimaryKey);
		const deactivatedColumnNames = new Set(
			columns.filter(column => !column.isActivated).map(column => column.name),
		);
		const { isAllKeysDeactivated, keysString } = commentDeactivatedInlineKeys(
			columns.map(column => column.name),
			deactivatedColumnNames,
		);
		const isActivated = isCollectionActivated && columns.length > 0 && !isAllKeysDeactivated;
		const columnNames = isActivated ? keysString : columns.map(column => column.name).join(', ');
		const pkConstraintName =
			newPk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.primaryKey });
		const constraintName = prepareName(pkConstraintName);
		const noValidate = newPk.noValidateSpecification ? ` ${newPk.noValidateSpecification}` : '';
		const rely = newPk.rely ? ` ${newPk.rely}` : '';
		const statement = provider.assignTemplates(templates.addPkConstraint, {
			tableName,
			constraintName,
			columnNames,
			noValidate,
			rely,
		});

		return commentDeactivatedStatements(statement, isActivated);
	});
};

const getModifyCompositePkScripts = ({ collection, provider }) => {
	const dropCompositePkScripts = getDropCompositePkScripts({ collection, provider });
	const addCompositePkScripts = getAddCompositePkScripts({ collection, provider });

	return [...dropCompositePkScripts, ...addCompositePkScripts];
};

const getDropPkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.primaryKey });

	return _.toPairs(collection.properties)
		.filter(([, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const oldJsonSchema = collection.role.properties[oldName];
			const wasTheFieldARegularPrimaryKey = oldJsonSchema?.primaryKey && !oldJsonSchema?.compositePrimaryKey;

			const isNotAPrimaryKey = !jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
			return wasTheFieldARegularPrimaryKey && isNotAPrimaryKey;
		})
		.map(([, jsonSchema]) => {
			const statement = provider.assignTemplates(templates.dropConstraint, {
				tableName,
				constraintName,
			});
			const isActivated = isCollectionInDeltaModelActivated(collection) && jsonSchema.isActivated !== false;
			return commentDeactivatedStatements(statement, isActivated);
		});
};

const getAddPkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.primaryKey });

	return _.toPairs(collection.properties)
		.filter(([, jsonSchema]) => {
			const isRegularPrimaryKey = jsonSchema.primaryKey && !jsonSchema.compositePrimaryKey;
			const oldName = jsonSchema.compMod.oldField.name;
			const wasTheFieldAPrimaryKey = Boolean(collection.role.properties[oldName]?.primaryKey);
			return isRegularPrimaryKey && !wasTheFieldAPrimaryKey;
		})
		.map(([name, jsonSchema]) => {
			const columnNames = [prepareName(name)];
			const noValidate = jsonSchema.noValidateSpecification ? ` ${jsonSchema.noValidateSpecification}` : '';
			const rely = jsonSchema.rely ? ` ${jsonSchema.rely}` : '';

			const statement = provider.assignTemplates(templates.addPkConstraint, {
				tableName,
				constraintName,
				columnNames,
				noValidate,
				rely,
			});
			const isActivated = isCollectionInDeltaModelActivated(collection) && jsonSchema.isActivated !== false;
			return commentDeactivatedStatements(statement, isActivated);
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

	return [...modifyCompositePkScripts, ...modifyPkScripts];
};

module.exports = {
	getModifyPkConstraintsScripts,
};
