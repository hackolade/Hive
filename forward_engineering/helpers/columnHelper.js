const {
	getName,
	getTypeDescriptor,
	prepareName,
	commentDeactivatedStatements,
	encodeStringLiteral,
} = require('./generalHelper');
const { getConstraintOpts } = require('./constraintHelper');
const { getDefaultConstraintName } = require('./alterScriptHelpers/generalHelper');
const { CONSTRAINT_POSTFIX } = require('./constants');

const getStructChild = (name, type, comment) =>
	`${prepareName(name)}: ${type}` + (comment ? ` COMMENT '${encodeStringLiteral(comment)}'` : '');

const getStructChildProperties = (getTypeByProperty, definitions) => property => {
	const childProperties = Object.keys(property.properties || {});
	const activatedProps = [];
	const deactivatedProps = [];

	if (childProperties.length) {
		childProperties.forEach(propertyName => {
			const childProperty = property.properties[propertyName];
			const name = getName(childProperty) || propertyName;
			const isActivated = childProperty.isActivated !== false;
			const structChild = getStructChild(
				name,
				getTypeByProperty(childProperty),
				getDescription(definitions, childProperty),
			);
			if (isActivated) {
				activatedProps.push(structChild);
			} else {
				deactivatedProps.push(structChild);
			}
		});
	}

	if (Array.isArray(property.oneOf)) {
		const unions = getUnionFromOneOf(getTypeByProperty)(property);
		activatedProps.push(...Object.keys(unions).map(name => getStructChild(name, unions[name])));
	}

	if (Array.isArray(property.allOf)) {
		const unions = getUnionFromAllOf(getTypeByProperty)(property);
		activatedProps.push(...Object.keys(unions).map(name => getStructChild(name, unions[name])));
	}

	if (!activatedProps.length) {
		activatedProps.push('new_column: string');
	}

	return { activatedProps, deactivatedProps };
};

const getStruct = (getTypeByProperty, definitions) => property => {
	const getStructStatement = propertiesString => `struct<${propertiesString}>`;

	const { activatedProps, deactivatedProps } = getStructChildProperties(getTypeByProperty, definitions)(property);
	if (deactivatedProps.length === 0) {
		return getStructStatement(activatedProps.join(', '));
	} else if (activatedProps.length === 0) {
		return getStructStatement(`/* ${activatedProps.join(', ')} */`);
	}
	return getStructStatement(`${activatedProps.join(', ')} /*, ${deactivatedProps.join(', ')}*/`);
};

const getChildBySubtype = (parentType, subtype) => {
	const childValueType = getTypeDescriptor(parentType).subtypes?.[subtype]?.childValueType || 'text';

	return getPropertyByType(childValueType);
};

const getPropertyByType = type => {
	const childTypeDescriptor = getTypeDescriptor(type);

	return {
		type,
		...childTypeDescriptor.defaultValues,
	};
};

const getArray = getTypeByProperty => property => {
	let type;

	if (Array.isArray(property.items)) {
		type = getTypeByProperty(property.items[0]);
	} else if (property.items) {
		type = getTypeByProperty(property.items);
	} else if (Array.isArray(property.oneOf)) {
		const unions = getUnionFromOneOf(getTypeByProperty)(property);
		const name = Object.keys(unions)[0];
		type = unions[name];
	} else if (Array.isArray(property.allOf)) {
		const unions = getUnionFromAllOf(getTypeByProperty)(property);
		const name = Object.keys(unions)[0];
		type = unions[name];
	}

	if (!type) {
		type = getTypeByProperty(getChildBySubtype('array', property.subtype));
	}

	return `array<${type}>`;
};

const getMapKey = property => {
	if (['char', 'varchar'].includes(property.keySubtype)) {
		return property.keySubtype + '(255)';
	} else if (property.keySubtype) {
		return property.keySubtype;
	} else if (property.keyType === 'numeric') {
		return 'int';
	} else {
		return 'string';
	}
};

const getMap = getTypeByProperty => property => {
	const key = getMapKey(property);
	const childNames = Object.keys(property.properties || {});
	let type;

	if (childNames.length) {
		type = getTypeByProperty(property.properties[childNames[0]]);
	} else if (Array.isArray(property.oneOf)) {
		const unions = getUnionFromOneOf(getTypeByProperty)(property);
		type = unions[Object.keys(unions)[0]];
	} else if (Array.isArray(property.allOf)) {
		const unions = getUnionFromAllOf(getTypeByProperty)(property);
		type = unions[Object.keys(unions)[0]];
	}

	if (!type) {
		type = getTypeByProperty(getChildBySubtype('map', property.subtype));
	}

	return `map<${key}, ${type}>`;
};

const getText = property => {
	const mode = property.mode;

	if (['char', 'varchar'].includes(mode)) {
		return 'string';
	} else if (property.maxLength) {
		return mode + `(${property.maxLength})`;
	} else {
		return mode + `(${255})`;
	}
};

const getNumeric = property => {
	const mode = property.mode;

	if (mode !== 'decimal') {
		return mode;
	} else if (property.precision || property.scale) {
		return mode + `(${property.precision || 9}, ${property.scale || 0})`;
	} else {
		return mode;
	}
};

const getJsonType = getTypeByProperty => property => {
	if (!property.physicalType) {
		return 'string';
	}

	return getTypeByProperty({ ...property, type: property.physicalType });
};

const getUnionTypeFromMultiple = getTypeByProperty => property => {
	const types = property.type.map(type => {
		const dataType = type === 'number' ? 'numeric' : type;

		return getTypeByProperty(getPropertyByType(dataType));
	});

	return `uniontype<${types.join(',')}>`;
};

const getUnionFromOneOf = getTypeByProperty => property => {
	const types = property.oneOf.reduce((types, item) => {
		return Object.keys(item.properties || {}).reduce((types, itemName) => {
			const itemProperty = item.properties[itemName];
			const name = getName(itemProperty) || itemName;
			const propertyType = getTypeByProperty(itemProperty);

			if (!Array.isArray(types[name])) {
				types[name] = [];
			}

			types[name].push(propertyType);

			return types;
		}, types);
	}, {});

	return Object.keys(types).reduce((result, propertyName) => {
		result[propertyName] = `uniontype<${(types[propertyName] || []).join(', ')}>`;

		return result;
	}, {});
};

const getUnionFromAllOf = getTypeByProperty => property => {
	return property.allOf.reduce((types, subschema) => {
		if (!Array.isArray(subschema.oneOf)) {
			return types;
		}

		return { ...types, ...getUnionFromOneOf(getTypeByProperty)(subschema) };
	}, {});
};

const getDefinitionByReference = (definitions, reference) => {
	const definitionNamePath = reference.$ref.split('/');
	const definitionName = definitionNamePath[definitionNamePath.length - 1];
	let source = {};

	switch (definitionNamePath[0]) {
		case '#':
			source = definitions[0] || {};
			break;
		case '#model':
			source = definitions[1] || {};
			break;
		case '#external':
			source = definitions[2] || {};
			break;
	}

	const definitionsProperties = source.properties || {};

	if (definitionsProperties[definitionName]) {
		return definitionsProperties[definitionName];
	}

	const allDefinitions = definitions.reduce(
		(result, { properties }) => ({
			...result,
			...properties,
		}),
		{},
	);

	return allDefinitions[definitionName] || definitionName;
};

const getTypeByProperty =
	(definitions = []) =>
	property => {
		if (Array.isArray(property.type)) {
			return getUnionTypeFromMultiple(getTypeByProperty(definitions))(property);
		}

		if (property.$ref) {
			property = getDefinitionByReference(definitions, property);
		}

		switch (property.type) {
			case 'jsonObject':
			case 'jsonArray':
				return getJsonType(getTypeByProperty(definitions))(property);
			case 'text':
				return getText(property);
			case 'numeric':
				return getNumeric(property);
			case 'bool':
				return 'boolean';
			case 'interval':
				return 'string';
			case 'struct':
				return getStruct(getTypeByProperty(definitions), definitions)(property);
			case 'array':
				return getArray(getTypeByProperty(definitions))(property);
			case 'map':
				return getMap(getTypeByProperty(definitions))(property);
			case undefined:
				return 'string';
			default:
				return property.type;
		}
	};

const getColumn = (name, type, comment, constraints, isActivated) => ({
	[name]: { type, comment, constraints, isActivated },
});

const getColumns = (jsonSchema, areColumnConstraintsAvailable, definitions) => {
	const deactivatedColumnNames = new Set();
	let columns = Object.keys(jsonSchema.properties || {}).reduce((hash, columnName) => {
		const property = jsonSchema.properties[columnName];
		const isRequired = (jsonSchema.required || []).includes(columnName);
		const name = getName(property) || columnName;
		if (!property.isActivated) {
			deactivatedColumnNames.add(name);
		}
		const isPrimaryKey = property.primaryKey && !property.compositePrimaryKey && !property.compositeClusteringKey;

		const isUnique = property.unique && !property.compositeUniqueKey && !isPrimaryKey;

		return {
			...hash,
			...getColumn(
				prepareName(name),
				getTypeByProperty(definitions)(property),
				getDescription(definitions, property),
				areColumnConstraintsAvailable
					? {
							notNull: isRequired,
							unique: isUnique,
							check: property.check,
							primaryKey: isPrimaryKey,
							defaultValue: property.default,
							rely: property.rely,
							noValidateSpecification: property.noValidateSpecification,
							enableSpecification: property.enableSpecification,
						}
					: {},
				property.isActivated,
			),
		};
	}, {});

	if (Array.isArray(jsonSchema.oneOf)) {
		const unions = getUnionFromOneOf(getTypeByProperty(definitions))(jsonSchema);

		columns = Object.keys(unions).reduce(
			(hash, typeName) => ({ ...hash, ...getColumn(prepareName(typeName), unions[typeName]) }),
			columns,
		);
	}

	if (Array.isArray(jsonSchema.allOf)) {
		const unions = getUnionFromAllOf(getTypeByProperty(definitions))(jsonSchema);

		columns = Object.keys(unions).reduce(
			(hash, typeName) => ({ ...hash, ...getColumn(prepareName(typeName), unions[typeName]) }),
			columns,
		);
	}

	return { columns, deactivatedColumnNames };
};

const getColumnStatementParts = ({ collection, column }) => {
	const { name, type, comment, isActivated, isParentActivated } = column;
	const commentStatement = comment ? ` COMMENT '${encodeStringLiteral(comment)}'` : '';
	const { inline, separate } = getColumnConstraintsStatement({ collection, column });
	const isColumnActivated = isParentActivated ? isActivated : true;

	return {
		columnStatement: commentDeactivatedStatements(`${name} ${type}${inline}${commentStatement}`, isColumnActivated),
		constraintsStatement: separate,
	};
};

const getColumnsStatement = ({ collection, columns, isParentActivated }) => {
	const columnStatements = [];
	const constraintStatements = [];

	for (const name of Object.keys(columns)) {
		const { columnStatement, constraintsStatement } = getColumnStatementParts({
			collection,
			column: { ...columns[name], name, isParentActivated },
		});

		columnStatements.push(columnStatement);

		if (constraintsStatement) {
			constraintStatements.push(constraintsStatement);
		}
	}

	return [...columnStatements, ...constraintStatements].join(',\n');
};

const getColumnConstraintsStatement = ({ collection, column }) => {
	const result = {
		inline: '',
		separate: '',
	};

	if (!column.constraints) {
		return result;
	}

	const { notNull, unique, check, defaultValue, primaryKey, rely, noValidateSpecification, enableSpecification } =
		column.constraints;

	const getNoValidateStatement = enableSpecification =>
		getConstraintOpts({ rely, enableSpecification, noValidateSpecification });

	const getConstraint = ({ statement, postfix, noValidate, skipName = false }) => {
		const constraintName = getDefaultConstraintName({ collection, column, postfix });
		const columnName = skipName ? '' : ` ${column.name}`;
		return `CONSTRAINT ${constraintName} ${statement}${columnName} ${noValidate}`;
	};

	const statements = [];

	if (primaryKey) {
		statements.push(
			getConstraint({
				statement: 'PRIMARY KEY',
				postfix: CONSTRAINT_POSTFIX.primaryKey,
				noValidate: getNoValidateStatement('DISABLE'),
			}),
		);
	}

	if (unique) {
		statements.push(
			getConstraint({
				statement: 'UNIQUE',
				postfix: CONSTRAINT_POSTFIX.uniqueKey,
				noValidate: getNoValidateStatement('DISABLE'),
			}),
		);
	}

	if (notNull) {
		statements.push(
			getConstraint({
				statement: `CHECK (${column.name} IS NOT NULL)`,
				skipName: true,
				postfix: CONSTRAINT_POSTFIX.notNull,
				noValidate: getNoValidateStatement(enableSpecification),
			}),
		);
	}

	if (defaultValue) {
		const value = typeof defaultValue === 'string' ? `'${defaultValue}'` : defaultValue;
		result.inline = ` DEFAULT ${value}`;
	}

	if (check) {
		statements.push(
			getConstraint({
				statement: `CHECK (${check})`,
				postfix: CONSTRAINT_POSTFIX.check,
				noValidate: getNoValidateStatement(enableSpecification),
			}),
		);
	}

	if (statements.length) {
		result.separate = statements.join(',\n');
	}

	return result;
};

const getDescription = (definitions, property) => {
	if (!property.$ref) {
		return property.description;
	}

	const definitionDescription = getDefinitionByReference(definitions, property)?.description;

	return property.refDescription || property.description || definitionDescription;
};

/**
 * @param {{ type: string }}
 * @returns {string}
 */
const clearComplexStructure = ({ type }) => {
	const isArray = /^array/i.test(type);
	const isStruct = /^struct/i.test(type);
	const isComplexType = isArray || isStruct;

	if (!isComplexType) {
		return type;
	}

	const structureRegExp = /<([\s\S]+)>$/;
	const [, subType] = structureRegExp.exec(type) ?? ['', ''];
	const structure = isArray ? clearComplexStructure({ type: subType }) : '';

	return type.replace(structureRegExp, () => `<${structure}>`);
};

module.exports = {
	getColumns,
	getColumnsStatement,
	getColumnStatementParts,
	getTypeByProperty,
	clearComplexStructure,
};
