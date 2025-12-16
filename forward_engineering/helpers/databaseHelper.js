const { buildStatement, getName, getTab, prepareName, encodeStringLiteral } = require('./generalHelper');

const getCreateStatement = ({ name, comment, location, dbProperties, isActivated, ifNotExist }) =>
	buildStatement(`CREATE DATABASE ${ifNotExist ? 'IF NOT EXISTS ' : ''}${name}`, isActivated)(
		comment,
		`COMMENT '${encodeStringLiteral(comment)}'`,
	)(location, `LOCATION "${location}"`)(dbProperties, `WITH DBPROPERTIES (${dbProperties})`)(true, ';')();

const getDatabaseStatement = containerData => {
	const tab = getTab(0, containerData);
	const name = prepareName(getName(tab));
	if (!name) {
		return '';
	}

	return getCreateStatement({
		name: name,
		comment: tab.description,
		isActivated: tab.isActivated,
		ifNotExist: tab.ifNotExist,
	});
};

module.exports = {
	getDatabaseStatement,
};
