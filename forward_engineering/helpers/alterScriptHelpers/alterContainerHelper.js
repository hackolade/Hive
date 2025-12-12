const _ = require('lodash');
const { getDatabaseStatement } = require('../databaseHelper');
const templates = require('./config/templates');

const hydrateDrop = container => {
	const { role } = container;
	return role?.code || role?.name;
};

const getAddContainerScript = container => {
	const dataContainer = [container.role || {}];
	const containerStatement = getDatabaseStatement(dataContainer);
	return containerStatement;
};

const getDeleteContainerScript = provider => container => {
	const hydratedDrop = hydrateDrop(container);
	return provider.dropDatabase(hydratedDrop);
};

const getModifyContainerPropertiesScripts = ({ provider, container }) => {
	const compMod = container.role?.compMod || {};
	const containerName = compMod.code?.new || compMod.name?.new;
	const containerProperties = ['description'];

	const { addProperties, dropProperties } = containerProperties.reduce(
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
		? provider.assignTemplates(templates.setContainerProperties, {
				name: containerName,
				properties: addProperties.join(', '),
			})
		: '';
	const dropScript = dropProperties.length
		? provider.assignTemplates(templates.unsetContainerProperties, {
				name: containerName,
				properties: dropProperties.join(', '),
			})
		: '';

	return [dropScript, addScript].filter(Boolean);
};

const getModifyContainerScript = provider => container => {
	const compMod = _.get(container, 'role.compMod', {});
	const getName = type => compMod.code?.[type] || compMod.name?.[type];
	const name = {
		new: getName('new'),
		old: getName('old'),
	};
	if (name.new === name.old) {
		const modifyContainerPropertiesScripts = getModifyContainerPropertiesScripts({ provider, container });
		return modifyContainerPropertiesScripts.length ? modifyContainerPropertiesScripts : [];
	}
	const hydratedDrop = hydrateDrop({ role: { ...(container?.role || {}), name: name.old } });
	const deletedScript = provider.dropDatabase(hydratedDrop);
	const addedScript = getAddContainerScript({ role: { ...(container?.role || {}), name: name.new } });

	return [deletedScript, addedScript];
};

module.exports = {
	getAddContainerScript,
	getDeleteContainerScript,
	getModifyContainerScript,
};
