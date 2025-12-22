const buildScript = (...statements) => {
	return statements.filter(Boolean).join('\n\n');
};

module.exports = {
	buildScript,
};
