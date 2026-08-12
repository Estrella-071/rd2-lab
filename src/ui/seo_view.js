import { LOCALE_META, SUPPORTED_LOCALES } from "../domain/localization.js";
import {
  buildLocaleUrl,
  isLocaleFreeShareRoute,
  PUBLIC_SITE_ORIGIN,
  URL_ROUTE_KINDS
} from "../domain/url_state.js";

const ALTERNATE_LINK_PREFIX = "seo-alternate-";

function cleanText(value) {
  const text = String(value || "");
  let plainText = "";
  let insideTag = false;
  for (const character of text) {
    if (character === "<") {
      insideTag = true;
    } else if (character === ">" && insideTag) {
      insideTag = false;
      plainText += " ";
    } else if (!insideTag) {
      plainText += character;
    }
  }
  return plainText.replace(/\s+/g, " ").trim();
}

function setMeta(documentRoot, selector, attribute, value) {
  let element = documentRoot.head?.querySelector(selector);
  if (!element) {
    element = documentRoot.createElement("meta");
    documentRoot.head?.appendChild(element);
  }
  element.setAttribute(attribute, value);
  return element;
}

function setLink(documentRoot, id, rel, href, hreflang = "") {
  let element = documentRoot.head?.querySelector(`#${id}`);
  if (!element) {
    element = documentRoot.createElement("link");
    element.id = id;
    documentRoot.head?.appendChild(element);
  }
  element.setAttribute("rel", rel);
  element.setAttribute("href", href);
  if (hreflang) element.setAttribute("hreflang", hreflang);
  return element;
}

function resolvePageCopy(localization, urlState, entity = null) {
  const siteName = localization.t("brand.siteName", {}, "Random Dice 2 Lab");
  const fallback = {
    title: localization.t("brand.seoTitle", {}, `${siteName} — Dice tree and build planner`),
    description: localization.t("brand.metaDescription", {}, "Versioned Random Dice 2 data, dice tree, compendium, and build planning tools."),
    type: "WebSite"
  };
  if (urlState.kind === URL_ROUTE_KINDS.TREE_NODE && entity) {
    const name = entity.name_zh || entity.name || localization.t("tooltip.nodeFallback", {}, "Unnamed node");
    return {
      title: localization.t("seo.nodeTitle", { name }, `${name} — ${siteName}`),
      description: localization.t("seo.nodeDescription", {
        name,
        description: cleanText(entity.description_zh || entity.desc)
      }, `${name} node details in the Random Dice 2 Lab dice tree.`),
      type: "WebPage"
    };
  }
  if (urlState.kind === URL_ROUTE_KINDS.COMPENDIUM) {
    const categoryKey = `compendium.${urlState.category || "dice"}`;
    const category = localization.t(categoryKey, {}, urlState.category || "Compendium");
    return {
      title: localization.t("seo.compendiumCategoryTitle", { category }, `${category} | ${siteName} compendium`),
      description: localization.t("seo.compendiumCategoryDescription", { category }, `${category} data and reference entries for Random Dice 2.`),
      type: "CollectionPage"
    };
  }
  if (urlState.kind === URL_ROUTE_KINDS.COMPENDIUM_CARD && entity) {
    const name = entity.name_zh || entity.display_name_zh || entity.bossType || entity.eventKind || "";
    return {
      title: localization.t("seo.compendiumTitle", { name }, `${name} — ${siteName} compendium`),
      description: localization.t("seo.compendiumDescription", {
        name,
        description: cleanText(entity.description_zh || entity.desc_zh || entity.desc_en)
      }, `${name} compendium entry for Random Dice 2.`),
      type: "WebPage"
    };
  }
  if (urlState.kind === URL_ROUTE_KINDS.SIMULATION) {
    return {
      title: localization.t("seo.simulationTitle", {}, `Build simulation — ${siteName}`),
      description: localization.t("seo.simulationDescription", {}, "Plan a Random Dice 2 build, compare unlock costs, and share the result."),
      type: "WebPage"
    };
  }
  return fallback;
}

function localeHreflang(locale) {
  return locale === "zh-tw" ? "zh-Hant" : locale;
}

function buildPageUrl(urlState, locale, origin) {
  return `${origin}${buildLocaleUrl({
    locale,
    includeLocale: !isLocaleFreeShareRoute(urlState),
    kind: urlState.kind,
    category: urlState.category,
    id: urlState.id,
    share: urlState.share,
    shareKind: urlState.shareKind,
    eventMode: urlState.eventMode
  })}`;
}

function updateStructuredData(documentRoot, { siteName, pageUrl, description, locale, type }) {
  let script = documentRoot.getElementById("seo-structured-data");
  if (!script) {
    script = documentRoot.createElement("script");
    script.id = "seo-structured-data";
    script.type = "application/ld+json";
    documentRoot.head?.appendChild(script);
  }
  const siteUrl = `${PUBLIC_SITE_ORIGIN}/${locale}/`;
  script.textContent = JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteName,
      url: siteUrl,
      inLanguage: LOCALE_META[locale]?.intl || locale
    },
    {
      "@context": "https://schema.org",
      "@type": type,
      name: siteName,
      url: pageUrl,
      description,
      inLanguage: LOCALE_META[locale]?.intl || locale,
      isPartOf: { "@type": "WebSite", url: siteUrl, name: siteName }
    }
  ]);
}

export function updateSeoMetadata({ localization, urlState, entity = null, documentRoot = typeof document !== "undefined" ? document : null, origin = typeof window !== "undefined" ? window.location.origin : PUBLIC_SITE_ORIGIN } = {}) {
  if (!localization || !documentRoot?.head) return null;
  const locale = localization.getLocale?.() || "zh-tw";
  const copy = resolvePageCopy(localization, urlState || { kind: URL_ROUTE_KINDS.HOME }, entity);
  const normalizedOrigin = String(origin || PUBLIC_SITE_ORIGIN).replace(/\/$/, "");
  const pageUrl = buildPageUrl(urlState || { kind: URL_ROUTE_KINDS.HOME }, locale, normalizedOrigin);
  const imageUrl = `${normalizedOrigin}/og-preview.png`;
  const siteName = localization.t("brand.siteName", {}, "Random Dice 2 Lab");

  documentRoot.title = copy.title;
  setMeta(documentRoot, 'meta[name="description"]', "name", "description").setAttribute("content", copy.description);
  setMeta(documentRoot, 'meta[property="og:type"]', "property", "og:type").setAttribute("content", "website");
  setMeta(documentRoot, 'meta[property="og:site_name"]', "property", "og:site_name").setAttribute("content", siteName);
  setMeta(documentRoot, 'meta[property="og:title"]', "property", "og:title").setAttribute("content", copy.title);
  setMeta(documentRoot, 'meta[property="og:description"]', "property", "og:description").setAttribute("content", copy.description);
  setMeta(documentRoot, 'meta[property="og:url"]', "property", "og:url").setAttribute("content", pageUrl);
  setMeta(documentRoot, 'meta[property="og:image"]', "property", "og:image").setAttribute("content", imageUrl);
  setMeta(documentRoot, 'meta[property="og:image:alt"]', "property", "og:image:alt").setAttribute("content", localization.t("brand.ogImageAlt", {}, `${siteName} preview`));
  setMeta(documentRoot, 'meta[name="twitter:card"]', "name", "twitter:card").setAttribute("content", "summary_large_image");
  setMeta(documentRoot, 'meta[name="twitter:title"]', "name", "twitter:title").setAttribute("content", copy.title);
  setMeta(documentRoot, 'meta[name="twitter:description"]', "name", "twitter:description").setAttribute("content", copy.description);
  setMeta(documentRoot, 'meta[name="twitter:image"]', "name", "twitter:image").setAttribute("content", imageUrl);
  setLink(documentRoot, "seo-canonical", "canonical", pageUrl);

  for (const supportedLocale of SUPPORTED_LOCALES) {
    setLink(
      documentRoot,
      `${ALTERNATE_LINK_PREFIX}${supportedLocale}`,
      "alternate",
      buildPageUrl(urlState || { kind: URL_ROUTE_KINDS.HOME }, supportedLocale, normalizedOrigin),
      localeHreflang(supportedLocale)
    );
  }
  setLink(documentRoot, "seo-alternate-x-default", "alternate", buildPageUrl(urlState || { kind: URL_ROUTE_KINDS.HOME }, "zh-tw", normalizedOrigin), "x-default");
  updateStructuredData(documentRoot, { siteName, pageUrl, description: copy.description, locale, type: copy.type });
  return { ...copy, locale, pageUrl };
}
