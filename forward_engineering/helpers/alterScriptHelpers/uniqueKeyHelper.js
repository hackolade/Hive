const _ = require('lodash');
const { prepareName, commentDeactivatedStatements } = require('../generalHelper');
const templates = require('./config/templates');
const { generateFullEntityName, getDefaultConstraintName } = require('./generalHelper');
const { CONSTRAINT_POSTFIX } = require('../constants');

const getPropertyNameByGuid = (collection, guid) => {
	const property = _.toPairs(collection?.role?.properties).find(([name, jsonSchema]) => jsonSchema.GUID === guid);
	return property?.[0] && prepareName(property[0]);
};

const getPropertiesNamesByGUIDs = (collection, guids) => {
	return guids.map(guid => getPropertyNameByGuid(collection, guid)).filter(Boolean);
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

	return oldUniqueKeys.map(oldUk => {
		const pkConstraintName =
			oldUk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });
		const constraintName = prepareName(pkConstraintName);

		return provider.assignTemplates(templates.dropConstraint, {
			tableName,
			constraintName,
		});
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

	return newUniqueKeys.map(newUk => {
		const compositeUniqueKey = newUk.compositeUniqueKey || [];
		const guidsOfColumnsInUk = compositeUniqueKey.map(compositeUkEntry => compositeUkEntry.keyId);
		const columnNames = getPropertiesNamesByGUIDs(collection, guidsOfColumnsInUk);
		const pkConstraintName =
			newUk.constraintName || getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.uniqueKey });
		const constraintName = prepareName(pkConstraintName);
		const noValidate = newUk.noValidateSpecification ? ` ${newUk.noValidateSpecification}` : '';
		const rely = newUk.rely ? ` ${newUk.rely}` : '';

		return provider.assignTemplates(templates.addUkConstraint, {
			tableName,
			constraintName,
			columnNames,
			noValidate,
			rely,
		});
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
		.map(() => {
			return provider.assignTemplates(templates.dropConstraint, {
				tableName,
				constraintName,
			});
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

			return provider.assignTemplates(templates.addUkConstraint, {
				tableName,
				constraintName,
				columnNames,
				noValidate,
				rely,
			});
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
	const isActivated = collection.role.isActivated;

	return [...modifyCompositeUkScripts, ...modifyUkScripts].map(statement =>
		commentDeactivatedStatements(statement, isActivated),
	);
};

module.exports = {
	getModifyUkConstraintsScripts,
};
