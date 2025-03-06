export type ColumnDefinition = {
  name: string;
  type: string;
  nullable: boolean;
  isActivated: boolean;
  length?: number;
  precision?: number;
  primaryKey?: boolean;
  scale?: number;
  timePrecision?: number;
  unique?: boolean;
  check?: string;
  properties?: Record<string, ColumnDefinition>;
};

export type ConstraintDtoColumn = {
  name: string;
  isActivated: boolean;
};

export type KeyType = 'PRIMARY KEY' | 'UNIQUE' | 'CHECK';

export type ConstraintDto = {
  keyType: KeyType;
  name: string;
  columns?: ConstraintDtoColumn[];
};

export type JsonSchema = Record<string, unknown>;
