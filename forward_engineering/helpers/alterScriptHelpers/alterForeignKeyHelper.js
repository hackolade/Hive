const { getFullEntityName } = require('./generalHelper');
const { prepareName, commentDeactivatedStatements } = require('../generalHelper');

const templates = require('./config/templates');
const { getItems } = require('./common');

const getRelationshipName = relationship => {
	return relationship.role.code || relationship.role.name;
};

const getFullParentTableName = relationship => {
	const compMod = relationship.role.compMod;

	const parentDBName = prepareName(compMod.parent.bucket.name);
	const parentEntityName = prepareName(compMod.parent.collection.name);

	return getFullEntityName(parentDBName, parentEntityName);
};

const getFullChildTableName = relationship => {
	const compMod = relationship.role.compMod;

	const childDBName = prepareName(compMod.child.bucket.name);
	const childEntityName = prepareName(compMod.child.collection.name);
	return getFullEntityName(childDBName, childEntityName);
};

const getAddSingleForeignKeyScript = provider => relationship => {
	const compMod = relationship.role.compMod;
	const parentTableName = getFullParentTableName(relationship);
	const childTableName = getFullChildTableName(relationship);

	const relationshipName = compMod.code?.new || compMod.name?.new || getRelationshipName(relationship) || '';
	const constraintName = prepareName(relationshipName);
	const childColumns = compMod.child.collection.fkFields.map(field => prepareName(field.name));
	const parentColumns = compMod.parent.collection.fkFields.map(field => prepareName(field.name));
	const disableNoValidate = relationship.role?.compMod?.customProperties?.new?.disableNoValidate;
	const disableNoValidateClause = disableNoValidate ? ' DISABLE NOVALIDATE' : '';

	return provider.assignTemplates(templates.addFkConstraint, {
		childTableName,
		constraintName,
		childColumns,
		parentTableName,
		parentColumns,
		disableNoValidate: disableNoValidateClause,
	});
};

const canRelationshipBeAdded = relationship => {
	const compMod = relationship.role.compMod;
	if (!compMod) {
		return false;
	}
	return [
		compMod.code?.new || compMod.name?.new || getRelationshipName(relationship),
		compMod.parent?.bucket,
		compMod.parent?.collection,
		compMod.parent?.collection?.fkFields?.length,
		compMod.child?.bucket,
		compMod.child?.collection,
		compMod.child?.collection?.fkFields?.length,
	].every(Boolean);
};

const getAddForeignKeyScript = provider => relationship => {
	const script = getAddSingleForeignKeyScript(provider)(relationship);
	const isActivated = Boolean(relationship.role?.compMod?.isActivated?.new);

	return commentDeactivatedStatements(script, isActivated);
};

const getDeleteSingleForeignKeyScript = provider => relationship => {
	const compMod = relationship.role.compMod;
	const tableName = getFullChildTableName(relationship);
	const relationshipName = compMod.code?.old || compMod.name?.old || getRelationshipName(relationship) || '';
	const constraintName = prepareName(relationshipName);

	return provider.assignTemplates(templates.dropConstraint, {
		tableName,
		constraintName,
	});
};

const canRelationshipBeDeleted = relationship => {
	const compMod = relationship.role.compMod;
	if (!compMod) {
		return false;
	}
	return [
		compMod.code?.old || compMod.name?.old || getRelationshipName(relationship),
		compMod.child?.bucket,
		compMod.child?.collection,
	].every(Boolean);
};

const getDeleteForeignKeyScripts = provider => deletedRelationships => {
	return deletedRelationships
		.filter(relationship => canRelationshipBeDeleted(relationship))
		.map(relationship => {
			const script = getDeleteSingleForeignKeyScript(provider)(relationship);
			const isActivated = Boolean(relationship.role?.compMod?.isActivated?.new);

			return commentDeactivatedStatements(script, isActivated);
		});
};

const getModifyForeignKeyScript = provider => relationship => {
	const deleteScript = getDeleteSingleForeignKeyScript(provider)(relationship);
	const addScript = getAddSingleForeignKeyScript(provider)(relationship);
	const isActivated = Boolean(relationship.role?.compMod?.isActivated?.new);

	return (
		commentDeactivatedStatements(deleteScript, isActivated) + commentDeactivatedStatements(addScript, isActivated)
	);
};

const getAlterForeignKeyScripts = ({ schema, provider, currentSchemaName, ignoreRelationshipIDs = [] }) => {
	const generateAddFkScripts = (addedRelationships, getScript) => {
		return addedRelationships.filter(relationship => canRelationshipBeAdded(relationship)).flatMap(getScript);
	};

	const generateModifyFkScripts = (modifiedRelationships, getScript) => {
		return modifiedRelationships
			.filter(relationship => canRelationshipBeAdded(relationship) && canRelationshipBeDeleted(relationship))
			.flatMap(getScript);
	};

	const deletedRelationships = getItems(schema, 'relationships', 'deleted').filter(
		relationship => relationship.role?.compMod?.deleted && !ignoreRelationshipIDs.includes(relationship?.role?.id),
	);
	const addedRelationships = getItems(schema, 'relationships', 'added').filter(
		relationship => relationship.role?.compMod?.created && !ignoreRelationshipIDs.includes(relationship?.role?.id),
	);
	const modifiedRelationships = getItems(schema, 'relationships', 'modified');

	const deleteFkScripts = getDeleteForeignKeyScripts(provider)(deletedRelationships);
	const addFkScripts = generateAddFkScripts(addedRelationships, getAddForeignKeyScript(provider));
	const modifiedFkScripts = generateModifyFkScripts(modifiedRelationships, getModifyForeignKeyScript(provider));
	return { deleteFkScripts, addFkScripts, modifiedFkScripts };
};

module.exports = {
	getAlterForeignKeyScripts,
};
