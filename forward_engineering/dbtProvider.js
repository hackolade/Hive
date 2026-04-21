/**
 * @typedef {import('./types').ColumnDefinition} ColumnDefinition
 * @typedef {import('./types').ConstraintDto} ConstraintDto
 * @typedef {import('./types').JsonSchema} JsonSchema
 */

const columnHelper = require('./helpers/columnHelper');
const constraintHelper = require('./helpers/constraintHelper');

class DbtProvider {
	/**
	 * @returns {DbtProvider}
	 */
	static createDbtProvider() {
		return new DbtProvider();
	}

	/**
	 * @param {{ columnDefinition: ColumnDefinition }}
	 * @returns {string}
	 */
	decorateType({ columnDefinition }) {
		const type = columnHelper.getTypeByProperty([], '')(columnDefinition);

		return columnHelper.clearComplexStructure({ type });
	}

	/**
	 * @param {{ jsonSchema: JsonSchema }}
	 * @returns {ConstraintDto[]}
	 */
	getCompositeKeyConstraints({ jsonSchema }) {
		const compositePrimaryKeys = constraintHelper.getCompositePrimaryKeys({ jsonSchema });
		const compositeUniqueKeys = constraintHelper.getCompositeUniqueKeys({ jsonSchema });

		return [...compositePrimaryKeys, ...compositeUniqueKeys];
	}

	/**
	 * @param {{ columnDefinition: ColumnDefinition; jsonSchema: JsonSchema }}
	 * @returns {ConstraintDto[]}
	 */
	getColumnConstraints({ columnDefinition, jsonSchema }) {
		return constraintHelper.getColumnConstraints({ columnDefinition });
	}

	/**
	 * @param {{ modelData: object[]; containerData: object[]; entityData: object[];}}
	 * @returns {{ databaseName?: string, schemaName?: string }}
	 */
	getEntityProperties({ modelData, containerData, entityData }) {
		return {
			databaseName: containerData?.[0]?.code ?? containerData?.[0]?.name,
		};
	}
}

module.exports = DbtProvider;
