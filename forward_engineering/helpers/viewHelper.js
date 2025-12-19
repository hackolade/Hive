const _ = require('lodash');
const { prepareName, commentDeactivatedStatements, encodeStringLiteral, indentString } = require('./generalHelper');

const itemIsDeactivated = item => item.startsWith('-- ');

const joinLastDeactivatedItem = (items = []) => {
	const activatedItems = _.dropRightWhile(items, itemIsDeactivated);
	if (activatedItems.length === items.length || activatedItems.length === 0) {
		return items;
	}

	const deactivatedItems = items.slice(activatedItems.length);
	return [...activatedItems.slice(0, -1), _.last(activatedItems) + ' -- ', ...deactivatedItems];
};

const areAllColumnsDeactivated = (columns = []) => columns.length && columns.every(itemIsDeactivated);

const getColumnNames = (collectionRefsDefinitionsMap, columns, isViewActivated) => {
	return _.uniq(
		Object.keys(columns).map(name => {
			const id = _.get(columns, [name, 'GUID']);
			const refId = columns[name]?.refId;

			const itemDataId = Object.keys(collectionRefsDefinitionsMap).find(viewFieldId => {
				const definitionData = collectionRefsDefinitionsMap[viewFieldId];

				return definitionData.definitionId === id;
			});
			const isActivated = isViewActivated ? _.get(columns[name], 'isActivated') : true;
			const itemData = collectionRefsDefinitionsMap[refId] || collectionRefsDefinitionsMap[itemDataId] || {};

			if (!itemData.name || itemData.name === name) {
				return commentDeactivatedStatements(prepareName(itemData.name), isActivated);
			}
			const collection = _.first(itemData.collection) || {};
			const collectionName = collection.collectionName || collection.code;
			const columnName = `${prepareName(collectionName)}.${prepareName(itemData.name)} as ${prepareName(name)}`;

			return commentDeactivatedStatements(columnName, isActivated);
		}),
	).filter(_.identity);
};

const getFromStatement = (collectionRefsDefinitionsMap, columns) => {
	const sourceCollections = _.uniq(
		Object.keys(columns).map(name => {
			const refId = columns[name].refId;
			const source = collectionRefsDefinitionsMap[refId];
			const collection = _.first(source.collection) || {};
			if (_.isEmpty(collection)) {
				return;
			}
			const bucket = _.first(source.bucket) || {};
			const collectionName = prepareName(collection.collectionName || collection.code);
			const bucketName = prepareName(bucket.name || bucket.code || '');
			const fullCollectionName = bucketName ? `${bucketName}.${collectionName}` : `${collectionName}`;

			return fullCollectionName;
		}),
	).filter(Boolean);
	if (_.isEmpty(sourceCollections)) {
		return '';
	}

	return 'FROM\n' + indentString(sourceCollections.join('\nINNER JOIN '));
};

const retrievePropertyFromConfig = (config, tab, propertyName, defaultValue = '') =>
	config?.[tab]?.[propertyName] || defaultValue;

const retrieveContainerName = containerConfig =>
	retrievePropertyFromConfig(containerConfig, 0, 'code', retrievePropertyFromConfig(containerConfig, 0, 'name', ''));

module.exports = {
	getViewScript({ schema, viewData, containerData, collectionRefsDefinitionsMap }) {
		let statements = [];
		const columns = schema.properties || {};
		const view = _.first(viewData) || {};

		const bucketName = prepareName(retrieveContainerName(containerData));
		const viewName = prepareName(view.code || view.name);
		const isMaterialized = schema.materialized;
		const ifNotExist = view.ifNotExist;
		const orReplace = view.orReplace;
		const ifNotExists = view.ifNotExist;
		const comment = view.description;
		const fromStatement = getFromStatement(collectionRefsDefinitionsMap, columns);
		const name = bucketName ? `${bucketName}.${viewName}` : `${viewName}`;

		const createStatement = [
			'CREATE',
			orReplace && !ifNotExists ? 'OR REPLACE' : '',
			isMaterialized ? 'MATERIALIZED' : '',
			'VIEW',
			ifNotExist ? 'IF NOT EXISTS' : '',
			name,
			comment ? `COMMENT '${encodeStringLiteral(comment)}'` : '',
			'AS',
		]
			.filter(Boolean)
			.join(' ');

		statements.push(createStatement);

		if (schema.selectStatement) {
			let statement = schema.selectStatement;
			if (_.trim(statement).toLowerCase().startsWith('as')) {
				statement = statement
					.trim()
					.replace(/\bAS\b/i, '')
					.trim();
			}

			return `${createStatement}\n${statement};`;
		}

		if (_.isEmpty(columns)) {
			return;
		}

		const columnsNames = getColumnNames(collectionRefsDefinitionsMap, columns, view.isActivated);
		const allColumnsAreDeactivated = areAllColumnsDeactivated(columnsNames);

		if (allColumnsAreDeactivated) {
			return;
		}

		const joinedColumns = indentString(joinLastDeactivatedItem(columnsNames).join(',\n'));
		statements.push('SELECT', joinedColumns, fromStatement);

		return commentDeactivatedStatements(statements.join('\n') + ';', view.isActivated);
	},
};
