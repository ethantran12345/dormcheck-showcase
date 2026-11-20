import { beforeAll, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { DEFAULT_LANGUAGE, LANGUAGES } from "@/i18n/languages";

describe("i18n scaffolding", () => {
  beforeAll(async () => {
    localStorage.removeItem("dc_lang");
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it("initializes with English as the default language", () => {
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.resolvedLanguage).toBe("en");
    expect(i18n.t("settings:language.title")).toBe("Language");
  });

  it("resolves bare keys against the common default namespace", () => {
    expect(i18n.t("actions.save")).toBe("Save");
    expect(i18n.t("actions.cancel")).toBe("Cancel");
  });

  it("switches to the zh locale and back across namespaces", async () => {
    await i18n.changeLanguage("zh");
    expect(i18n.t("settings:language.title")).toBe("语言");
    expect(i18n.t("actions.save")).toBe("保存");

    await i18n.changeLanguage("en");
    expect(i18n.t("settings:language.title")).toBe("Language");
    expect(i18n.t("actions.save")).toBe("Save");
  });

  it("persists the chosen language to localStorage under dc_lang", async () => {
    await i18n.changeLanguage("zh");
    expect(localStorage.getItem("dc_lang")).toBe("zh");
    await i18n.changeLanguage("en");
    expect(localStorage.getItem("dc_lang")).toBe("en");
  });

  it("falls back to English for keys missing in the active locale", async () => {
    // Probe the fallback chain without polluting shipped locale files: an
    // en-only key must still resolve while zh is active (fallbackLng: 'en').
    i18n.addResource("en", "common", "__fallbackProbe", "English only");
    await i18n.changeLanguage("zh");
    expect(i18n.t("__fallbackProbe")).toBe("English only");
    await i18n.changeLanguage("en");
  });

  it("registry: English and Chinese (zh) are enabled", () => {
    const enabled = LANGUAGES.filter((l) => l.enabled).map((l) => l.code);
    expect(enabled).toEqual(["en", "zh"]);
  });
});
