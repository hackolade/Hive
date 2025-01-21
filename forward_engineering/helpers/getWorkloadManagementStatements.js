const _ = require('lodash');
const { prepareName } = require('./generalHelper');

const getMappingNameToPoolNameHashTable = pools => {
	return _.fromPairs(
		_.flatten(
			pools.map(pool => {
				const mappings = _.get(pool, 'mappings', []).filter(mapping => mapping.name);

				return mappings.map(mapping => [mapping.name, pool.name]);
			}),
		),
	);
};

const getWorkloadManagementStatements = modelData => {
	const resourcePlansData = _.get(_.first(modelData), 'resourcePlans', []);

	return resourcePlansData
		.filter(resourcePlan => resourcePlan.name)
		.map(resourcePlan => {
			const resourcePlanOptionsString = _.isUndefined(resourcePlan.parallelism)
				? ''
				: ` WITH QUERY_PARALLELISM = ${resourcePlan.parallelism}`;
			const resourcePlanStatement = `CREATE RESOURCE PLAN ${prepareName(
				resourcePlan.name,
			)}${resourcePlanOptionsString};`;
			const pools = _.get(resourcePlan, 'pools', []).filter(pool => pool.name);
			const mappingNameToPoolNameHashTable = getMappingNameToPoolNameHashTable(pools);
			const mappings = pools.flatMap(pool => _.get(pool, 'mappings', []).filter(mapping => mapping.name));
			const triggers = _.get(resourcePlan, 'triggers', []).filter(trigger => trigger.name);
			const poolsStatements = pools
				.filter(pool => _.toUpper(pool.name) !== 'DEFAULT')
				.map(pool => {
					let poolOptions = [];
					if (!_.isUndefined(pool.allocFraction)) {
						poolOptions.push(`ALLOC_FRACTION = ${pool.allocFraction}`);
					}
					if (!_.isUndefined(pool.parallelism)) {
						poolOptions.push(`QUERY_PARALLELISM = ${pool.parallelism}`);
					}
					if (!_.isUndefined(pool.schedulingPolicy) && pool.schedulingPolicy !== 'default') {
						poolOptions.push(`SCHEDULING_POLICY = '${pool.schedulingPolicy}'`);
					}
					const poolOptionsString = _.isEmpty(poolOptions) ? '' : ` WITH ${poolOptions.join(', ')}`;
					return `CREATE POOL ${prepareName(resourcePlan.name)}.${prepareName(
						pool.name,
					)}${poolOptionsString};`;
				});

			const mappingsStatements = mappings.map(mapping => {
				return `CREATE ${_.toUpper(mapping.mappingType || 'application')} MAPPING '${prepareName(
					mapping.name,
				)}' IN ${prepareName(resourcePlan.name)} TO ${prepareName(
					mappingNameToPoolNameHashTable[mapping.name],
				)};`;
			});

			const triggersStatements = triggers.map(trigger => {
				return `CREATE TRIGGER ${prepareName(resourcePlan.name)}.${prepareName(trigger.name)} WHEN ${
					trigger.condition
				} DO ${trigger.action};`;
			});

			return [resourcePlanStatement, ...poolsStatements, ...mappingsStatements, ...triggersStatements].join(
				'\n\n',
			);
		});
};

module.exports = {
	getWorkloadManagementStatements,
};
