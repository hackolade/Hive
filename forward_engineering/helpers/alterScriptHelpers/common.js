const _ = require('lodash');

const getDifferentItems = (newItems = [], oldItems = []) => {
	const intersection = _.intersectionWith(newItems, oldItems, _.isEqual);
	return {
		add: _.xorWith(newItems, intersection, _.isEqual),
		drop: _.xorWith(oldItems, intersection, _.isEqual),
	};
};

const hydrateTableProperties = ({ new: newItems, old: oldItems }, name, commentState) => {
	const hydrateProperties = properties => (properties || '').split(',').map(prop => prop.trim());
	const prepareProperties = properties =>
		properties
			.filter(Boolean)
			.map(property => property.replace(/(\S+)=([\s\S]+)/, `'$1'='$2'`))
			.join(',\n');

	const isCommentChanged = !_.isEqual(commentState?.new, commentState?.old);
	const addCommentProp = isCommentChanged && commentState?.new ? `comment=${commentState?.new}` : '';
	const dropCommentProp = isCommentChanged && !commentState?.new ? `comment` : '';

	const preparePropertiesName = properties =>
		properties
			.filter(Boolean)
			.map(prop => `'${prop.replace(/(=\S+)/, '')}'`)
			.join(', ');

	const newHydrateItems = hydrateProperties(newItems);
	const oldHydrateItems = hydrateProperties(oldItems);

	const { add, drop } = getDifferentItems(newHydrateItems, oldHydrateItems);

	const dataProperties = {
		add: prepareProperties([...add, addCommentProp]),
		drop: preparePropertiesName([...drop, dropCommentProp]),
	};

	return { dataProperties, name };
};

const compareProperties = ({ new: newProperty, old: oldProperty }) => {
	if (!newProperty && !oldProperty) {
		return;
	}
	return !_.isEqual(newProperty, oldProperty);
};

const getIsChangeProperties = (compMod, properties) =>
	properties.some(property => compareProperties(compMod[property] || {}));

const getItems = (entity, nameProperty, modify) =>
	[]
		.concat(entity.properties?.[nameProperty]?.properties?.[modify]?.items)
		.filter(Boolean)
		.map(items => Object.values(items.properties)[0]);

module.exports = {
	hydrateTableProperties,
	getDifferentItems,
	getIsChangeProperties,
	getItems,
};
