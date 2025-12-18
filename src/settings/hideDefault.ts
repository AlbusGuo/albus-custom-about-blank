import {
  Setting,
} from "obsidian";

import {
  type AboutBlankSettingTab,
} from "src/settings/settingTab";

import {
  loggerOnError,
} from "src/commons";

import {
  type ValuesOf,
} from "src/types";

// =============================================================================

export const HIDE_DEFAULT_ACTIONS = {
  not: "notHide",
  close: "onlyClose",
  all: "all",
} as const;

export const HIDE_DEFAULT_ACTIONS_NAME: {
  [key in ValuesOf<typeof HIDE_DEFAULT_ACTIONS>]: string;
} = {
  notHide: "不隐藏",
  onlyClose: "仅关闭",
  all: "全部",
} as const;

// =============================================================================

export const makeSettingsHideDefaults = (
  elem: HTMLElement,
  page: AboutBlankSettingTab,
): void => {
  new Setting(elem)
    .setName("隐藏消息")
    .setDesc("这将隐藏空文件视图（新标签页）中的消息。例如：\"没有打开的文件\"。")
    .addToggle((toggle) => {
      toggle
        .setValue(page.plugin.settings.hideMessage)
        .onChange(async (value) => {
          try {
            page.plugin.settings.hideMessage = value;
            await page.plugin.saveSettings();
          } catch (error) {
            loggerOnError(error, "Error in settings.\n(About Blank)");
          }
        });
    });
  new Setting(elem)
    .setName("隐藏默认操作")
    .setDesc(
      "这将隐藏空文件视图（新标签页）中的默认操作。例如：\"创建新笔记\"、\"关闭\"。",
    )
    .addDropdown((dropdown) => {
      dropdown
        .addOptions(HIDE_DEFAULT_ACTIONS_NAME)
        .setValue(page.plugin.settings.hideDefaultActions)
        .onChange(async (value: ValuesOf<typeof HIDE_DEFAULT_ACTIONS>) => {
          try {
            if (!Object.values(HIDE_DEFAULT_ACTIONS).includes(value)) {
              return;
            }
            page.plugin.settings.hideDefaultActions = value;
            await page.plugin.saveSettings();
          } catch (error) {
            loggerOnError(error, "Error in settings.\n(About Blank)");
          }
        });
    });
};
