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

/**
 * @param {Object} view
 * @returns {Record<string, Object>}
 */
const getCollectionRefsDefinitionsMap = view =>
	view.compMod?.collectionData?.collectionRefsDefinitionsMap ||
	view.role?.compMod?.collectionData?.collectionRefsDefinitionsMap ||
	{};

/**
 * Resolve source table/schema/field refs for a view column.
 *
 * @param {Object} column
 * @param {Record<string, Object>} [collectionRefsDefinitionsMap]
 * @returns {Object}
 */
const getViewColumnSource = (column, collectionRefsDefinitionsMap = {}) =>
	collectionRefsDefinitionsMap[column?.refId] ||
	Object.values(collectionRefsDefinitionsMap).find(
		item => item.definitionId === column?.GUID || item.definitionId === column?.ref,
	) ||
	{};

/**
 * Shared source activation for CREATE VIEW and view activation.
 *
 * @param {Object} [source]
 * @returns {boolean}
 */
const isViewColumnSourceActivated = (source = {}) => {
	const sourceCollection = source.collection?.[0] ?? source.entityData?.[0] ?? {};
	const sourceBucket = source.bucket?.[0] ?? source.containerData?.[0] ?? {};
	const sourceDefinition = source.definition ?? {};

	return (
		sourceCollection.isActivated !== false &&
		sourceBucket.isActivated !== false &&
		sourceDefinition.isActivated !== false
	);
};

/**
 * A view column is active only when it, its source table/schema, and its source field are active.
 *
 * @param {Object} column
 * @param {Record<string, Object>} [collectionRefsDefinitionsMap]
 * @returns {boolean}
 */
const isViewColumnActivated = (column, collectionRefsDefinitionsMap = {}) => {
	if (column?.isActivated === false) {
		return false;
	}

	return isViewColumnSourceActivated(getViewColumnSource(column, collectionRefsDefinitionsMap));
};

/**
 * Whether view DDL (CREATE VIEW, ALTER VIEW) should stay uncommented.
 * Checks: parent container, view, and custom SELECT or at least one active view column
 * (including source collection/schema/field). Also accepts hydrated `keys` from CREATE VIEW.
 *
 * @param {Object} [view]
 * @param {Object} [options]
 * @param {boolean} [options.isActivated] Explicit view-level flag
 * @param {boolean} [options.isContainerActivated] Explicit container flag
 * @param {Record<string, Object>} [options.collectionRefsDefinitionsMap] Explicit source map (CREATE FE)
 * @returns {boolean}
 */
const isViewActivated = (
	view = {},
	{ isActivated, isContainerActivated, collectionRefsDefinitionsMap: refsMap } = {},
) => {
	const containerActivated =
		isContainerActivated ??
		view.compMod?.bucketProperties?.isActivated ??
		view.role?.compMod?.bucketProperties?.isActivated ??
		true;
	if (containerActivated === false) {
		return false;
	}

	const viewActivated =
		isActivated ?? view.compMod?.isActivated?.new ?? view.role?.isActivated ?? view.isActivated ?? true;
	if (viewActivated === false) {
		return false;
	}

	const selectStatement = view.selectStatement ?? view.role?.selectStatement ?? '';
	if (_.trim(selectStatement)) {
		return true;
	}

	const collectionRefsDefinitionsMap = refsMap || getCollectionRefsDefinitionsMap(view);
	const columns = Object.values(view.properties || view.role?.properties || {});
	if (columns.length) {
		return columns.some(column => isViewColumnActivated(column, collectionRefsDefinitionsMap));
	}

	if (Array.isArray(view.keys) && view.keys.length) {
		return view.keys.some(key => key.isActivated !== false);
	}

	return true;
};

const getColumnNames = (collectionRefsDefinitionsMap, columns, viewIsActivated) => {
	return _.uniq(
		Object.keys(columns).map(name => {
			const column = columns[name] || {};
			const itemData = getViewColumnSource(column, collectionRefsDefinitionsMap);
			const isActivated = viewIsActivated ? isViewColumnActivated(column, collectionRefsDefinitionsMap) : true;

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

const getViewScript = ({ schema, viewData, containerData, collectionRefsDefinitionsMap }) => {
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
	const fromStatement = getFromStatement(collectionRefsDefinitionsMap, columns);
	const name = bucketName ? `${bucketName}.${viewName}` : `${viewName}`;
	const viewActivated = isViewActivated(schema, {
		isActivated: view.isActivated,
		isContainerActivated: containerData?.[0]?.isActivated,
		collectionRefsDefinitionsMap,
	});

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

		return commentDeactivatedStatements(`${createStatement}\n${statement};`, viewActivated);
	}

	if (_.isEmpty(columns)) {
		return;
	}

	const columnsNames = getColumnNames(collectionRefsDefinitionsMap, columns, viewActivated);
	const allColumnsAreDeactivated = areAllColumnsDeactivated(columnsNames);

	if (allColumnsAreDeactivated) {
		return;
	}

	const joinedColumns = indentString(joinLastDeactivatedItem(columnsNames).join(',\n'));
	statements.push('SELECT', joinedColumns, fromStatement);

	return commentDeactivatedStatements(statements.join('\n') + ';', viewActivated);
};

module.exports = {
	getViewScript,
	isViewActivated,
	isViewColumnActivated,
	isViewColumnSourceActivated,
	getViewColumnSource,
	getCollectionRefsDefinitionsMap,
};
