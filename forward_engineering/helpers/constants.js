module.exports = {
	DROP_STATEMENTS: ['DROP INDEX', 'DROP VIEW', 'DROP TABLE', 'DROP DATABASE', 'DROP MATERIALIZED VIEW'],
	CONSTRAINT_POSTFIX: {
		primaryKey: 'pk',
		foreignKey: 'fk',
		uniqueKey: 'uk',
		notNull: 'nn',
		check: 'check',
		default: 'default',
	},
};
