import { LOCALE_META, SUPPORTED_LOCALES } from "../domain/localization.js";

export function applyLocalizationDocument(localization, root = typeof document !== "undefined" ? document : null) {
  if (!localization || !root?.querySelectorAll) return;
  const elements = root.querySelectorAll("[data-i18n]");
  elements.forEach((element) => {
    const key = element.dataset?.i18n;
    if (!key) return;
    let values = {};
    const rawValues = element.dataset?.i18nValues;
    if (rawValues) {
      try {
        values = JSON.parse(rawValues);
      } catch {
        values = {};
      }
    }
    element.textContent = localization.t(key, values, element.textContent || key);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((element) => {
    const key = element.dataset?.i18nHtml;
    if (key) element.innerHTML = localization.t(key, {}, element.innerHTML || key);
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((element) => {
    const declaration = element.dataset?.i18nAttr || "";
    for (const pair of declaration.split(";")) {
      const separator = pair.indexOf(":");
      if (separator < 1) continue;
      const attribute = pair.slice(0, separator).trim();
      const key = pair.slice(separator + 1).trim();
      if (attribute && key) element.setAttribute(attribute, localization.t(key, {}, element.getAttribute(attribute) || key));
    }
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.dataset?.i18nPlaceholder;
    if (key) element.setAttribute("placeholder", localization.t(key, {}, element.getAttribute("placeholder") || key));
  });
  root.documentElement?.setAttribute("lang", localization.getLocale?.() || "zh-tw");
  root.querySelectorAll("[data-locale]").forEach((element) => {
    const active = element.dataset?.locale === localization.getLocale?.();
    element.classList?.toggle?.("is-active", active);
    element.setAttribute("aria-pressed", String(active));
  });
}

/** Handles language selection. */
export class LocaleView {
  constructor({ localization, widgetElement, morphingWidgets } = {}) {
    this.localization = localization || null;
    this.widgetElement = widgetElement || (typeof document !== "undefined" ? document.getElementById("locale-widget") : null);
    this.morphingWidgets = morphingWidgets || null;
    this._initialized = false;
    this._unsubscribe = null;
    this._boundClick = (event) => {
      const option = event.target?.closest?.("[data-locale]");
      if (!option || !this.widgetElement?.contains?.(option)) return;
      event.preventDefault();
      const locale = option.dataset?.locale;
      if (SUPPORTED_LOCALES.includes(locale)) {
        this.localization?.setLocale(locale);
        this.morphingWidgets?.closeLocale();
      }
    };
  }

  init() {
    if (this._initialized || !this.widgetElement) return;
    this._initialized = true;
    this.widgetElement.addEventListener("click", this._boundClick);
    this._unsubscribe = this.localization?.subscribe?.(() => this.render());
    this.render();
  }

  render() {
    const locale = this.localization?.getLocale?.() || "zh-tw";
    this.widgetElement?.querySelectorAll?.("[data-locale]").forEach((option) => {
      const active = option.dataset?.locale === locale;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-pressed", String(active));
      option.tabIndex = active ? 0 : -1;
    });
    const toggle = this.widgetElement?.querySelector?.("#locale-toggle-btn, .locale-toggle-btn");
    if (toggle) {
      const label = this.localization?.t?.("widget.language.open", {}, "Choose display language") || "Choose display language";
      toggle.setAttribute("aria-label", label);
      toggle.title = label;
    }
    const meta = LOCALE_META[locale];
    if (this.widgetElement) this.widgetElement.dataset.locale = locale;
    return meta;
  }

  destroy() {
    this.widgetElement?.removeEventListener?.("click", this._boundClick);
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._initialized = false;
  }
}
