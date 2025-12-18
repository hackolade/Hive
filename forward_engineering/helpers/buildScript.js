const sqlFormatter = require('sql-formatter');

const tryFormat = statement => {
	try {
		// Fails for complex types https://github.com/sql-formatter-org/sql-formatter/issues/735
		return sqlFormatter.format(statement, { language: 'spark', tabWidth: 4, linesBetweenQueries: 2 });
	} catch {
		return statement;
	}
};

const buildScript =
	needMinify =>
	(...statements) => {
		if (needMinify) {
			return statements.filter(Boolean).join('\n\n');
		}

		const script = statements.filter(Boolean).map(tryFormat).join('\n\n');

		return script + '\n';
	};

module.exports = {
	buildScript,
};
