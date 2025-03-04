/**
 * @typedef {import('../types').ColumnDefinition} ColumnDefinition
 * @typedef {import('../types').ConstraintDto} ConstraintDto
 * @typedef {import('../types').JsonSchema} JsonSchema
 */

const findName = (keyId, properties) => {
	return Object.keys(properties).find(name => properties[name].GUID === keyId);
};

const checkIfActivated = (keyId, properties) => {
	return Object.values(properties).find(prop => prop.GUID === keyId)?.['isActivated'] || true;
};

const getKeys = (keys, jsonSchema) => {
	return (keys || []).map(key => {
		return {
			name: findName(key.keyId, jsonSchema.properties),
			isActivated: checkIfActivated(key.keyId, jsonSchema.properties),
		};
	});
};

const hydrateUniqueKeys = jsonSchema => {
	const hydrate = options => ({
		name: options['constraintName'],
		rely: options['rely'],
		noValidateSpecification: options['noValidateSpecification'],
	});

	return (jsonSchema.uniqueKey || [])
		.filter(uniqueKey => Boolean((uniqueKey.compositeUniqueKey || []).length))
		.map(uniqueKey => ({
			...hydrate(uniqueKey),
			columns: getKeys(uniqueKey.compositeUniqueKey, jsonSchema),
		}));
};

const getConstraintOpts = ({ noValidateSpecification, enableSpecification, rely }) => {
	const getPartConstraintOpts = part => (part ? ` ${part}` : '');

	if (!enableSpecification) {
		return '';
	}

	return ` ${enableSpecification}${getPartConstraintOpts(noValidateSpecification)}${getPartConstraintOpts(rely)}`;
};

const getUniqueKeyStatement = (jsonSchema, isParentItemActivated) => {
	const getStatement = ({ keys, name, constraintOptsStatement }) =>
		`CONSTRAINT ${name} UNIQUE (${keys})${constraintOptsStatement}`;
	const getColumnsName = columns => columns.map(column => column.name).join(', ');
	const hydratedUniqueKeys = hydrateUniqueKeys(jsonSchema);

	const constraintsStatement = hydratedUniqueKeys.map(uniqueKey => {
		const { columns, rely, noValidateSpecification, name } = uniqueKey;
		if (!Array.isArray(columns) || !columns.length || !name) {
			return '';
		}

		const columnsName = getColumnsName(columns);
		const constraintOptsStatement = getConstraintOpts({
			rely,
			noValidateSpecification,
			enableSpecification: 'DISABLE',
		});

		if (!isParentItemActivated) {
			return getStatement({ keys: columnsName, name, constraintOptsStatement });
		}

		const isActivatedColumnsName = getColumnsName(columns.filter(column => column.isActivated));

		if (!isActivatedColumnsName.length) {
			return '-- ' + getStatement({ keys: columnsName, name, constraintOptsStatement });
		}
		return getStatement({ keys: isActivatedColumnsName, name, constraintOptsStatement });
	});

	return constraintsStatement.filter(Boolean).join(',\n');
};

const getCheckConstraint = jsonSchema => {
	const checks = jsonSchema.chkConstr || [];
	const createCheckStatement = ({ constraintName, checkExpression, constraintOptsStatement }) =>
		`CONSTRAINT ${constraintName} CHECK ${checkExpression}${constraintOptsStatement}`;

	const checkConstraint = checks.map(check => {
		const { constraintName, rely, noValidateSpecification, enableSpecification, checkExpression } = check || {};
		const constraintOptsStatement = getConstraintOpts({ noValidateSpecification, enableSpecification, rely });
		if (!constraintName || !checkExpression) {
			return '';
		}
		return createCheckStatement({ constraintName, checkExpression, constraintOptsStatement });
	});

	return checkConstraint.filter(Boolean).join(',\n');
};

/**
 * @param {{ jsonSchema: JsonSchema }}
 * @returns {ConstraintDto[]}
 */
const getCompositePrimaryKeys = ({ jsonSchema }) => {
	if (!Array.isArray(jsonSchema.primaryKey)) {
		return [];
	}

	return jsonSchema.primaryKey
		.filter(primaryKey => primaryKey.compositePrimaryKey?.length)
		.map(primaryKey => ({
			keyType: 'PRIMARY KEY',
			name: primaryKey.constraintName,
			columns: getKeys(primaryKey.compositePrimaryKey, jsonSchema),
		}));
};

/**
 * @param {{ jsonSchema: JsonSchema }}
 * @returns {ConstraintDto[]}
 */
const getCompositeUniqueKeys = ({ jsonSchema }) => {
	if (!Array.isArray(jsonSchema.uniqueKey)) {
		return [];
	}

	return jsonSchema.uniqueKey
		.filter(uniqueKey => uniqueKey.compositeUniqueKey?.length)
		.map(uniqueKey => ({
			keyType: 'UNIQUE',
			name: uniqueKey.constraintName,
			columns: getKeys(uniqueKey.compositeUniqueKey, jsonSchema),
		}));
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto}
 */
const getColumnPrimaryKeyConstraint = ({ columnDefinition }) => {
	const isPrimaryKey = columnDefinition.primaryKey && !columnDefinition.compositePrimaryKey;

	if (!isPrimaryKey) {
		return;
	}

	return {
		keyType: 'PRIMARY KEY',
	};
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto}
 */
const getColumnUniqueKeyConstraint = ({ columnDefinition }) => {
	if (!columnDefinition.unique) {
		return;
	}

	return {
		keyType: 'UNIQUE',
	};
};

/**
 * @param {{ columnDefinition: ColumnDefinition }}
 * @returns {ConstraintDto}
 */
const getColumnCheckConstraint = ({ columnDefinition }) => {
	if (!columnDefinition.check) {
		return;
	}

	return {
		keyType: 'CHECK',
		expression: columnDefinition.check,
	};
};

/**
 * @param {{ columnDefinition: ColumnDefinition; jsonSchema: JsonSchema }}
 * @returns {ConstraintDto[]}
 */
const getColumnConstraints = ({ columnDefinition, jsonSchema }) => {
	const primaryKeyConstraint = getColumnPrimaryKeyConstraint({ columnDefinition });
	const uniqueKeyConstraint = getColumnUniqueKeyConstraint({ columnDefinition });
	const checkConstraint = getColumnCheckConstraint({ columnDefinition });

	return [primaryKeyConstraint, uniqueKeyConstraint, checkConstraint].filter(Boolean);
};

module.exports = {
	getConstraintOpts,
	getUniqueKeyStatement,
	getCheckConstraint,
	getCompositeUniqueKeys,
	getCompositePrimaryKeys,
	getColumnConstraints,
};
