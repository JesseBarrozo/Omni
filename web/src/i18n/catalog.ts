// Pure i18n core for the Omni GUI: locale resolution, message interpolation and
// plural selection. The React layer (index.tsx) builds on this, and it is tested
// without a DOM. French is the reference locale; English and Spanish mirror it.

export const LOCALES = ["fr", "en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "fr";

export type PluralForms = { one: string; other: string };
export type CatalogValue = string | PluralForms;
export type Catalog = Record<string, CatalogValue>;
export type Params = Record<string, string | number>;

// Maps a BCP 47 tag (or anything) to a supported locale, defaulting to French.
export function resolveLocale(input: string | null | undefined): Locale {
  const base = (input ?? "").toLowerCase().slice(0, 2);
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : DEFAULT_LOCALE;
}

// Interpolates {name} placeholders; a plural object picks its form from `count`.
export function formatMessage(value: CatalogValue, params: Params = {}, locale: Locale = DEFAULT_LOCALE): string {
  let template: string;
  if (typeof value === "string") {
    template = value;
  } else {
    const count = Number(params.count ?? 0);
    const rule = new Intl.PluralRules(locale).select(count);
    template = rule === "one" ? value.one : value.other;
  }
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

// Builds a translator bound to an active catalog, its fallback, and the locale.
// A missing key falls back to the reference catalog, then to the key itself.
export function makeTranslate(active: Catalog, fallback: Catalog, locale: Locale) {
  return (key: string, params?: Params): string => {
    const value = active[key] ?? fallback[key];
    if (value === undefined) return key;
    return formatMessage(value, params, locale);
  };
}
