import enUS from "./en-US.json" with { type: "json" };

const dynamicLanguages = import.meta.glob<Language>(["./*.json", "!./en-US.json"], { import: "default" });

const languages: Record<string, () => Promise<Language>> = {
    "./en-US.json": async () => enUS,
    ...dynamicLanguages,
};

export { enUS, languages };

export type Language = typeof import("./en-US.json");
