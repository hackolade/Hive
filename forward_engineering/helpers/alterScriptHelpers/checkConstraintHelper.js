const _ = require('lodash');
const templates = require('./config/templates');
const { generateFullEntityName, getDefaultConstraintName } = require('./generalHelper');
const { getTypeByProperty } = require('../columnHelper');

const postfix = 'nn';

const didCompositeCheckConstraintsChange = collection => {
	const checkConstraintsDto = collection?.role?.compMod?.chkConstr || {};
	const newCheckConstraints = checkConstraintsDto.new || [];
	const oldCheckConstraints = checkConstraintsDto.old || [];

	if (newCheckConstraints.length !== oldCheckConstraints.length) {
		return true;
	}
	if (newCheckConstraints.length === 0 && oldCheckConstraints.length === 0) {
		return false;
	}

	return !_.isEmpty(_.differenceWith(oldCheckConstraints, newCheckConstraints, _.isEqual));
};

const getDropCompositeCheckConstraintsScripts = ({ collection, provider }) => {
	const didCheckConstraintsChange = didCompositeCheckConstraintsChange(collection);

	if (!didCheckConstraintsChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const checkConstraintsDto = collection?.role?.compMod?.chkConstr || {};
	const oldCheckConstraints = checkConstraintsDto.old || [];

	return oldCheckConstraints.map(oldCheckConstraint => {
		const constraintName = oldCheckConstraint.constraintName || getDefaultConstraintName(collection, postfix);

		return provider.assignTemplates(templates.dropConstraint, {
			tableName,
			constraintName,
		});
	});
};

const getAddCompositeCheckConstraintsScripts = ({ collection, provider }) => {
	const didCheckConstraintsChange = didCompositeCheckConstraintsChange(collection);

	if (!didCheckConstraintsChange) {
		return [];
	}

	const tableName = generateFullEntityName(collection);
	const checkConstraintsDto = collection?.role?.compMod?.chkConstr || {};
	const newCheckConstraints = checkConstraintsDto.new || [];

	return newCheckConstraints.map(newCheckConstraint => {
		const constraintName = newCheckConstraint.constraintName || getDefaultConstraintName(collection, postfix);
		const expression = newCheckConstraint.checkExpression || '';
		const enable = newCheckConstraint.enableSpecification ? ` ${newCheckConstraint.enableSpecification}` : '';
		const noValidate = newCheckConstraint.noValidateSpecification
			? ` ${newCheckConstraint.noValidateSpecification}`
			: '';
		const rely = newCheckConstraint.rely ? ` ${newCheckConstraint.rely}` : '';

		return provider.assignTemplates(templates.addCheckConstraint, {
			tableName,
			constraintName,
			expression,
			enable,
			noValidate,
			rely,
		});
	});
};

const getModifyCompositeCheckConstraintsScripts = ({ collection, provider }) => {
	const dropCompositeCheckConstraintsScripts = getDropCompositeCheckConstraintsScripts({ collection, provider });
	const addCompositeCheckConstraintsScripts = getAddCompositeCheckConstraintsScripts({ collection, provider });

	return [...dropCompositeCheckConstraintsScripts, ...addCompositeCheckConstraintsScripts];
};

const getModifyColumnCheckConstraintsScripts = ({ collection, provider, definitions }) => {
	const tableName = generateFullEntityName(collection);
	const constraintName = getDefaultConstraintName(collection, postfix);

	const addNotNullConstraintsScript = _.toPairs(collection.properties).flatMap(([columnName, jsonSchema]) => {
		const oldName = jsonSchema.compMod.oldField.name;
		const newField = jsonSchema.compMod.newField;

		const newCheckConstraint = jsonSchema.check || '';
		const oldCheckConstraint = collection.role.properties[oldName]?.check || '';

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

		if (newCheckConstraint && !oldCheckConstraint) {
			scripts.push(
				provider.assignTemplates(templates.addColumnCheckConstraint, {
					...scriptParams,
					expression: newCheckConstraint,
				}),
			);
		}

		return scripts;
	});

	return addNotNullConstraintsScript;
};

const getModifyCheckConstraintsScripts = ({ collection, provider, definitions }) => {
	const modifyColumnCheckConstraintsScripts = getModifyColumnCheckConstraintsScripts({
		collection,
		provider,
		definitions,
	});
	const modifyTableCheckConstraintsScripts = getModifyCompositeCheckConstraintsScripts({ collection, provider });

	return [...modifyColumnCheckConstraintsScripts, ...modifyTableCheckConstraintsScripts];
};

module.exports = {
	getModifyCheckConstraintsScripts,
};
