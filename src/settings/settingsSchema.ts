import {
  type Action,
} from "src/settings/action-basic";

import {
  type DateStatDefinition,
  isDateStatDefinition,
} from "src/settings/dateStatTypes";

import {
  isCustomStatDefinition,
  type CustomStatDefinition,
} from "src/utils/customStatQuery";

import isBool from "src/utils/isBool";

import {
  createNewTabLayout,
  isNewTabLayoutSettings,
  type NewTabLayoutSettings,
} from "src/newTab/layoutTypes";

export interface AboutBlankSettings {
  newTabLayout: NewTabLayoutSettings;
  iconTextGap: number;
  centerActionListVertically: boolean;
  deleteActionListMarginTop: boolean;
  shortcutListEnabled: boolean;
  logoEnabled: boolean;
  logoPath: string;
  logoIcon: string;
  wordmarkText: string;
  particleEffectEnabled: boolean;
  particleUseCustomColor: boolean;
  particleColor: string;
  particleAmbientMotion: ParticleAmbientMotion;
  particleScale: number;
  particleSpacing: number;
  particleDotSize: number;
  particleDisturbRadius: number;
  particleDisturbStrength: number;
  logoSize: number;
  searchBoxEnabled: boolean;
  showStats: boolean;
  showUsageDays: boolean;
  showFileCount: boolean;
  showStorageSize: boolean;
  obsidianStartDate: string;
  heatmapEnabled: boolean;
  heatmapStyle: "flat" | "isometric";
  heatmapDataSource: string;
  heatmapColorSegments: Array<{ min: number; max: number; color: string }>;
  customStats: CustomStatDefinition[];
  statOrder: string[];
  dateStats: DateStatDefinition[];
  dateStatOrder: string[];
  actions: Action[];
  settingsTab: string;
}

export type ParticleAmbientMotion =
  | "none"
  | "wave"
  | "float"
  | "undulate"
  | "pulse"
  | "ripple"
  | "breathe";

const DEFAULT_SETTINGS: AboutBlankSettings = {
  newTabLayout: createNewTabLayout(),
  iconTextGap: 10,
  centerActionListVertically: false,
  deleteActionListMarginTop: false,
  shortcutListEnabled: true,
  logoEnabled: true,
  logoPath: "",
  logoIcon: "",
  wordmarkText: "",
  particleEffectEnabled: true,
  particleUseCustomColor: false,
  particleColor: "#6c31e3",
  particleAmbientMotion: "none",
  particleScale: 1,
  particleSpacing: 3.6,
  particleDotSize: 0.8,
  particleDisturbRadius: 72,
  particleDisturbStrength: 1.45,
  logoSize: 350,
  searchBoxEnabled: true,
  showStats: true,
  showUsageDays: true,
  showFileCount: true,
  showStorageSize: true,
  obsidianStartDate: "",
  heatmapEnabled: true,
  heatmapStyle: "flat",
  heatmapDataSource: "note.created",
  heatmapColorSegments: [
    { min: 0, max: 0, color: "var(--background-primary)" },
    { min: 1, max: 2, color: "#9be9a8" },
    { min: 3, max: 5, color: "#40c463" },
    { min: 6, max: 9, color: "#30a14e" },
    { min: 10, max: 999, color: "#216e39" },
  ],
  customStats: [],
  statOrder: [],
  dateStats: [],
  dateStatOrder: [],
  actions: [],
  settingsTab: "shortcuts",
};

const DEFAULT_SETTINGS_LIMIT: Partial<
  {
    [key in keyof AboutBlankSettings]: { min: number; max: number };
  }
> = {
  iconTextGap: {
    min: 0,
    max: 50,
  },
};

type HeatmapColorSegment = AboutBlankSettings["heatmapColorSegments"][number];
type CustomStat = AboutBlankSettings["customStats"][number];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isHeatmapColorSegment = (value: unknown): value is HeatmapColorSegment => {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.min === "number"
    && typeof value.max === "number"
    && typeof value.color === "string";
};

const isCustomStat = (value: unknown): value is CustomStat => {
  return isCustomStatDefinition(value);
};

export const settingsPropTypeCheck: {
  [key in keyof AboutBlankSettings]: (value: unknown) => boolean;
} = {
  newTabLayout: (value: unknown) => isNewTabLayoutSettings(value),
  iconTextGap: (value: unknown) => {
    if (!Number.isFinite(value)) {
      return false;
    }
    const num = value as number;
    const limit = DEFAULT_SETTINGS_LIMIT.iconTextGap;
    if (!limit) {
      return false;
    }
    return limit.min <= num && num <= limit.max;
  },
  centerActionListVertically: (value: unknown) => isBool(value),
  deleteActionListMarginTop: (value: unknown) => isBool(value),
  shortcutListEnabled: (value: unknown) => isBool(value),
  logoEnabled: (value: unknown) => isBool(value),
  logoPath: (value: unknown) => typeof value === "string",
  logoIcon: (value: unknown) => typeof value === "string",
  wordmarkText: (value: unknown) => typeof value === "string",
  particleEffectEnabled: (value: unknown) => isBool(value),
  particleUseCustomColor: (value: unknown) => isBool(value),
  particleColor: (value: unknown) => typeof value === "string",
  particleAmbientMotion: (value: unknown) => (
    typeof value === "string"
    && ["none", "wave", "float", "undulate", "pulse", "ripple", "breathe"]
      .includes(value)
  ),
  particleScale: (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) && value >= 0.8 && value <= 1.6
  ),
  particleSpacing: (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 8
  ),
  particleDotSize: (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) && value >= 0.2 && value <= 3
  ),
  particleDisturbRadius: (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) && value >= 10 && value <= 150
  ),
  particleDisturbStrength: (value: unknown) => (
    typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 3
  ),
  logoSize: (value: unknown) => typeof value === "number" && Number.isFinite(value),
  heatmapEnabled: (value: unknown) => isBool(value),
  heatmapStyle: (value: unknown) => value === "flat" || value === "isometric",
  heatmapDataSource: (value: unknown) => {
    return typeof value === "string" && (
      value === "file.ctime"
      || value === "file.mtime"
      || value.startsWith("note.")
    );
  },
  heatmapColorSegments: (value: unknown) => {
    return Array.isArray(value) && value.every(isHeatmapColorSegment);
  },
  customStats: (value: unknown) => {
    return Array.isArray(value) && value.every(isCustomStat);
  },
  statOrder: (value: unknown) => {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  },
  dateStats: (value: unknown) => {
    return Array.isArray(value) && value.every(isDateStatDefinition);
  },
  dateStatOrder: (value: unknown) => {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
  },
  searchBoxEnabled: (value: unknown) => isBool(value),
  showStats: (value: unknown) => isBool(value),
  showUsageDays: (value: unknown) => isBool(value),
  showFileCount: (value: unknown) => isBool(value),
  showStorageSize: (value: unknown) => isBool(value),
  obsidianStartDate: (value: unknown) => typeof value === "string",
  actions: (value: unknown) => Array.isArray(value),
  settingsTab: (value: unknown) => typeof value === "string",
};

export const defaultSettingsClone = (): AboutBlankSettings => {
  return structuredClone(DEFAULT_SETTINGS);
};
