const isFalsyString = (value: unknown): value is "" | null | undefined => {
  return value === "" || value === null || value === undefined;
};

export default isFalsyString;
