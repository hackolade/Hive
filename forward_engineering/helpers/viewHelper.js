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

const isSourceActivated = (source = {}) =>
	_.first(source.collection)?.isActivated !== false && _.first(source.bucket)?.isActivated !== false;

const isSourceColumnActivated = (source = {}) => source.definition?.isActivated !== false;

const isColumnActivated = (column = {}, source = {}) =>
	column.isActivated !== false && isSourceActivated(source) && isSourceColumnActivated(source);

const getColumnNames = (collectionRefsDefinitionsMap, columns, isViewActivated) => {
	return _.uniq(
		Object.keys(columns).map(name => {
			const id = _.get(columns, [name, 'GUID']);
			const refId = columns[name]?.refId;

			const itemDataId = Object.keys(collectionRefsDefinitionsMap).find(viewFieldId => {
				const definitionData = collectionRefsDefinitionsMap[viewFieldId];

				return definitionData.definitionId === id;
			});
			const itemData = collectionRefsDefinitionsMap[refId] || collectionRefsDefinitionsMap[itemDataId] || {};
			const isActivated = isViewActivated ? isColumnActivated(columns[name], itemData) : true;

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

const getFromStatement = (collectionRefsDefinitionsMap, columns, isViewActivated) => {
	const sourceCollections = Object.keys(columns).reduce((result, name) => {
		const source = collectionRefsDefinitionsMap[columns[name].refId];
		const collection = _.first(source?.collection) || {};
		if (_.isEmpty(collection)) {
			return result;
		}
		const bucket = _.first(source.bucket) || {};
		const collectionName = prepareName(collection.collectionName || collection.code);
		const bucketName = prepareName(bucket.name || bucket.code || '');
		const fullCollectionName = bucketName ? `${bucketName}.${collectionName}` : `${collectionName}`;
		const columnActivated = isColumnActivated(columns[name], source);
		const existing = result.find(item => item.name === fullCollectionName);

		if (existing) {
			existing.isActivated = existing.isActivated || columnActivated;
		} else {
			result.push({ name: fullCollectionName, isActivated: columnActivated });
		}

		return result;
	}, []);
	if (_.isEmpty(sourceCollections)) {
		return '';
	}

	const [activatedCollections, deactivatedCollections] = _.partition(sourceCollections, 'isActivated');
	if (!isViewActivated || _.isEmpty(activatedCollections)) {
		return 'FROM\n' + indentString(_.map(sourceCollections, 'name').join('\nINNER JOIN '));
	}

	return (
		'FROM\n' +
		indentString(
			[
				_.map(activatedCollections, 'name').join('\nINNER JOIN '),
				...deactivatedCollections.map(collection => `/* INNER JOIN ${collection.name} */`),
			].join('\n'),
		)
	);
};

const retrievePropertyFromConfig = (config, tab, propertyName, defaultValue = '') =>
	config?.[tab]?.[propertyName] || defaultValue;

const retrieveContainerName = containerConfig =>
	retrievePropertyFromConfig(containerConfig, 0, 'code', retrievePropertyFromConfig(containerConfig, 0, 'name', ''));

module.exports = {
	getViewScript({ schema, viewData, containerData, collectionRefsDefinitionsMap }) {
		const statements = [];
		const columns = schema.properties || {};
		const view = _.first(viewData) || {};

		const bucketName = prepareName(retrieveContainerName(containerData));
		const viewName = prepareName(view.code || view.name);
		const isMaterialized = schema.materialized;
		const ifNotExist = view.ifNotExist;
		const orReplace = view.orReplace;
		const ifNotExists = view.ifNotExist;
		const comment = view.description;
		const isViewActivated = view.isActivated !== false && _.first(containerData)?.isActivated !== false;
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

			return commentDeactivatedStatements(`${createStatement}\n${statement};`, isViewActivated);
		}

		if (_.isEmpty(columns)) {
			return;
		}

		const isActivated =
			isViewActivated && !areAllColumnsDeactivated(getColumnNames(collectionRefsDefinitionsMap, columns, true));
		const columnsNames = getColumnNames(collectionRefsDefinitionsMap, columns, isActivated);
		const fromStatement = getFromStatement(collectionRefsDefinitionsMap, columns, isActivated);

		const joinedColumns = indentString(joinLastDeactivatedItem(columnsNames).join(',\n'));
		statements.push('SELECT', joinedColumns, fromStatement);

		return commentDeactivatedStatements(statements.join('\n') + ';', isActivated);
	},
};
