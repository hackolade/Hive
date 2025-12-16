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
const { DROP_STATEMENTS } = require('./constants');
const { commentDeactivatedStatements, replaceSpaceWithUnderscore, prepareName } = require('./generalHelper');

const getSchemaName = collection => replaceSpaceWithUnderscore(prepareName(getContainerName(collection.role?.compMod)));

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

const getAlterCollectionsScripts = (schema, definitions, provider, data) => {
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

	const addedCollectionsScripts = addedCollectionsItems
		.filter(item => item.compMod?.created)
		.flatMap(item => setCurrentSchemaName(item, getAddCollectionsScripts(definitions, data)));
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

const getAlterScript = (schema, definitions, data, app, needMinify, sqlFormatter) => {
	const provider = require('./alterScriptHelpers/provider')(app);
	const containerScripts = getAlterContainersScripts(schema, provider);
	const { currentSchemaName, ...collectionScripts } = getAlterCollectionsScripts(schema, definitions, provider, data);
	const viewScripts = getAlterViewsScripts(schema, provider);
	const foreignKeyScripts = getAlterForeignKeyScripts(schema, provider, currentSchemaName);

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
	return builds(scripts, needMinify, sqlFormatter);
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

const builds = (scripts, needMinify, sqlFormatter) => {
	const prepareScripts = scripts.filter(Boolean).join('\n\n');
	if (needMinify) {
		return prepareScripts;
	}
	const formatScripts = sqlFormatter.format(scripts.filter(Boolean).join('\n\n'), { indent: '    ' });
	return formatScripts
		.split(';')
		.map(script => script.trim())
		.join(';\n\n');
};

module.exports = {
	getAlterScript,
};
