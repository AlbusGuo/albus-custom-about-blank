import {
  type CachedMetadata,
  type TFile,
} from "obsidian";

export const CUSTOM_STAT_FILTER_CONJUNCTIONS = {
  and: "and",
  or: "or",
  not: "not",
} as const;

export type CustomStatFilterConjunction =
  typeof CUSTOM_STAT_FILTER_CONJUNCTIONS[keyof typeof CUSTOM_STAT_FILTER_CONJUNCTIONS];

export const CUSTOM_STAT_FILTER_NODE_KINDS = {
  condition: "condition",
  group: "group",
} as const;

export const CUSTOM_STAT_FILTER_FIELDS = {
  path: "file.path",
  parent: "file.parent",
  name: "file.name",
  basename: "file.basename",
  extension: "file.extension",
  createdAt: "file.ctime",
  modifiedAt: "file.mtime",
  tags: "tags",
} as const;

export type CustomStatFieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "multi-select";

export const CUSTOM_STAT_FILTER_OPERATORS = {
  is: "is",
  isNot: "isNot",
  contains: "contains",
  notContains: "notContains",
  containsAny: "containsAny",
  containsAll: "containsAll",
  startsWith: "startsWith",
  endsWith: "endsWith",
  regexMatch: "regexMatch",
  lessThan: "lessThan",
  lessThanOrEqual: "lessThanOrEqual",
  greaterThan: "greaterThan",
  greaterThanOrEqual: "greaterThanOrEqual",
  before: "before",
  onOrBefore: "onOrBefore",
  after: "after",
  onOrAfter: "onOrAfter",
  exists: "exists",
  notExists: "notExists",
} as const;

export type CustomStatFilterOperator =
  typeof CUSTOM_STAT_FILTER_OPERATORS[keyof typeof CUSTOM_STAT_FILTER_OPERATORS];

export interface CustomStatFilterCondition {
  kind: typeof CUSTOM_STAT_FILTER_NODE_KINDS.condition;
  id: string;
  field: string;
  operator: CustomStatFilterOperator;
  value: string;
}

export type CustomStatFilterNode = CustomStatFilterCondition | CustomStatFilterGroup;

export interface CustomStatFilterGroup {
  kind: typeof CUSTOM_STAT_FILTER_NODE_KINDS.group;
  id: string;
  conjunction: CustomStatFilterConjunction;
  conditions: CustomStatFilterNode[];
}

type LegacyCustomStatType = "folder" | "fileType";

export interface CustomStatDefinition {
  displayName: string;
  filters: CustomStatFilterGroup;
  type?: LegacyCustomStatType;
  value?: string;
}

export interface CustomStatFileContext {
  file: TFile;
  cache?: CachedMetadata | null;
}

const LEGACY_CONDITION_FIELDS: Record<string, string> = {
  folder: CUSTOM_STAT_FILTER_FIELDS.parent,
  fileType: CUSTOM_STAT_FILTER_FIELDS.extension,
  fileName: CUSTOM_STAT_FILTER_FIELDS.basename,
  tag: CUSTOM_STAT_FILTER_FIELDS.tags,
  createdAt: CUSTOM_STAT_FILTER_FIELDS.createdAt,
  modifiedAt: CUSTOM_STAT_FILTER_FIELDS.modifiedAt,
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isLegacyCustomStatType = (value: unknown): value is LegacyCustomStatType => {
  return value === "folder" || value === "fileType";
};

const isConjunction = (value: unknown): value is CustomStatFilterConjunction => {
  return value === CUSTOM_STAT_FILTER_CONJUNCTIONS.and
    || value === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
    || value === CUSTOM_STAT_FILTER_CONJUNCTIONS.not;
};

const isOperator = (value: unknown): value is CustomStatFilterOperator => {
  return typeof value === "string"
    && Object.values(CUSTOM_STAT_FILTER_OPERATORS).includes(
      value as CustomStatFilterOperator,
    );
};

const createConditionId = (): string => {
  return `custom-stat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const createGroupId = (): string => {
  return `custom-stat-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();
const normalizeExtension = (value: string): string => (
  normalizeText(value).replace(/^\./, "")
);
const normalizeTag = (value: string): string => (
  normalizeText(value).replace(/^#/, "")
);

const toConditionString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return "";
};

const splitConditionValues = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseDateValue = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T00:00:00`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getDateKey = (date: Date): string => {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const isValueMissing = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  return Array.isArray(value) && value.length === 0;
};

const getFrontmatterValue = (
  cache: CachedMetadata | null | undefined,
  field: string,
): unknown => {
  const frontmatter = cache?.frontmatter;
  if (!frontmatter || !field.trim()) {
    return undefined;
  }
  if (field in frontmatter) {
    return frontmatter[field];
  }
  const segments = field.split(".").map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = frontmatter;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const getFileTags = (cache: CachedMetadata | null | undefined): string[] => {
  const tags = new Set<string>();
  cache?.tags?.forEach((tag) => {
    const normalized = normalizeTag(tag.tag);
    if (normalized) {
      tags.add(normalized);
    }
  });
  const frontmatter: unknown = cache?.frontmatter;
  const frontmatterTags = isRecord(frontmatter) ? frontmatter.tags : undefined;
  const values = Array.isArray(frontmatterTags)
    ? frontmatterTags
    : typeof frontmatterTags === "string" ? [frontmatterTags] : [];
  values.forEach((tag) => {
    if (typeof tag === "string") {
      const normalized = normalizeTag(tag);
      if (normalized) {
        tags.add(normalized);
      }
    }
  });
  return Array.from(tags);
};

export const getCustomStatFieldValue = (
  context: CustomStatFileContext,
  field: string,
): unknown => {
  switch (field) {
    case CUSTOM_STAT_FILTER_FIELDS.path:
      return context.file.path;
    case CUSTOM_STAT_FILTER_FIELDS.parent:
      return context.file.parent?.path ?? "";
    case CUSTOM_STAT_FILTER_FIELDS.name:
      return context.file.name;
    case CUSTOM_STAT_FILTER_FIELDS.basename:
      return context.file.basename;
    case CUSTOM_STAT_FILTER_FIELDS.extension:
      return context.file.extension;
    case CUSTOM_STAT_FILTER_FIELDS.createdAt:
      return new Date(context.file.stat.ctime);
    case CUSTOM_STAT_FILTER_FIELDS.modifiedAt:
      return new Date(context.file.stat.mtime);
    case CUSTOM_STAT_FILTER_FIELDS.tags:
      return getFileTags(context.cache);
    default:
      return getFrontmatterValue(
        context.cache,
        field.startsWith("note.") ? field.slice(5) : field,
      );
  }
};

const matchesDate = (
  actualValue: unknown,
  operator: CustomStatFilterOperator,
  expectedValue: string,
): boolean => {
  const actual = parseDateValue(actualValue);
  const expected = parseDateValue(expectedValue);
  if (!actual || !expected) {
    return false;
  }
  switch (operator) {
    case CUSTOM_STAT_FILTER_OPERATORS.is:
      return getDateKey(actual) === getDateKey(expected);
    case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      return getDateKey(actual) !== getDateKey(expected);
    case CUSTOM_STAT_FILTER_OPERATORS.before:
      return actual.getTime() < expected.getTime();
    case CUSTOM_STAT_FILTER_OPERATORS.onOrBefore:
      return actual.getTime() <= expected.getTime();
    case CUSTOM_STAT_FILTER_OPERATORS.after:
      return actual.getTime() > expected.getTime();
    case CUSTOM_STAT_FILTER_OPERATORS.onOrAfter:
      return actual.getTime() >= expected.getTime();
    default:
      return false;
  }
};

const matchesNumber = (
  actualValue: unknown,
  operator: CustomStatFilterOperator,
  expectedValue: string,
): boolean => {
  const actual = typeof actualValue === "number"
    ? actualValue
    : Number(toConditionString(actualValue));
  const expected = Number(expectedValue);
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return false;
  }
  switch (operator) {
    case CUSTOM_STAT_FILTER_OPERATORS.is:
      return actual === expected;
    case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      return actual !== expected;
    case CUSTOM_STAT_FILTER_OPERATORS.lessThan:
      return actual < expected;
    case CUSTOM_STAT_FILTER_OPERATORS.lessThanOrEqual:
      return actual <= expected;
    case CUSTOM_STAT_FILTER_OPERATORS.greaterThan:
      return actual > expected;
    case CUSTOM_STAT_FILTER_OPERATORS.greaterThanOrEqual:
      return actual >= expected;
    default:
      return false;
  }
};

const matchesTextOrList = (
  actualValue: unknown,
  operator: CustomStatFilterOperator,
  expectedValue: string,
  normalizer: (value: string) => string = normalizeText,
): boolean => {
  const expectedItems = splitConditionValues(expectedValue).map(normalizer);
  const expected = normalizer(expectedValue);
  const actualItems = Array.isArray(actualValue)
    ? actualValue.map((item) => normalizer(toConditionString(item))).filter(Boolean)
    : [normalizer(toConditionString(actualValue))].filter(Boolean);
  const actual = actualItems[0] ?? "";
  switch (operator) {
    case CUSTOM_STAT_FILTER_OPERATORS.is:
      return Array.isArray(actualValue)
        ? expectedItems.some((item) => actualItems.includes(item))
        : actual === expected;
    case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      return Array.isArray(actualValue)
        ? expectedItems.every((item) => !actualItems.includes(item))
        : actual !== expected;
    case CUSTOM_STAT_FILTER_OPERATORS.contains:
      return Array.isArray(actualValue)
        ? expectedItems.some((item) => actualItems.includes(item))
        : actual.includes(expected);
    case CUSTOM_STAT_FILTER_OPERATORS.notContains:
      return Array.isArray(actualValue)
        ? expectedItems.every((item) => !actualItems.includes(item))
        : !actual.includes(expected);
    case CUSTOM_STAT_FILTER_OPERATORS.containsAny:
      return expectedItems.some((item) => (
        Array.isArray(actualValue)
          ? actualItems.includes(item)
          : actual.includes(item)
      ));
    case CUSTOM_STAT_FILTER_OPERATORS.containsAll:
      return expectedItems.length > 0 && expectedItems.every((item) => (
        Array.isArray(actualValue)
          ? actualItems.includes(item)
          : actual.includes(item)
      ));
    case CUSTOM_STAT_FILTER_OPERATORS.startsWith:
      return actualItems.some((item) => item.startsWith(expected));
    case CUSTOM_STAT_FILTER_OPERATORS.endsWith:
      return actualItems.some((item) => item.endsWith(expected));
    case CUSTOM_STAT_FILTER_OPERATORS.regexMatch:
      try {
        return actualItems.some((item) => new RegExp(expectedValue, "i").test(item));
      } catch {
        return false;
      }
    default:
      return false;
  }
};

export const createCustomStatFilterCondition = (
  field: string = CUSTOM_STAT_FILTER_FIELDS.parent,
  fieldType: CustomStatFieldType = "text",
): CustomStatFilterCondition => ({
  kind: CUSTOM_STAT_FILTER_NODE_KINDS.condition,
  id: createConditionId(),
  field,
  operator: getDefaultOperatorForFieldType(fieldType),
  value: "",
});

export const createCustomStatFilterGroup = (): CustomStatFilterGroup => ({
  kind: CUSTOM_STAT_FILTER_NODE_KINDS.group,
  id: createGroupId(),
  conjunction: CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
  conditions: [createCustomStatFilterCondition()],
});

export const createCustomStatDefinition = (): CustomStatDefinition => ({
  displayName: "",
  filters: {
    ...createCustomStatFilterGroup(),
    conditions: [],
  },
});

export const isCustomStatComplete = (stat: CustomStatDefinition): boolean => {
  if (!stat.displayName.trim()) {
    return false;
  }
  let conditionCount = 0;
  const isGroupComplete = (group: CustomStatFilterGroup): boolean => {
    return group.conditions.every((node) => {
      if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group) {
        return node.conditions.length > 0 && isGroupComplete(node);
      }
      conditionCount += 1;
      return Boolean(
        node.field.trim()
        && (
          isOperatorValueOptional(node.operator)
          || node.value.trim()
        ),
      );
    });
  };
  return isGroupComplete(stat.filters) && conditionCount > 0;
};

export const getDefaultOperatorForFieldType = (
  fieldType: CustomStatFieldType,
): CustomStatFilterOperator => {
  return fieldType === "multi-select"
    ? CUSTOM_STAT_FILTER_OPERATORS.contains
    : CUSTOM_STAT_FILTER_OPERATORS.is;
};

export const getOperatorsForFieldType = (
  fieldType: CustomStatFieldType,
): CustomStatFilterOperator[] => {
  const presence = [
    CUSTOM_STAT_FILTER_OPERATORS.exists,
    CUSTOM_STAT_FILTER_OPERATORS.notExists,
  ];
  if (fieldType === "number") {
    return [
      CUSTOM_STAT_FILTER_OPERATORS.is,
      CUSTOM_STAT_FILTER_OPERATORS.isNot,
      CUSTOM_STAT_FILTER_OPERATORS.lessThan,
      CUSTOM_STAT_FILTER_OPERATORS.lessThanOrEqual,
      CUSTOM_STAT_FILTER_OPERATORS.greaterThan,
      CUSTOM_STAT_FILTER_OPERATORS.greaterThanOrEqual,
      ...presence,
    ];
  }
  if (fieldType === "boolean") {
    return [
      CUSTOM_STAT_FILTER_OPERATORS.is,
      CUSTOM_STAT_FILTER_OPERATORS.isNot,
      ...presence,
    ];
  }
  if (fieldType === "date") {
    return [
      CUSTOM_STAT_FILTER_OPERATORS.is,
      CUSTOM_STAT_FILTER_OPERATORS.isNot,
      CUSTOM_STAT_FILTER_OPERATORS.before,
      CUSTOM_STAT_FILTER_OPERATORS.onOrBefore,
      CUSTOM_STAT_FILTER_OPERATORS.after,
      CUSTOM_STAT_FILTER_OPERATORS.onOrAfter,
      ...presence,
    ];
  }
  if (fieldType === "multi-select") {
    return [
      CUSTOM_STAT_FILTER_OPERATORS.contains,
      CUSTOM_STAT_FILTER_OPERATORS.notContains,
      CUSTOM_STAT_FILTER_OPERATORS.containsAny,
      CUSTOM_STAT_FILTER_OPERATORS.containsAll,
      CUSTOM_STAT_FILTER_OPERATORS.is,
      CUSTOM_STAT_FILTER_OPERATORS.isNot,
      ...presence,
    ];
  }
  return [
    CUSTOM_STAT_FILTER_OPERATORS.is,
    CUSTOM_STAT_FILTER_OPERATORS.isNot,
    CUSTOM_STAT_FILTER_OPERATORS.contains,
    CUSTOM_STAT_FILTER_OPERATORS.notContains,
    CUSTOM_STAT_FILTER_OPERATORS.startsWith,
    CUSTOM_STAT_FILTER_OPERATORS.endsWith,
    CUSTOM_STAT_FILTER_OPERATORS.regexMatch,
    ...presence,
  ];
};

export const isOperatorValueOptional = (operator: CustomStatFilterOperator): boolean => {
  return operator === CUSTOM_STAT_FILTER_OPERATORS.exists
    || operator === CUSTOM_STAT_FILTER_OPERATORS.notExists;
};

const legacyFieldFromCondition = (value: Record<string, unknown>): string => {
  const type = typeof value.type === "string" ? value.type : "";
  if (type === "frontmatter") {
    const key = typeof value.key === "string" ? value.key.trim() : "";
    return key ? `note.${key}` : "";
  }
  return LEGACY_CONDITION_FIELDS[type] ?? CUSTOM_STAT_FILTER_FIELDS.parent;
};

const normalizeField = (field: string): string => {
  const normalized = field.trim();
  if (
    !normalized
    || normalized.startsWith("file.")
    || normalized.startsWith("note.")
    || normalized === CUSTOM_STAT_FILTER_FIELDS.tags
  ) {
    return normalized;
  }
  return `note.${normalized}`;
};

const normalizeCondition = (value: Record<string, unknown>): CustomStatFilterCondition => ({
  kind: CUSTOM_STAT_FILTER_NODE_KINDS.condition,
  id: typeof value.id === "string" && value.id.trim()
    ? value.id
    : createConditionId(),
  field: typeof value.field === "string" && value.field.trim()
    ? normalizeField(value.field)
    : legacyFieldFromCondition(value),
  operator: isOperator(value.operator)
    ? value.operator
    : CUSTOM_STAT_FILTER_OPERATORS.is,
  value: typeof value.value === "string" ? value.value : "",
});

const normalizeNode = (value: unknown): CustomStatFilterNode | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (Array.isArray(value.conditions) || Array.isArray(value.items)) {
    return normalizeCustomStatFilterGroup(value);
  }
  return normalizeCondition(value);
};

export const normalizeCustomStatFilterGroup = (value: unknown): CustomStatFilterGroup => {
  if (!isRecord(value)) {
    return createCustomStatFilterGroup();
  }
  const rawConditions = Array.isArray(value.conditions)
    ? value.conditions
    : Array.isArray(value.items) ? value.items : [];
  const conditions = rawConditions
    .map((condition) => normalizeNode(condition))
    .filter((condition): condition is CustomStatFilterNode => condition !== null);
  return {
    kind: CUSTOM_STAT_FILTER_NODE_KINDS.group,
    id: typeof value.id === "string" && value.id.trim()
      ? value.id
      : createGroupId(),
    conjunction: isConjunction(value.conjunction)
      ? value.conjunction
      : value.join === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
        ? CUSTOM_STAT_FILTER_CONJUNCTIONS.or
        : value.join === CUSTOM_STAT_FILTER_CONJUNCTIONS.not
          ? CUSTOM_STAT_FILTER_CONJUNCTIONS.not
        : CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
    conditions: conditions.length > 0
      ? conditions
      : [createCustomStatFilterCondition()],
  };
};

export const isCustomStatFilterCondition = (
  value: unknown,
): value is CustomStatFilterCondition => {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.field === "string"
    && isOperator(value.operator)
    && typeof value.value === "string";
};

export const isCustomStatFilterGroup = (value: unknown): value is CustomStatFilterGroup => {
  return isRecord(value)
    && typeof value.id === "string"
    && isConjunction(value.conjunction)
    && Array.isArray(value.conditions)
    && value.conditions.every((node) => (
      isCustomStatFilterCondition(node) || isCustomStatFilterGroup(node)
    ));
};

export const isCustomStatDefinition = (value: unknown): value is CustomStatDefinition => {
  if (!isRecord(value) || typeof value.displayName !== "string") {
    return false;
  }
  return isCustomStatFilterGroup(value.filters)
    || (isLegacyCustomStatType(value.type) && typeof value.value === "string");
};

export const toCustomStatFilterGroup = (
  stat: Partial<CustomStatDefinition>,
): CustomStatFilterGroup => {
  if (isCustomStatFilterGroup(stat.filters)) {
    return stat.filters;
  }
  if (stat.filters) {
    return normalizeCustomStatFilterGroup(stat.filters);
  }
  if (isLegacyCustomStatType(stat.type) && typeof stat.value === "string") {
    const field = stat.type === "folder"
      ? CUSTOM_STAT_FILTER_FIELDS.parent
      : CUSTOM_STAT_FILTER_FIELDS.extension;
    return {
      ...createCustomStatFilterGroup(),
      conditions: [{
        ...createCustomStatFilterCondition(field),
        value: stat.value,
      }],
    };
  }
  return createCustomStatFilterGroup();
};

export const normalizeCustomStatDefinition = (
  value: unknown,
): CustomStatDefinition | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    displayName: typeof value.displayName === "string" ? value.displayName : "",
    filters: toCustomStatFilterGroup(value as Partial<CustomStatDefinition>),
  };
};

export const normalizeCustomStatDefinitions = (value: unknown): CustomStatDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeCustomStatDefinition(item))
    .filter((item): item is CustomStatDefinition => item !== null);
};

export const matchesCustomStatCondition = (
  context: CustomStatFileContext,
  condition: CustomStatFilterCondition,
): boolean => {
  const actualValue = getCustomStatFieldValue(context, condition.field);
  if (condition.operator === CUSTOM_STAT_FILTER_OPERATORS.exists) {
    return !isValueMissing(actualValue);
  }
  if (condition.operator === CUSTOM_STAT_FILTER_OPERATORS.notExists) {
    return isValueMissing(actualValue);
  }
  if (isValueMissing(actualValue)) {
    return false;
  }
  if (
    condition.operator === CUSTOM_STAT_FILTER_OPERATORS.before
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrBefore
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.after
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrAfter
  ) {
    return matchesDate(actualValue, condition.operator, condition.value);
  }
  if (
    condition.operator === CUSTOM_STAT_FILTER_OPERATORS.lessThan
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.lessThanOrEqual
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.greaterThan
    || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.greaterThanOrEqual
    || typeof actualValue === "number"
  ) {
    const numericResult = matchesNumber(actualValue, condition.operator, condition.value);
    if (numericResult || typeof actualValue === "number") {
      return numericResult;
    }
  }
  if (actualValue instanceof Date) {
    return matchesDate(actualValue, condition.operator, condition.value);
  }
  const normalizer = condition.field === CUSTOM_STAT_FILTER_FIELDS.extension
    ? normalizeExtension
    : condition.field === CUSTOM_STAT_FILTER_FIELDS.tags
      ? normalizeTag
      : normalizeText;
  return matchesTextOrList(
    actualValue,
    condition.operator,
    condition.value,
    normalizer,
  );
};

export const matchesCustomStatFilterNode = (
  context: CustomStatFileContext,
  node: CustomStatFilterNode,
): boolean => {
  return node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group
    ? matchesCustomStatFilterGroup(context, node)
    : matchesCustomStatCondition(context, node);
};

export const matchesCustomStatFilterGroup = (
  context: CustomStatFileContext,
  group: CustomStatFilterGroup,
): boolean => {
  if (group.conditions.length === 0) {
    return false;
  }
  const results = group.conditions.map((node) => (
    matchesCustomStatFilterNode(context, node)
  ));
  return group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
    ? results.some(Boolean)
    : group.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.not
      ? results.every((result) => !result)
    : results.every(Boolean);
};

export const findFirstCustomStatCondition = (
  group: CustomStatFilterGroup,
): CustomStatFilterCondition | null => {
  for (const node of group.conditions) {
    if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition) {
      return node;
    }
    const nested = findFirstCustomStatCondition(node);
    if (nested) {
      return nested;
    }
  }
  return null;
};

export const countCustomStatFilterConditions = (
  group: CustomStatFilterGroup,
): number => {
  return group.conditions.reduce((count, node) => {
    return count + (
      node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition
        ? 1
        : countCustomStatFilterConditions(node)
    );
  }, 0);
};

export const matchesCustomStatDefinition = (
  context: CustomStatFileContext,
  stat: CustomStatDefinition,
): boolean => {
  return matchesCustomStatFilterGroup(context, toCustomStatFilterGroup(stat));
};
