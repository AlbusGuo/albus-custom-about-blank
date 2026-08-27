import {
  type App,
  type TFile,
} from "obsidian";

import {
  CUSTOM_STAT_FILTER_FIELDS,
  type CustomStatFieldType,
} from "src/utils/customStatQuery";

export interface CustomStatFieldDefinition {
  name: string;
  label: string;
  type: CustomStatFieldType;
  builtIn: boolean;
  icon: string;
}

interface PropertySamples {
  values: Set<string>;
}

interface MetadataPropertyInfo {
  name: string;
}

interface MetadataTypeInfo {
  expected?: {
    icon?: string;
    type?: string;
  };
  inferred?: {
    type?: string;
  };
}

interface MetadataTypeManagerLike {
  getAllProperties(): Record<string, MetadataPropertyInfo>;
  getTypeInfo(name: string): MetadataTypeInfo;
}

interface AppWithMetadataTypeManager extends App {
  metadataTypeManager?: MetadataTypeManagerLike;
}

const BUILT_IN_FIELDS: CustomStatFieldDefinition[] = [
  { name: CUSTOM_STAT_FILTER_FIELDS.path, label: "文件路径", type: "text", builtIn: true, icon: "folder-tree" },
  { name: CUSTOM_STAT_FILTER_FIELDS.parent, label: "文件夹", type: "text", builtIn: true, icon: "folder" },
  { name: CUSTOM_STAT_FILTER_FIELDS.name, label: "文件名", type: "text", builtIn: true, icon: "file" },
  { name: CUSTOM_STAT_FILTER_FIELDS.basename, label: "名称", type: "text", builtIn: true, icon: "list-filter" },
  { name: CUSTOM_STAT_FILTER_FIELDS.extension, label: "扩展名", type: "text", builtIn: true, icon: "file-type" },
  { name: CUSTOM_STAT_FILTER_FIELDS.createdAt, label: "创建时间", type: "date", builtIn: true, icon: "clock" },
  { name: CUSTOM_STAT_FILTER_FIELDS.modifiedAt, label: "修改时间", type: "date", builtIn: true, icon: "clock" },
  { name: CUSTOM_STAT_FILTER_FIELDS.tags, label: "标签", type: "multi-select", builtIn: true, icon: "tags" },
];

const MAX_SUGGESTIONS_PER_FIELD = 200;
const INTERNAL_PROPERTY_NAMES = new Set([
  "position",
  "aliases",
  "alias",
  "tags",
  "tag",
  "cssclasses",
  "cssclass",
  "allowed-tools",
]);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export class CustomStatFieldCatalog {
  private readonly fields: CustomStatFieldDefinition[];
  private readonly suggestions = new Map<string, string[]>();

  constructor(private readonly app: App) {
    this.fields = this.buildCatalog();
  }

  getFields(): CustomStatFieldDefinition[] {
    return this.fields.map((field) => ({ ...field }));
  }

  getFieldType(fieldName: string): CustomStatFieldType {
    return this.fields.find((field) => field.name === fieldName)?.type ?? "text";
  }

  getValueSuggestions(fieldName: string): string[] {
    return [...(this.suggestions.get(fieldName) ?? [])];
  }

  private buildCatalog(): CustomStatFieldDefinition[] {
    const files = this.app.vault.getFiles();
    const propertyFields = this.getRegisteredPropertyFields();
    const properties = new Map<string, PropertySamples>(
      propertyFields.map((field) => [field.name, { values: new Set<string>() }]),
    );
    const builtInSuggestions = new Map<string, Set<string>>();
    BUILT_IN_FIELDS.forEach((field) => {
      builtInSuggestions.set(field.name, new Set<string>());
    });

    files.forEach((file) => {
      this.collectFileSuggestions(file, builtInSuggestions);
      const frontmatter: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (isRecord(frontmatter)) {
        this.collectRegisteredPropertyValues(frontmatter, properties);
      }
    });

    builtInSuggestions.forEach((values, field) => {
      this.suggestions.set(field, this.sortAndLimit(values));
    });

    properties.forEach((samples, name) => {
      this.suggestions.set(name, this.sortAndLimit(samples.values));
    });
    return [...BUILT_IN_FIELDS, ...propertyFields];
  }

  private getRegisteredPropertyFields(): CustomStatFieldDefinition[] {
    const manager = (this.app as AppWithMetadataTypeManager).metadataTypeManager;
    if (
      !manager
      || typeof manager.getAllProperties !== "function"
      || typeof manager.getTypeInfo !== "function"
    ) {
      return [];
    }
    try {
      return Object.values(manager.getAllProperties())
        .filter((property) => (
          typeof property.name === "string"
          && property.name.trim().length > 0
          && !INTERNAL_PROPERTY_NAMES.has(property.name.toLowerCase())
        ))
        .map((property): CustomStatFieldDefinition => {
          const typeInfo = manager.getTypeInfo(property.name);
          return {
            name: `note.${property.name}`,
            label: property.name,
            type: this.toFieldType(
              typeInfo.inferred?.type ?? typeInfo.expected?.type,
            ),
            builtIn: false,
            icon: typeInfo.expected?.icon ?? "list-tree",
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    } catch {
      return [];
    }
  }

  private collectFileSuggestions(
    file: TFile,
    suggestions: Map<string, Set<string>>,
  ): void {
    suggestions.get(CUSTOM_STAT_FILTER_FIELDS.path)?.add(file.path);
    suggestions.get(CUSTOM_STAT_FILTER_FIELDS.parent)?.add(file.parent?.path ?? "");
    suggestions.get(CUSTOM_STAT_FILTER_FIELDS.name)?.add(file.name);
    suggestions.get(CUSTOM_STAT_FILTER_FIELDS.basename)?.add(file.basename);
    suggestions.get(CUSTOM_STAT_FILTER_FIELDS.extension)?.add(file.extension);

    const cache = this.app.metadataCache.getFileCache(file);
    cache?.tags?.forEach((tag) => {
      suggestions.get(CUSTOM_STAT_FILTER_FIELDS.tags)?.add(tag.tag.replace(/^#/, ""));
    });
    const frontmatter: unknown = cache?.frontmatter;
    const frontmatterTags = isRecord(frontmatter) ? frontmatter.tags : undefined;
    const tagValues = Array.isArray(frontmatterTags)
      ? frontmatterTags
      : typeof frontmatterTags === "string" ? [frontmatterTags] : [];
    tagValues.forEach((tag) => {
      if (typeof tag === "string") {
        suggestions.get(CUSTOM_STAT_FILTER_FIELDS.tags)?.add(tag.replace(/^#/, ""));
      }
    });
  }

  private collectRegisteredPropertyValues(
    source: Record<string, unknown>,
    properties: Map<string, PropertySamples>,
  ): void {
    properties.forEach((samples, name) => {
      const propertyName = name.startsWith("note.") ? name.slice(5) : name;
      if (!(propertyName in source)) {
        return;
      }
      this.toSuggestionValues(source[propertyName]).forEach((item) => (
        samples.values.add(item)
      ));
    });
  }

  private toFieldType(type: string | undefined): CustomStatFieldType {
    switch (type) {
      case "number":
        return "number";
      case "checkbox":
      case "boolean":
        return "boolean";
      case "date":
      case "datetime":
        return "date";
      case "tags":
      case "aliases":
      case "multitext":
      case "multi-select":
        return "multi-select";
      default:
        return "text";
    }
  }

  private toSuggestionValues(value: unknown): string[] {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => {
      if (
        typeof item === "string"
        || typeof item === "number"
        || typeof item === "boolean"
      ) {
        const text = String(item).trim();
        return text ? [text] : [];
      }
      return [];
    });
  }

  private sortAndLimit(values: Set<string>): string[] {
    return Array.from(values)
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "zh-CN"))
      .slice(0, MAX_SUGGESTIONS_PER_FIELD);
  }
}
