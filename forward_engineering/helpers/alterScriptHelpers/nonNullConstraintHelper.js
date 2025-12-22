const _ = require('lodash');
const templates = require('./config/templates');
const { generateFullEntityName, getDefaultConstraintName } = require('./generalHelper');
const { getTypeByProperty } = require('../columnHelper');
const { commentDeactivatedStatements, prepareName } = require('../generalHelper');
const { CONSTRAINT_POSTFIX } = require('../constants');

const getModifyNonNullColumnsScripts = ({ collection, provider, definitions }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.notNull });
	const isActivated = collection.role.isActivated;

	const currentRequiredColumnNames = collection.required || [];
	const previousRequiredColumnNames = collection.role.required || [];

	return _.toPairs(collection.properties).flatMap(([columnName, jsonSchema]) => {
		const oldName = jsonSchema.compMod.oldField.name;
		const newField = jsonSchema.compMod.newField;

		const isOldRequired = previousRequiredColumnNames.includes(oldName);
		const isNewRequired = currentRequiredColumnNames.includes(columnName);

		const type = getTypeByProperty(definitions)({ ...jsonSchema, ...newField });
		const noValidate = jsonSchema.noValidateSpecification ? ` ${jsonSchema.noValidateSpecification}` : '';
		const rely = jsonSchema.rely ? ` ${jsonSchema.rely}` : '';
		const enable = jsonSchema.enableSpecification ? ` ${jsonSchema.enableSpecification}` : '';

		const scriptParams = {
			tableName,
			columnName: prepareName(columnName),
			constraintName,
			type,
			enable,
			noValidate,
			rely,
		};

		const scripts = [];

		if (isNewRequired && !isOldRequired && !jsonSchema.primaryKey) {
			scripts.push(provider.assignTemplates(templates.addNotNullConstraint, scriptParams));
		}

		return scripts.map(statement => commentDeactivatedStatements(statement, isActivated));
	});
};

module.exports = {
	getModifyNonNullColumnsScripts,
};
