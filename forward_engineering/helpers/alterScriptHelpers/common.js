const { dependencies } = require('../appDependencies');

let _;
const setDependencies = ({ lodash }) => (_ = lodash);

const getDifferentItems = (newItems = [], oldItems = []) => {
	setDependencies(dependencies);
	const intersection = _.intersectionWith(newItems, oldItems, _.isEqual);
	return {
		add: _.xorWith(newItems, intersection, _.isEqual),
		drop: _.xorWith(oldItems, intersection, _.isEqual),
	};
};

const hydrateTableProperties = ({ new: newItems, old: oldItems }, name, comment) => {
	setDependencies(dependencies);
	const hydrateProperties = properties => (properties || '').split(',').map(prop => prop.trim());
	const prepareProperties = properties =>
		properties
			.filter(Boolean)
			.map(property => property.replace(/(\S+)=(\S+)/, `'$1'='$2'`))
			.join(',\n');
	const commentNew = comment?.new && !_.isEqual(comment?.new, comment?.old) && comment.new;
	const preparePropertiesName = properties =>
		properties
			.map(prop => prop.replace(/(=\S+)/, ''))
			.map(property => `'${property}'`)
			.join(', ');
	const newHydrateItems = hydrateProperties(newItems);
	const oldHydrateItems = hydrateProperties(oldItems);
	const { add, drop } = getDifferentItems(newHydrateItems, oldHydrateItems);
	const dataProperties = {
		add: prepareProperties([...add, commentNew]),
		drop: preparePropertiesName(drop),
	};
	return { dataProperties, name };
};

const compareProperties = ({ new: newProperty, old: oldProperty }) => {
	setDependencies(dependencies);
	if (!newProperty && !oldProperty) {
		return;
	}
	return !_.isEqual(newProperty, oldProperty);
};

const getIsChangeProperties = (compMod, properties) =>
	properties.some(property => compareProperties(compMod[property] || {}));

module.exports = {
	hydrateTableProperties,
	getDifferentItems,
	getIsChangeProperties,
};
