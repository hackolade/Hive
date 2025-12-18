const parseEntities = (entities, serializedItems) => {
	return entities.reduce((result, entityId) => {
		try {
			return { ...result, [entityId]: JSON.parse(serializedItems[entityId]) };
		} catch {
			return result;
		}
	}, {});
};

module.exports = {
	parseEntities,
};
