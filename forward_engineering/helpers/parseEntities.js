const parseEntities = (entities, serializedItems) => {
	return entities.reduce((result, entityId) => {
		try {
			return { ...result, [entityId]: JSON.parse(serializedItems[entityId]) };
		} catch (e) {
			return result;
		}
	}, {});
};

module.exports = {
	parseEntities,
};
