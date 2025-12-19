const _ = require('lodash');
const RESERVED_WORDS = require('./reserverWords');

const BEFORE_DEACTIVATED_STATEMENT = '-- ';

const buildStatement = (mainStatement, isActivated) => {
	let composeStatements = (...statements) => {
		return statements.reduce((result, statement) => result + statement, mainStatement);
	};

	const chain = (...args) => {
		if (args.length) {
			composeStatements = composeStatements.bind(null, getStatement(...args));

			return chain;
		}

		return commentDeactivatedStatements(composeStatements(), isActivated);
	};

	const getStatement = (condition, statement) => {
		if (statement === ')') {
			return '\n)';
		}
		if (statement === ';') {
			return statement;
		}

		if (condition) {
			return '\n' + indentString(statement);
		}

		return '';
	};

	return chain;
};

const isEscaped = name => /`[\s\S]*`/.test(name);

const checkNameNeedBackticks = name => !/^\w*$/.test(name) || name.startsWith('_');

const isReserved = name => RESERVED_WORDS.includes(name.toLowerCase());

const prepareName = (name = '') => {
	if ((checkNameNeedBackticks(name) && !isEscaped(name)) || isReserved(name)) {
		return `\`${name}\``;
	}
	return name;
};

const getName = entity =>
	entity.compMod?.code?.new ||
	entity.code ||
	entity.compMod?.collectionName?.new ||
	entity.collectionName ||
	entity.compMod?.name?.new ||
	entity.name ||
	'';

const getTab = (tabNum, configData) => (Array.isArray(configData) ? configData[tabNum] || {} : {});
const indentString = (str, tab = 4) =>
	(str || '')
		.split('\n')
		.map(s => ' '.repeat(tab) + s)
		.join('\n');

const descriptors = {};
const getTypeDescriptor = typeName => {
	if (descriptors[typeName]) {
		return descriptors[typeName];
	}

	try {
		descriptors[typeName] = require(`../../types/${typeName}.json`);

		return descriptors[typeName];
	} catch {
		return {};
	}
};

const commentDeactivatedStatements = (statement, isActivated = true) => {
	if (isActivated) {
		return statement;
	}
	const insertBeforeEachLine = (statement, insertValue) =>
		statement
			.split('\n')
			.map(line => `${insertValue}${line}`)
			.join('\n');

	return insertBeforeEachLine(statement, BEFORE_DEACTIVATED_STATEMENT);
};

const commentDeactivatedInlineKeys = (keys, deactivatedKeyNames) => {
	const [activatedKeys, deactivatedKeys] = _.partition(
		keys,
		key => !(deactivatedKeyNames.has(key) || deactivatedKeyNames.has(key.slice(1, -1))),
	);
	if (activatedKeys.length === 0) {
		return { isAllKeysDeactivated: true, keysString: deactivatedKeys.join(', ') };
	}
	if (deactivatedKeys.length === 0) {
		return { isAllKeysDeactivated: false, keysString: activatedKeys.join(', ') };
	}

	return {
		isAllKeysDeactivated: false,
		keysString: `${activatedKeys.join(', ')} /*, ${deactivatedKeys.join(', ')} */`,
	};
};

const removeRedundantTrailingCommaFromStatement = statement => {
	const statements = statement.split('\n');
	if (statements.length < 4 || !statements[statements.length - 2].trim().startsWith('--')) {
		return statement;
	}
	const lineWithTrailingCommaIndex = _.findLastIndex(statements, line => {
		if (line.trim() !== ');' && !line.trim().startsWith('--')) {
			return true;
		}
	});
	if (lineWithTrailingCommaIndex !== -1) {
		statements[lineWithTrailingCommaIndex] = `${statements[lineWithTrailingCommaIndex].slice(0, -1)} -- ,`;
		return statements.join('\n');
	}
	return statement;
};

const encodeStringLiteral = (str = '') => {
	return str.replace(/(')/gi, '\\$1').replace(/\n/gi, '\\n');
};

const isDeactivatedStatement = statement => statement.startsWith(BEFORE_DEACTIVATED_STATEMENT);

const stripParentheses = str => {
	if (typeof str !== 'string') {
		return str;
	}
	let result = str.trim();
	if (result.startsWith('(')) {
		result = result.slice(1);
	}
	if (result.endsWith(')')) {
		result = result.slice(0, -1);
	}
	return result;
};

module.exports = {
	buildStatement,
	getName,
	getTab,
	indentString,
	getTypeDescriptor,
	prepareName,
	commentDeactivatedStatements,
	commentDeactivatedInlineKeys,
	removeRedundantTrailingCommaFromStatement,
	encodeStringLiteral,
	isDeactivatedStatement,
	stripParentheses,
};
