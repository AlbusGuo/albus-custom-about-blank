// Avoid name collision to Obsidian's "isBoolean"
const isBool = (value: unknown): value is boolean => {
  return typeof value === "boolean";
};

export default isBool;
