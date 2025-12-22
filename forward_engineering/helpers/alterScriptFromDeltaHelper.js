const {
	getAddContainerScript,
	getDeleteContainerScript,
	getModifyContainerScript,
} = require('./alterScriptHelpers/alterContainerHelper');
const {
	getAddCollectionsScripts,
	getDeleteCollectionsScripts,
	getModifyCollectionsScripts,
	getDeleteColumnsScripts,
	getAddColumnsScripts,
	getModifyColumnsScripts,
} = require('./alterScriptHelpers/alterEntityHelper');
const { getAlterForeignKeyScripts } = require('./alterScriptHelpers/alterForeignKeyHelper');
const {
	getAddViewsScripts,
	getDeleteViewsScripts,
	getModifyViewsScripts,
} = require('./alterScriptHelpers/alterViewHelper');
const { getItems } = require('./alterScriptHelpers/common');
const { getContainerName } = require('./alterScriptHelpers/generalHelper');
const { buildScript } = require('./buildScript');
const { DROP_STATEMENTS } = require('./constants');
const { commentDeactivatedStatements, prepareName } = require('./generalHelper');

const getSchemaName = collection => prepareName(getContainerName(collection.role?.compMod));

const getAlterContainersScripts = (schema, provider) => {
	const addedContainerScripts = getItems(schema, 'containers', 'added').map(getAddContainerScript);
	const deletedContainerScripts = getItems(schema, 'containers', 'deleted').map(getDeleteContainerScript(provider));
	const modifiedContainerScripts = getItems(schema, 'containers', 'modified').flatMap(
		getModifyContainerScript(provider),
	);
	return {
		addedContainerScripts,
		deletedContainerScripts,
		modifiedContainerScripts,
	};
};

const sortCollectionsByRelationships = (collections, relationships) => {
	const collectionToChildren = new Map(); // Map of collection IDs to their children
	const collectionParentCount = new Map(); // Track how many parents each collection has

	// Initialize maps
	for (const collection of collections) {
		collectionToChildren.set(collection.role.id, []);
		collectionParentCount.set(collection.role.id, 0);
	}

	for (const relationship of relationships) {
		const parent = relationship.role.parentCollection;
		const child = relationship.role.childCollection;
		if (collectionToChildren.has(parent)) {
			collectionToChildren.get(parent).push(child);
		}
		collectionParentCount.set(child, (collectionParentCount.get(child) || 0) + 1);
	}

	// Find collections with no parents
	const queue = collections
		.filter(collection => collectionParentCount.get(collection.role.id) === 0)
		.map(collection => collection.role.id);

	const sortedIds = [];

	// Sort collections
	while (queue.length > 0) {
		const current = queue.shift();
		sortedIds.push(current);

		for (const child of collectionToChildren.get(current) || []) {
			collectionParentCount.set(child, collectionParentCount.get(child) - 1);
			if (collectionParentCount.get(child) <= 0) {
				queue.push(child);
			}
		}
	}

	// Add any unvisited collection
	for (const collection of collections) {
		if (!sortedIds.includes(collection.role.id)) {
			sortedIds.unshift(collection.role.id);
		}
	}

	// Map back to collection objects in sorted order
	const idToCollection = Object.fromEntries(collections.map(c => [c.role.id, c]));
	return sortedIds.map(id => idToCollection[id]);
};

const getAlterCollectionsScripts = ({ schema, definitions, provider, data, inlineDeltaRelationships }) => {
	let currentSchemaName = '';

	const setCurrentSchemaName = (entity, getScript) => {
		const script = getScript(entity);

		currentSchemaName = getSchemaName(entity);

		return script;
	};

	const getColumnScripts = (items, getScript) =>
		items.filter(item => item.properties).flatMap(item => setCurrentSchemaName(item, getScript));

	const addedCollectionsItems = getItems(schema, 'entities', 'added');
	const deletedCollectionsItems = getItems(schema, 'entities', 'deleted');
	const modifiedCollectionsItems = getItems(schema, 'entities', 'modified');

	const addedCollectionsScripts = sortCollectionsByRelationships(
		addedCollectionsItems.filter(collection => collection.compMod?.created),
		inlineDeltaRelationships,
	).flatMap(item =>
		setCurrentSchemaName(item, getAddCollectionsScripts(definitions, data, inlineDeltaRelationships)),
	);

	const deletedCollectionsScripts = deletedCollectionsItems
		.filter(item => item.compMod?.deleted)
		.flatMap(getDeleteCollectionsScripts(provider));
	const modifiedCollectionsScripts = modifiedCollectionsItems.flatMap(item =>
		setCurrentSchemaName(item, getModifyCollectionsScripts(definitions, provider, data)),
	);

	const addedColumnsItems = addedCollectionsItems.filter(item => !item.compMod?.created);
	const deletedColumnsItems = deletedCollectionsItems.filter(item => !item.compMod?.deleted);

	const addedColumnsScripts = getColumnScripts(addedColumnsItems, getAddColumnsScripts(definitions, provider));
	const deletedColumnsScripts = getColumnScripts(deletedColumnsItems, getDeleteColumnsScripts(definitions, provider));
	const modifiedColumnsScripts = getColumnScripts(
		modifiedCollectionsItems,
		getModifyColumnsScripts(definitions, provider),
	);

	return {
		addedCollectionsScripts,
		deletedCollectionsScripts,
		modifiedCollectionsScripts,
		addedColumnsScripts,
		deletedColumnsScripts,
		modifiedColumnsScripts,
		currentSchemaName,
	};
};

const getAlterViewsScripts = (schema, provider) => {
	const getViewScripts = (views, compMode, getScript) =>
		views
			.map(view => ({ ...view, ...(view.role || {}) }))
			.filter(view => view.compMod?.[compMode])
			.map(getScript);

	const getColumnScripts = (items, getScript) =>
		items
			.map(view => ({ ...view, ...(view.role || {}) }))
			.filter(view => !view.compMod?.created && !view.compMod?.deleted)
			.flatMap(getScript);

	const addedViewScripts = getViewScripts(getItems(schema, 'views', 'added'), 'created', getAddViewsScripts);
	const deletedViewScripts = getViewScripts(
		getItems(schema, 'views', 'deleted'),
		'deleted',
		getDeleteViewsScripts(provider),
	);
	const modifiedViewScripts = getColumnScripts(
		getItems(schema, 'views', 'modified'),
		getModifyViewsScripts(provider),
	);

	return {
		addedViewScripts,
		deletedViewScripts,
		modifiedViewScripts,
	};
};

const getInlineRelationships = ({ schema, options }) => {
	if (options?.scriptGenerationOptions?.feActiveOptions?.foreignKeys !== 'inline') {
		return [];
	}

	const addedCollectionIDs = []
		.concat(schema.properties?.entities?.properties?.added?.items)
		.filter(item => item && Object.values(item.properties)?.[0]?.compMod?.created)
		.map(item => Object.values(item.properties)[0].role.id);

	const addedRelationships = []
		.concat(schema.properties?.relationships?.properties?.added?.items)
		.map(item => item && Object.values(item.properties)[0])
		.filter(r => r?.role?.compMod?.created && addedCollectionIDs.includes(r?.role?.childCollection));

	return addedRelationships;
};

const getAlterScript = (schema, definitions, data, app) => {
	const provider = require('./alterScriptHelpers/provider')(app);

	const inlineDeltaRelationships = getInlineRelationships({ schema, options: data.options });
	const ignoreRelationshipIDs = inlineDeltaRelationships.map(relationship => relationship.role.id);

	const containerScripts = getAlterContainersScripts(schema, provider);
	const { currentSchemaName, ...collectionScripts } = getAlterCollectionsScripts({
		schema,
		definitions,
		provider,
		data,
		inlineDeltaRelationships,
	});
	const viewScripts = getAlterViewsScripts(schema, provider);
	const foreignKeyScripts = getAlterForeignKeyScripts({ schema, provider, currentSchemaName, ignoreRelationshipIDs });

	let scripts = {
		...containerScripts,
		...collectionScripts,
		...viewScripts,
		...foreignKeyScripts,
	};

	scripts = [
		'addedContainerScripts',
		'modifiedContainerScripts',
		'deletedViewScripts',
		'deletedCollectionsScripts',
		'deletedColumnsScripts',
		'addedCollectionsScripts',
		'addedColumnsScripts',
		'modifiedCollectionsScripts',
		'modifiedColumnsScripts',
		'addedViewScripts',
		'modifiedViewScripts',
		'deletedContainerScripts',
		'deleteFkScripts',
		'addFkScripts',
		'modifiedFkScripts',
	]
		.flatMap(name => scripts[name] || [])
		.filter(Boolean)
		.map(script => script.trim());
	scripts = getCommentedDropScript(scripts, data);
	return buildScript(...scripts);
};

const getCommentedDropScript = (scripts, data) => {
	const { additionalOptions = [] } = data.options || {};
	const applyDropStatements = additionalOptions.find(option => option.id === 'applyDropStatements')?.value;
	if (applyDropStatements) {
		return scripts;
	}
	return scripts.map(script => {
		const isDrop = DROP_STATEMENTS.some(statement => script.includes(statement));
		return !isDrop ? script : commentDeactivatedStatements(script, false);
	});
};

module.exports = {
	getAlterScript,
};
