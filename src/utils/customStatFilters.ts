import {
  type CachedMetadata,
  type TFile,
} from "obsidian";

// =============================================================================

export const CUSTOM_STAT_FILTER_CONJUNCTIONS = {
  and: "and",
  or: "or",
} as const;

export type CustomStatFilterConjunction =
  typeof CUSTOM_STAT_FILTER_CONJUNCTIONS[keyof typeof CUSTOM_STAT_FILTER_CONJUNCTIONS];

export const CUSTOM_STAT_FILTER_CONDITION_TYPES = {
  folder: "folder",
  fileType: "fileType",
  fileName: "fileName",
  tag: "tag",
  createdAt: "createdAt",
  modifiedAt: "modifiedAt",
  frontmatter: "frontmatter",
} as const;

export type CustomStatFilterConditionType =
  typeof CUSTOM_STAT_FILTER_CONDITION_TYPES[keyof typeof CUSTOM_STAT_FILTER_CONDITION_TYPES];

export const CUSTOM_STAT_FILTER_OPERATORS = {
  is: "is",
  isNot: "isNot",
  contains: "contains",
  notContains: "notContains",
  startsWith: "startsWith",
  endsWith: "endsWith",
  regexMatch: "regexMatch",
  before: "before",
  onOrBefore: "onOrBefore",
  after: "after",
  onOrAfter: "onOrAfter",
  exists: "exists",
  notExists: "notExists",
} as const;

export type CustomStatFilterOperator =
  typeof CUSTOM_STAT_FILTER_OPERATORS[keyof typeof CUSTOM_STAT_FILTER_OPERATORS];

export const CUSTOM_STAT_FILTER_NODE_KINDS = {
  condition: "condition",
  group: "group",
} as const;

export type CustomStatFilterNodeKind =
  typeof CUSTOM_STAT_FILTER_NODE_KINDS[keyof typeof CUSTOM_STAT_FILTER_NODE_KINDS];

export type LegacyCustomStatType = "folder" | "fileType";

export interface CustomStatFilterCondition {
  kind: typeof CUSTOM_STAT_FILTER_NODE_KINDS.condition;
  id: string;
  type: CustomStatFilterConditionType;
  key: string;
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

// =============================================================================

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isLegacyCustomStatType = (value: unknown): value is LegacyCustomStatType => {
  return value === "folder" || value === "fileType";
};

const isConditionType = (value: unknown): value is CustomStatFilterConditionType => {
  return typeof value === "string"
    && Object.values(CUSTOM_STAT_FILTER_CONDITION_TYPES).includes(value as CustomStatFilterConditionType);
};

const isConjunction = (value: unknown): value is CustomStatFilterConjunction => {
  return typeof value === "string"
    && Object.values(CUSTOM_STAT_FILTER_CONJUNCTIONS).includes(value as CustomStatFilterConjunction);
};

const isOperator = (value: unknown): value is CustomStatFilterOperator => {
  return typeof value === "string"
    && Object.values(CUSTOM_STAT_FILTER_OPERATORS).includes(value as CustomStatFilterOperator);
};

const isNodeKind = (value: unknown): value is CustomStatFilterNodeKind => {
  return typeof value === "string"
    && Object.values(CUSTOM_STAT_FILTER_NODE_KINDS).includes(value as CustomStatFilterNodeKind);
};

const createConditionId = (): string => {
  return `custom-stat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const createGroupId = (): string => {
  return `custom-stat-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeExtension = (value: string): string => {
  return value.trim().replace(/^\./, "").toLowerCase();
};

const normalizeTag = (value: string): string => {
  return value.trim().replace(/^#/, "").toLowerCase();
};

const normalizeText = (value: string): string => {
  return value.trim().toLowerCase();
};

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

const parseDateValue = (value: unknown): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
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
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
};

const isValueMissing = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
};

const splitConditionValues = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const getFolderPath = (file: TFile): string => {
  return file.path.split("/").slice(0, -1).join("/");
};

const getFrontmatterValue = (cache: CachedMetadata | null | undefined, key: string): unknown => {
  const frontmatter = cache?.frontmatter;
  if (!frontmatter || !key.trim()) {
    return undefined;
  }

  const pathSegments = key
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  let current: unknown = frontmatter;

  for (const segment of pathSegments) {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
};

const getFileTags = (cache: CachedMetadata | null | undefined): string[] => {
  const tagSet = new Set<string>();

  cache?.tags?.forEach((tag) => {
    if (typeof tag.tag === "string") {
      const normalized = normalizeTag(tag.tag);
      if (normalized) {
        tagSet.add(normalized);
      }
    }
  });

  const frontmatterTags = cache?.frontmatter?.tags;
  const rawTags = Array.isArray(frontmatterTags)
    ? frontmatterTags
    : typeof frontmatterTags === "string"
      ? [frontmatterTags]
      : [];

  rawTags.forEach((tag) => {
    if (typeof tag === "string") {
      const normalized = normalizeTag(tag);
      if (normalized) {
        tagSet.add(normalized);
      }
    }
  });

  return Array.from(tagSet);
};

const getConditionValue = (
  context: CustomStatFileContext,
  condition: CustomStatFilterCondition,
): unknown => {
  switch (condition.type) {
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.folder:
      return getFolderPath(context.file);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType:
      return context.file.extension;
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName:
      return context.file.basename;
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.tag:
      return getFileTags(context.cache);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt:
      return new Date(context.file.stat.ctime);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt:
      return new Date(context.file.stat.mtime);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter:
      return getFrontmatterValue(context.cache, condition.key);
    default:
      return undefined;
  }
};

const matchFolder = (actualValue: unknown, operator: CustomStatFilterOperator, expectedValue: string): boolean => {
  if (typeof actualValue !== "string") {
    return false;
  }

  const actual = actualValue.trim();
  const expected = expectedValue.trim();
  if (!actual || !expected) {
    return false;
  }

  const isMatch = actual === expected || actual.startsWith(`${expected}/`);
  if (operator === CUSTOM_STAT_FILTER_OPERATORS.is) {
    return isMatch;
  }
  if (operator === CUSTOM_STAT_FILTER_OPERATORS.isNot) {
    return !isMatch;
  }
  if (operator === CUSTOM_STAT_FILTER_OPERATORS.startsWith) {
    return actual.startsWith(expected);
  }
  return false;
};

const matchDate = (
  actualValue: unknown,
  operator: CustomStatFilterOperator,
  expectedValue: string,
): boolean => {
  const actualDate = parseDateValue(actualValue);
  const expectedDate = parseDateValue(expectedValue);
  if (!actualDate || !expectedDate) {
    return false;
  }

  const actualTime = actualDate.getTime();
  const expectedTime = expectedDate.getTime();
  const actualKey = getDateKey(actualDate);
  const expectedKey = getDateKey(expectedDate);

  switch (operator) {
    case CUSTOM_STAT_FILTER_OPERATORS.is:
      return actualKey === expectedKey;
    case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      return actualKey !== expectedKey;
    case CUSTOM_STAT_FILTER_OPERATORS.before:
      return actualTime < expectedTime;
    case CUSTOM_STAT_FILTER_OPERATORS.onOrBefore:
      return actualTime <= expectedTime;
    case CUSTOM_STAT_FILTER_OPERATORS.after:
      return actualTime > expectedTime;
    case CUSTOM_STAT_FILTER_OPERATORS.onOrAfter:
      return actualTime >= expectedTime;
    default:
      return false;
  }
};

const matchTextOrList = (
  actualValue: unknown,
  operator: CustomStatFilterOperator,
  expectedValue: string,
  normalizer: (value: string) => string = normalizeText,
): boolean => {
  const expectedItems = splitConditionValues(expectedValue).map(normalizer);
  const normalizedExpected = normalizer(expectedValue);

  if (Array.isArray(actualValue)) {
    const actualItems = actualValue
      .map((item) => normalizer(toConditionString(item)))
      .filter(Boolean);

    switch (operator) {
      case CUSTOM_STAT_FILTER_OPERATORS.is:
      case CUSTOM_STAT_FILTER_OPERATORS.contains:
        return expectedItems.some((expected) => actualItems.includes(expected));
      case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      case CUSTOM_STAT_FILTER_OPERATORS.notContains:
        return expectedItems.every((expected) => !actualItems.includes(expected));
      case CUSTOM_STAT_FILTER_OPERATORS.startsWith:
        return actualItems.some((item) => item.startsWith(normalizedExpected));
      case CUSTOM_STAT_FILTER_OPERATORS.endsWith:
        return actualItems.some((item) => item.endsWith(normalizedExpected));
      case CUSTOM_STAT_FILTER_OPERATORS.regexMatch:
        try {
          return actualItems.some((item) => new RegExp(expectedValue, "i").test(item));
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  const actual = normalizer(toConditionString(actualValue));
  if (!actual) {
    return false;
  }

  switch (operator) {
    case CUSTOM_STAT_FILTER_OPERATORS.is:
      return actual === normalizedExpected;
    case CUSTOM_STAT_FILTER_OPERATORS.isNot:
      return actual !== normalizedExpected;
    case CUSTOM_STAT_FILTER_OPERATORS.contains:
      return actual.includes(normalizedExpected);
    case CUSTOM_STAT_FILTER_OPERATORS.notContains:
      return !actual.includes(normalizedExpected);
    case CUSTOM_STAT_FILTER_OPERATORS.startsWith:
      return actual.startsWith(normalizedExpected);
    case CUSTOM_STAT_FILTER_OPERATORS.endsWith:
      return actual.endsWith(normalizedExpected);
    case CUSTOM_STAT_FILTER_OPERATORS.regexMatch:
      try {
        return new RegExp(expectedValue, "i").test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
};

// =============================================================================

export const createCustomStatFilterCondition = (
  type: CustomStatFilterConditionType = CUSTOM_STAT_FILTER_CONDITION_TYPES.folder,
): CustomStatFilterCondition => {
  return {
    kind: CUSTOM_STAT_FILTER_NODE_KINDS.condition,
    id: createConditionId(),
    type,
    key: "",
    operator: getDefaultOperatorForConditionType(type),
    value: "",
  };
};

export const createCustomStatFilterGroup = (): CustomStatFilterGroup => {
  return {
    kind: CUSTOM_STAT_FILTER_NODE_KINDS.group,
    id: createGroupId(),
    conjunction: CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
    conditions: [],
  };
};

export const createCustomStatDefinition = (): CustomStatDefinition => {
  return {
    displayName: "",
    filters: createCustomStatFilterGroup(),
  };
};

export const getDefaultOperatorForConditionType = (
  type: CustomStatFilterConditionType,
): CustomStatFilterOperator => {
  if (
    type === CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt
    || type === CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt
  ) {
    return CUSTOM_STAT_FILTER_OPERATORS.onOrAfter;
  }
  if (type === CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter) {
    return CUSTOM_STAT_FILTER_OPERATORS.exists;
  }
  return CUSTOM_STAT_FILTER_OPERATORS.is;
};

export const getOperatorsForConditionType = (
  type: CustomStatFilterConditionType,
): CustomStatFilterOperator[] => {
  switch (type) {
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.folder:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
        CUSTOM_STAT_FILTER_OPERATORS.startsWith,
      ];
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
      ];
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.tag:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
        CUSTOM_STAT_FILTER_OPERATORS.contains,
        CUSTOM_STAT_FILTER_OPERATORS.notContains,
      ];
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt:
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
        CUSTOM_STAT_FILTER_OPERATORS.before,
        CUSTOM_STAT_FILTER_OPERATORS.onOrBefore,
        CUSTOM_STAT_FILTER_OPERATORS.after,
        CUSTOM_STAT_FILTER_OPERATORS.onOrAfter,
      ];
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.exists,
        CUSTOM_STAT_FILTER_OPERATORS.notExists,
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
        CUSTOM_STAT_FILTER_OPERATORS.contains,
        CUSTOM_STAT_FILTER_OPERATORS.notContains,
        CUSTOM_STAT_FILTER_OPERATORS.startsWith,
        CUSTOM_STAT_FILTER_OPERATORS.endsWith,
        CUSTOM_STAT_FILTER_OPERATORS.regexMatch,
        CUSTOM_STAT_FILTER_OPERATORS.before,
        CUSTOM_STAT_FILTER_OPERATORS.onOrBefore,
        CUSTOM_STAT_FILTER_OPERATORS.after,
        CUSTOM_STAT_FILTER_OPERATORS.onOrAfter,
      ];
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName:
    default:
      return [
        CUSTOM_STAT_FILTER_OPERATORS.is,
        CUSTOM_STAT_FILTER_OPERATORS.isNot,
        CUSTOM_STAT_FILTER_OPERATORS.contains,
        CUSTOM_STAT_FILTER_OPERATORS.notContains,
        CUSTOM_STAT_FILTER_OPERATORS.startsWith,
        CUSTOM_STAT_FILTER_OPERATORS.endsWith,
        CUSTOM_STAT_FILTER_OPERATORS.regexMatch,
      ];
  }
};

export const isOperatorValueOptional = (operator: CustomStatFilterOperator): boolean => {
  return operator === CUSTOM_STAT_FILTER_OPERATORS.exists
    || operator === CUSTOM_STAT_FILTER_OPERATORS.notExists;
};

export const isDateConditionType = (type: CustomStatFilterConditionType): boolean => {
  return type === CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt
    || type === CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt;
};

export const isCustomStatFilterCondition = (value: unknown): value is CustomStatFilterCondition => {
  if (!isRecord(value)) {
    return false;
  }

  return (value.kind === undefined || value.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition)
    && typeof value.id === "string"
    && isConditionType(value.type)
    && typeof value.key === "string"
    && isOperator(value.operator)
    && typeof value.value === "string";
};

export const isCustomStatFilterNode = (value: unknown): value is CustomStatFilterNode => {
  return isCustomStatFilterCondition(value) || isCustomStatFilterGroup(value);
};

export const isCustomStatFilterGroup = (value: unknown): value is CustomStatFilterGroup => {
  if (!isRecord(value)) {
    return false;
  }

  return (value.kind === undefined || value.kind === CUSTOM_STAT_FILTER_NODE_KINDS.group)
    && typeof value.id === "string"
    && isConjunction(value.conjunction)
    && Array.isArray(value.conditions)
    && value.conditions.every(isCustomStatFilterNode);
};

export const isCustomStatDefinition = (value: unknown): value is CustomStatDefinition => {
  if (!isRecord(value) || typeof value.displayName !== "string") {
    return false;
  }

  if (isCustomStatFilterGroup(value.filters)) {
    return true;
  }

  return isLegacyCustomStatType(value.type) && typeof value.value === "string";
};

export const toCustomStatFilterGroup = (stat: Partial<CustomStatDefinition>): CustomStatFilterGroup => {
  if (isCustomStatFilterGroup(stat.filters)) {
    return normalizeCustomStatFilterGroup(stat.filters);
  }

  if (isLegacyCustomStatType(stat.type) && typeof stat.value === "string") {
    return {
      kind: CUSTOM_STAT_FILTER_NODE_KINDS.group,
      id: createGroupId(),
      conjunction: CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
      conditions: [{
        kind: CUSTOM_STAT_FILTER_NODE_KINDS.condition,
        id: createConditionId(),
        type: stat.type,
        key: "",
        operator: stat.type === "folder"
          ? CUSTOM_STAT_FILTER_OPERATORS.is
          : CUSTOM_STAT_FILTER_OPERATORS.is,
        value: stat.value,
      }],
    };
  }

  return createCustomStatFilterGroup();
};

const normalizeCustomStatFilterCondition = (
  value: Partial<CustomStatFilterCondition>,
): CustomStatFilterCondition => {
  const type = isConditionType(value.type)
    ? value.type
    : CUSTOM_STAT_FILTER_CONDITION_TYPES.folder;
  const operators = getOperatorsForConditionType(type);
  const operator = isOperator(value.operator) && operators.includes(value.operator)
    ? value.operator
    : getDefaultOperatorForConditionType(type);

  return {
    kind: CUSTOM_STAT_FILTER_NODE_KINDS.condition,
    id: typeof value.id === "string" && value.id.trim() ? value.id : createConditionId(),
    type,
    key: typeof value.key === "string" ? value.key : "",
    operator,
    value: typeof value.value === "string" ? value.value : "",
  };
};

const normalizeCustomStatFilterNode = (value: unknown): CustomStatFilterNode | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.conditions)) {
    return normalizeCustomStatFilterGroup(value);
  }

  return isConditionType(value.type)
    ? normalizeCustomStatFilterCondition(value)
    : null;
};

export const normalizeCustomStatFilterGroup = (value: unknown): CustomStatFilterGroup => {
  if (!isRecord(value)) {
    return createCustomStatFilterGroup();
  }

  const conditions = Array.isArray(value.conditions)
    ? value.conditions
      .map((condition) => normalizeCustomStatFilterNode(condition))
      .filter((condition): condition is CustomStatFilterNode => condition !== null)
    : [];

  return {
    kind: CUSTOM_STAT_FILTER_NODE_KINDS.group,
    id: typeof value.id === "string" && value.id.trim() ? value.id : createGroupId(),
    conjunction: isConjunction(value.conjunction)
      ? value.conjunction
      : CUSTOM_STAT_FILTER_CONJUNCTIONS.and,
    conditions,
  };
};

export const normalizeCustomStatDefinition = (value: unknown): CustomStatDefinition | null => {
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
  const actualValue = getConditionValue(context, condition);

  if (condition.operator === CUSTOM_STAT_FILTER_OPERATORS.exists) {
    return !isValueMissing(actualValue);
  }
  if (condition.operator === CUSTOM_STAT_FILTER_OPERATORS.notExists) {
    return isValueMissing(actualValue);
  }
  if (isValueMissing(actualValue)) {
    return false;
  }

  switch (condition.type) {
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.folder:
      return matchFolder(actualValue, condition.operator, condition.value);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileType:
      return matchTextOrList(actualValue, condition.operator, condition.value, normalizeExtension);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.tag:
      return matchTextOrList(actualValue, condition.operator, condition.value, normalizeTag);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.createdAt:
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.modifiedAt:
      return matchDate(actualValue, condition.operator, condition.value);
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.frontmatter: {
      if (
        condition.operator === CUSTOM_STAT_FILTER_OPERATORS.before
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrBefore
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.after
        || condition.operator === CUSTOM_STAT_FILTER_OPERATORS.onOrAfter
      ) {
        return matchDate(actualValue, condition.operator, condition.value);
      }
      return matchTextOrList(actualValue, condition.operator, condition.value, normalizeText);
    }
    case CUSTOM_STAT_FILTER_CONDITION_TYPES.fileName:
    default:
      return matchTextOrList(actualValue, condition.operator, condition.value, normalizeText);
  }
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
  filters: CustomStatFilterGroup,
): boolean => {
  if (!filters.conditions.length) {
    return false;
  }

  const results = filters.conditions.map((condition) => matchesCustomStatFilterNode(context, condition));
  return filters.conjunction === CUSTOM_STAT_FILTER_CONJUNCTIONS.or
    ? results.some(Boolean)
    : results.every(Boolean);
};

export const findFirstCustomStatCondition = (
  filters: CustomStatFilterGroup,
): CustomStatFilterCondition | null => {
  for (const node of filters.conditions) {
    if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition) {
      return node;
    }

    const firstCondition = findFirstCustomStatCondition(node);
    if (firstCondition) {
      return firstCondition;
    }
  }

  return null;
};

export const countCustomStatFilterConditions = (filters: CustomStatFilterGroup): number => {
  return filters.conditions.reduce((count, node) => {
    if (node.kind === CUSTOM_STAT_FILTER_NODE_KINDS.condition) {
      return count + 1;
    }
    return count + countCustomStatFilterConditions(node);
  }, 0);
};

export const matchesCustomStatDefinition = (
  context: CustomStatFileContext,
  stat: CustomStatDefinition,
): boolean => {
  return matchesCustomStatFilterGroup(context, toCustomStatFilterGroup(stat));
};