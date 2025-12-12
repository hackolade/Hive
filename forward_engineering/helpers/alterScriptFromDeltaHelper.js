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
const {
	getAddViewsScripts,
	getDeleteViewsScripts,
	getModifyViewsScripts,
} = require('./alterScriptHelpers/alterViewHelper');
const { DROP_STATEMENTS } = require('./constants');
const { commentDeactivatedStatements } = require('./generalHelper');

const getItems = (entity, nameProperty, modify) =>
	[]
		.concat(entity.properties?.[nameProperty]?.properties?.[modify]?.items)
		.filter(Boolean)
		.map(items => Object.values(items.properties)[0]);

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
	const getColumnScripts = (items, getScript) => items.filter(item => item.properties).flatMap(getScript);

	const addedCollectionsItems = getItems(schema, 'entities', 'added');
	const deletedCollectionsItems = getItems(schema, 'entities', 'deleted');
	const modifiedCollectionsItems = getItems(schema, 'entities', 'modified');

	const addedCollectionsScripts = addedCollectionsItems
		.filter(item => item.compMod?.created)
		.flatMap(getAddCollectionsScripts(definitions, data));
	const deletedCollectionsScripts = deletedCollectionsItems
		.filter(item => item.compMod?.deleted)
		.flatMap(getDeleteCollectionsScripts(provider));
	const modifiedCollectionsScripts = modifiedCollectionsItems.flatMap(
		getModifyCollectionsScripts(definitions, provider, data),
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
	let scripts = {
		...getAlterContainersScripts(schema, provider),
		...getAlterCollectionsScripts(schema, definitions, provider, data),
		...getAlterViewsScripts(schema, provider),
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
