import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOCALES, formatMessage, makeTranslate, resolveLocale } from "../web/src/i18n/catalog.ts";
import { fr } from "../web/src/i18n/fr.ts";
import { en } from "../web/src/i18n/en.ts";
import { es } from "../web/src/i18n/es.ts";

describe("resolveLocale", () => {
  it("accepts a known locale and its region variants, defaulting to French", () => {
    assert.equal(resolveLocale("en"), "en");
    assert.equal(resolveLocale("en-US"), "en");
    assert.equal(resolveLocale("es-419"), "es");
    assert.equal(resolveLocale("fr"), "fr");
    assert.equal(resolveLocale("de"), "fr");
    assert.equal(resolveLocale(null), "fr");
  });
});

describe("formatMessage", () => {
  it("interpolates named parameters and leaves unknown placeholders", () => {
    assert.equal(formatMessage("Projet {name}", { name: "Omni" }, "fr"), "Projet Omni");
    assert.equal(formatMessage("Projet {name}", {}, "fr"), "Projet {name}");
  });

  it("selects the plural form from the count per locale", () => {
    const value = { one: "{count} script", other: "{count} scripts" };
    assert.equal(formatMessage(value, { count: 1 }, "en"), "1 script");
    assert.equal(formatMessage(value, { count: 3 }, "en"), "3 scripts");
    assert.equal(formatMessage(value, { count: 0 }, "fr"), "0 script");
  });
});

describe("makeTranslate", () => {
  const t = makeTranslate(en, fr, "en");
  it("uses the active catalog, then falls back, then the key itself", () => {
    assert.equal(t("footer.ready"), en["footer.ready"]);
    assert.equal(t("missing.key"), "missing.key");
  });
});

describe("catalog parity", () => {
  it("en and es carry exactly the same keys as the fr reference", () => {
    const reference = Object.keys(fr).sort();
    assert.deepEqual(Object.keys(en).sort(), reference);
    assert.deepEqual(Object.keys(es).sort(), reference);
  });

  it("every reference value is a string or a one/other plural object", () => {
    for (const [key, value] of Object.entries(fr)) {
      const ok = typeof value === "string" || (value && typeof value === "object" && "one" in value && "other" in value);
      assert.ok(ok, key);
    }
  });

  it("exposes the three locales", () => {
    assert.deepEqual([...LOCALES], ["fr", "en", "es"]);
  });
});
