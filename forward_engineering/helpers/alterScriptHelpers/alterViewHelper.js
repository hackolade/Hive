const _ = require('lodash');
const { getViewScript } = require('../viewHelper');
const {
	getEntityData,
	getEntityProperties,
	getContainerName,
	generateFullEntityName,
	getEntityName,
} = require('./generalHelper');
const templates = require('./config/templates');

const viewProperties = ['tableProperties', 'viewTemporary', 'viewOrReplace', 'isGlobal', 'description', 'name', 'code'];

const prepareColumnGuids = columns =>
	Object.entries(columns).reduce(
		(columns, [name, value = {}]) => ({
			...columns,
			[name]: {
				...value,
				GUID: value.refId || '',
			},
		}),
		{},
	);

const prepareRefsDefinitionsMap = definitions =>
	Object.entries(definitions).reduce(
		(columns, [definitionId, value = {}]) => ({
			...columns,
			[definitionId]: {
				...value,
				definitionId,
			},
		}),
		{},
	);

const hydrateView = view => {
	const compMod = _.get(view, 'role.compMod', {});
	const properties = prepareColumnGuids(getEntityProperties(view));
	const roleData = getEntityData(compMod, viewProperties);
	const schema = { ..._.get(view, 'role', {}), ...roleData, properties };
	const collectionRefsDefinitionsMap = prepareRefsDefinitionsMap(
		schema.compMod?.collectionData?.collectionRefsDefinitionsMap || {},
	);
	return {
		schema,
		collectionRefsDefinitionsMap,
		viewData: [schema],
		containerData: [{ name: getContainerName(compMod) }],
	};
};

const hydrateAlterView = (view, code) => ({
	...view,
	role: { ...(view.role || {}), code },
});

const getAddViewsScripts = view => {
	const hydratedView = hydrateView(view);
	return getViewScript(hydratedView);
};

const getDeleteViewsScripts = provider => view => {
	const name = generateFullEntityName(view);
	const isMaterialized = view.role?.materialized;
	return provider.dropView({ name, isMaterialized });
};

const getModifyViewPropertiesScripts = ({ provider, view }) => {
	const compMod = view.role?.compMod || {};
	const { newName: viewName } = getEntityName(compMod, 'name');
	const viewProperties = ['description'];

	const { addProperties, dropProperties } = viewProperties.reduce(
		(acc, property) => {
			const oldPropValue = compMod[property]?.old;
			const newPropValue = compMod[property]?.new;

			if (_.isEqual(oldPropValue, newPropValue)) {
				return acc;
			}

			let propName = property;

			if (property === 'description') {
				propName = 'comment';
			}

			if (newPropValue) {
				acc.addProperties.push(`'${propName}'='${newPropValue}'`);
			} else {
				acc.dropProperties.push(`'${propName}'`);
			}

			return acc;
		},
		{ addProperties: [], dropProperties: [] },
	);

	const addScript = addProperties.length
		? provider.assignTemplates(templates.setViewProperties, {
				name: viewName,
				properties: addProperties.join(', '),
			})
		: '';
	const dropScript = dropProperties.length
		? provider.assignTemplates(templates.unsetViewProperties, {
				name: viewName,
				properties: dropProperties.join(', '),
			})
		: '';

	return [dropScript, addScript].filter(Boolean);
};

const getModifyViewsScripts = provider => view => {
	const compMod = view.role?.compMod || {};
	const viewName = getEntityName(compMod, 'name');

	if (viewName.newName === viewName.oldName) {
		const modifyViewPropertiesScripts = getModifyViewPropertiesScripts({ provider, view });
		return modifyViewPropertiesScripts.length ? modifyViewPropertiesScripts : [];
	}
	const dropViewScript = getDeleteViewsScripts(provider)(hydrateAlterView(view, viewName.oldName));
	const hydratedView = hydrateView(hydrateAlterView(view, viewName.newName));
	const addViewScript = getViewScript(hydratedView);

	return [dropViewScript, addViewScript];
};

module.exports = {
	getAddViewsScripts,
	getDeleteViewsScripts,
	getModifyViewsScripts,
};
