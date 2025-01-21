const sqlFormatter = require('sql-formatter');

const buildScript =
	needMinify =>
	(...statements) => {
		const script = statements.filter(statement => statement).join('\n\n');
		if (needMinify) {
			return script;
		}

		return sqlFormatter.format(script, { language: 'spark', indent: '    ', linesBetweenQueries: 2 }) + '\n';
	};

module.exports = {
	buildScript,
};
