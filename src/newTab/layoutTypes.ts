export const NEW_TAB_COMPONENT_IDS = [
  "hero",
  "search",
  "shortcuts",
  "heatmap",
] as const;

export type NewTabComponentId = typeof NEW_TAB_COMPONENT_IDS[number];

export const NEW_TAB_LAYOUT_PRESETS = [
  "isometric",
  "classic",
] as const;

export type NewTabLayoutPreset = typeof NEW_TAB_LAYOUT_PRESETS[number];

export interface NewTabLayoutSettings {
  version: 2;
  preset: NewTabLayoutPreset;
}

interface LegacyComponentSettings {
  heatmapStyle?: "flat" | "isometric";
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isComponentId = (value: unknown): value is NewTabComponentId => {
  return typeof value === "string"
    && (NEW_TAB_COMPONENT_IDS as readonly string[]).includes(value);
};

const isLayoutPreset = (value: unknown): value is NewTabLayoutPreset => {
  return typeof value === "string"
    && (NEW_TAB_LAYOUT_PRESETS as readonly string[]).includes(value);
};

export const getPresetComponentOrder = (
  preset: NewTabLayoutPreset,
): NewTabComponentId[] => {
  if (preset === "isometric") {
    return ["heatmap", "search", "shortcuts", "hero"];
  }
  return ["hero", "search", "shortcuts", "heatmap"];
};

export const createNewTabLayout = (
  preset: NewTabLayoutPreset = "classic",
): NewTabLayoutSettings => ({
  version: 2,
  preset,
});

export const normalizeNewTabLayout = (
  value: unknown,
  legacySettings: LegacyComponentSettings = {},
): NewTabLayoutSettings => {
  if (isRecord(value) && value.version === 2 && isLayoutPreset(value.preset)) {
    return createNewTabLayout(value.preset);
  }

  if (isRecord(value) && value.version === 1) {
    const previousComponents = Array.isArray(value.components)
      ? value.components.filter(isComponentId)
      : [];
    if (
      legacySettings.heatmapStyle === "isometric"
      || previousComponents[0] === "heatmap"
    ) {
      return createNewTabLayout("isometric");
    }
  }

  return createNewTabLayout(
    legacySettings.heatmapStyle === "isometric" ? "isometric" : "classic",
  );
};

export const isNewTabLayoutSettings = (value: unknown): boolean => {
  if (
    !isRecord(value)
    || value.version !== 2
    || !isLayoutPreset(value.preset)
  ) {
    return false;
  }
  return true;
};
