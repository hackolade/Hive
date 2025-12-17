const _ = require('lodash');
const templates = require('./config/templates');
const { generateFullEntityName, getDefaultConstraintName } = require('./generalHelper');
const { getTypeByProperty } = require('../columnHelper');
const { commentDeactivatedStatements } = require('../generalHelper');
const { CONSTRAINT_POSTFIX } = require('../constants');

const getModifyDefaultValueConstraintsScripts = ({ collection, provider, definitions }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName({ collection, postfix: CONSTRAINT_POSTFIX.default });
	const isActivated = collection.role.isActivated;

	return _.toPairs(collection.properties).flatMap(([columnName, jsonSchema]) => {
		const oldName = jsonSchema.compMod.oldField.name;
		const newField = jsonSchema.compMod.newField;

		const newDefaultValue = jsonSchema.default || '';
		const oldDefaultValue = collection.role.properties[oldName]?.default || '';

		const type = getTypeByProperty(definitions)({ ...jsonSchema, ...newField });
		const noValidate = jsonSchema.noValidateSpecification ? ` ${jsonSchema.noValidateSpecification}` : '';
		const rely = jsonSchema.rely ? ` ${jsonSchema.rely}` : '';
		const enable = jsonSchema.enableSpecification ? ` ${jsonSchema.enableSpecification}` : '';

		const scriptParams = {
			tableName,
			columnName,
			constraintName,
			type,
			enable,
			noValidate,
			rely,
		};

		const scripts = [];

		if (newDefaultValue && !oldDefaultValue) {
			scripts.push(
				provider.assignTemplates(templates.addDefaultValueConstraint, {
					...scriptParams,
					defaultValue: newDefaultValue,
				}),
			);
		}

		return scripts.map(statement => commentDeactivatedStatements(statement, isActivated));
	});
};

module.exports = {
	getModifyDefaultValueConstraintsScripts,
};
