import {
  Notice,
} from "obsidian";

// =============================================================================

export const loggerOnError = (
  error: unknown,
  noticeMessage: string = "",
  noticeDuration: number | undefined = undefined,
): void => {
  if (!Number.isFinite(noticeDuration)) {
    noticeDuration = undefined;
  }
  if (typeof noticeMessage === "string" && 0 < noticeMessage.length) {
    new Notice(noticeMessage, noticeDuration);
  }
  const errorObj: Error = error instanceof Error
    ? error
    : new Error(String(error));
  console.error("Error on About Blank:", errorObj);
};

// =============================================================================

export const adjustInt = (num: number): number => {
  return Math.trunc(num);
};
