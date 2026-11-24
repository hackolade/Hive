const _ = require('lodash');
const { prepareName, commentDeactivatedStatements, commentDeactivatedInlineKeys } = require('../generalHelper');
const templates = require('./config/templates');
const {
	generateFullEntityName,
	getDefaultConstraintName,
	isCollectionInDeltaModelActivated,
} = require('./generalHelper');
const { CONSTRAINT_POSTFIX } = require('../constants');

const getCompositeColumns = (collection, compositeKey = []) => {
	return compositeKey
		.map(compositeEntry => {
			const property = _.toPairs(collection?.role?.properties).find(
				([, jsonSchema]) => jsonSchema.GUID === compositeEntry.keyId,
			);
			if (!property) {
				return;
			}

			return {
				name: prepareName(property[0]),
				isActivated: property[1].isActivated !== false,
			};
		})
		.filter(Boolean);
};

const didCompositeUkChange = collection => {
	const pkDto = collection?.role?.compMod?.uniqueKey || {};
	const newUniqueKeys = pkDto.new || [];
	const oldUniqueKeys = pkDto.old || [];
	if (newUniqueKeys.length !== oldUniqueKeys.length) {
		return true;
	}
	if (newUniqueKeys.length === 0 && oldUniqueKeys.length === 0) {
		return false;
	}

	return !_.isEmpty(_.differenceWith(oldUniqueKeys, newUniqueKeys, _.isEqual));
};

const getDropCompositeUkScripts = ({ collection, provider }) => {
	const didUkChange = didCompositeUkChange(collection);

	if (!didUkChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const pkDto = collection?.role?.compMod?.uniqueKey || {};
	const oldUniqueKeys = pkDto.old || [];
	const isActivated = isCollectionInDeltaModelActivated(collection);

	return oldUniqueKeys.map(oldUk => {
		const ukConstraintName =
			oldUk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });
		const constraintName = prepareName(ukConstraintName);
		const statement = provider.assignTemplates(templates.dropConstraint, {
			tableName,
			constraintName,
		});

		return commentDeactivatedStatements(statement, isActivated);
	});
};

const getAddCompositeUkScripts = ({ collection, provider }) => {
	const didUkChange = didCompositeUkChange(collection);

	if (!didUkChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const pkDto = collection?.role?.compMod?.uniqueKey || {};
	const newUniqueKeys = pkDto.new || [];
	const isCollectionActivated = isCollectionInDeltaModelActivated(collection);

	return newUniqueKeys.map(newUk => {
		const columns = getCompositeColumns(collection, newUk.compositeUniqueKey);
		const deactivatedColumnNames = new Set(
			columns.filter(column => !column.isActivated).map(column => column.name),
		);
		const { isAllKeysDeactivated, keysString } = commentDeactivatedInlineKeys(
			columns.map(column => column.name),
			deactivatedColumnNames,
		);
		const isActivated = isCollectionActivated && columns.length > 0 && !isAllKeysDeactivated;
		const columnNames = isActivated ? keysString : columns.map(column => column.name).join(', ');
		const ukConstraintName =
			newUk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });
		const constraintName = prepareName(ukConstraintName);
		const noValidate = newUk.noValidateSpecification ? ` ${newUk.noValidateSpecification}` : '';
		const rely = newUk.rely ? ` ${newUk.rely}` : '';
		const statement = provider.assignTemplates(templates.addUkConstraint, {
			tableName,
			constraintName,
			columnNames,
			noValidate,
			rely,
		});

		return commentDeactivatedStatements(statement, isActivated);
	});
};

const getModifyCompositeUkScripts = ({ collection, provider }) => {
	const dropCompositeUkScripts = getDropCompositeUkScripts({ collection, provider });
	const addCompositeUkScripts = getAddCompositeUkScripts({ collection, provider });

	return [...dropCompositeUkScripts, ...addCompositeUkScripts];
};

const getDropUkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });

	return _.toPairs(collection.properties)
		.filter(([, jsonSchema]) => {
			const oldName = jsonSchema.compMod.oldField.name;
			const oldJsonSchema = collection.role.properties[oldName];
			const wasTheFieldARegularUniqueKey = oldJsonSchema?.unique && !oldJsonSchema?.compositeUniqueKey;

			const isNotAUniqueKey = !jsonSchema.unique && !jsonSchema.compositeUniqueKey;
			return wasTheFieldARegularUniqueKey && isNotAUniqueKey;
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

const getAddUkScripts = ({ collection, provider }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });

	return _.toPairs(collection.properties)
		.filter(([, jsonSchema]) => {
			const isRegularUniqueKey = jsonSchema.unique && !jsonSchema.compositeUniqueKey;
			const oldName = jsonSchema.compMod.oldField.name;
			const wasTheFieldAUniqueKey = Boolean(collection.role.properties[oldName]?.unique);
			return isRegularUniqueKey && !wasTheFieldAUniqueKey;
		})
		.map(([name, jsonSchema]) => {
			const columnNames = [prepareName(name)];
			const noValidate = jsonSchema.noValidateSpecification ? ` ${jsonSchema.noValidateSpecification}` : '';
			const rely = jsonSchema.rely ? ` ${jsonSchema.rely}` : '';

			const statement = provider.assignTemplates(templates.addUkConstraint, {
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

const getModifyUkScripts = ({ collection, provider }) => {
	const dropUkScripts = getDropUkScripts({ collection, provider });
	const addUkScripts = getAddUkScripts({ collection, provider });

	return [...dropUkScripts, ...addUkScripts];
};

const getModifyUkConstraintsScripts = ({ collection, provider }) => {
	const modifyCompositeUkScripts = getModifyCompositeUkScripts({ collection, provider });
	const modifyUkScripts = getModifyUkScripts({ collection, provider });

	return [...modifyCompositeUkScripts, ...modifyUkScripts];
};

module.exports = {
	getModifyUkConstraintsScripts,
	getCompositeColumns,
};
