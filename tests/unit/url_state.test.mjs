import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAlternateLocaleUrl,
  buildLocalePath,
  buildLocaleUrl,
  buildPublicUrl,
  buildUrlStatePath,
  parseUrlState,
  URL_ROUTE_KINDS
} from "../../src/domain/url_state.js";

test("url state: locale-prefixed routes identify nodes and compendium cards", () => {
  assert.deepEqual(parseUrlState("https://example.test/en/tree/node/1001"), {
    kind: URL_ROUTE_KINDS.TREE_NODE,
    locale: "en",
    hasLocalePath: true,
    id: "1001",
    url: new URL("https://example.test/en/tree/node/1001")
  });
  const event = parseUrlState("/ja/compendium/event/event_6?mode=versus");
  assert.equal(event.kind, URL_ROUTE_KINDS.COMPENDIUM_CARD);
  assert.equal(event.category, "event");
  assert.equal(event.id, "event_6");
  assert.equal(event.eventMode, "versus");

  const collection = parseUrlState("/ko/compendium/monster");
  assert.equal(collection.kind, URL_ROUTE_KINDS.COMPENDIUM);
  assert.equal(collection.category, "monster");
  assert.equal(collection.locale, "ko");
  assert.equal(collection.hasLocalePath, true);

  const eventCollection = parseUrlState("/en/compendium/event?mode=coop");
  assert.equal(eventCollection.kind, URL_ROUTE_KINDS.COMPENDIUM);
  assert.equal(eventCollection.category, "event");
  assert.equal(eventCollection.eventMode, "coop");
});

test("url state: route builders preserve IDs, language, event mode, and share kind", () => {
  assert.equal(buildLocalePath({ locale: "ko", kind: URL_ROUTE_KINDS.TREE_NODE, id: "5007" }), "/ko/tree/node/5007");
  assert.equal(buildLocaleUrl({ locale: "ja", kind: URL_ROUTE_KINDS.COMPENDIUM_CARD, category: "event", id: "event_6", eventMode: "coop" }), "/ja/compendium/event/event_6?mode=coop");
  assert.equal(buildLocaleUrl({ locale: "en", kind: URL_ROUTE_KINDS.COMPENDIUM, category: "dice" }), "/en/compendium/dice");
  assert.equal(buildLocaleUrl({ locale: "ja", kind: URL_ROUTE_KINDS.COMPENDIUM, category: "event", eventMode: "versus" }), "/ja/compendium/event?mode=versus");
  assert.equal(buildPublicUrl({ origin: "https://example.test", locale: "en", kind: URL_ROUTE_KINDS.SIMULATION, share: "Ab1234" }), "https://example.test/simulation/Ab1234");
  assert.equal(buildPublicUrl({ origin: "https://example.test", locale: "zh-tw", kind: URL_ROUTE_KINDS.SIMULATION, share: "encoded", shareKind: "state" }), "https://example.test/simulation/state/encoded");
  const share = parseUrlState("https://example.test/simulation/Ab1234");
  assert.equal(share.locale, null);
  assert.equal(share.hasLocalePath, false);
  assert.equal(buildAlternateLocaleUrl("https://example.test/zh-tw/compendium/dice/1001", "en"), "https://example.test/en/compendium/dice/1001");
  assert.equal(buildAlternateLocaleUrl("https://example.test/zh-tw/compendium/monster", "ja"), "https://example.test/ja/compendium/monster");
  assert.equal(buildUrlStatePath("/zh-tw/compendium/event?mode=coop", "en"), "/en/compendium/event?mode=coop");
  assert.equal(buildAlternateLocaleUrl("https://example.test/simulation/Ab1234", "en"), "https://example.test/simulation/Ab1234");
});

test("url state: legacy query routes remain readable while new URLs are canonical", () => {
  const legacy = parseUrlState("https://example.test/index.html?node=5007");
  assert.equal(legacy.kind, URL_ROUTE_KINDS.TREE_NODE);
  assert.equal(legacy.id, "5007");
  assert.equal(legacy.hasLocalePath, false);
  assert.equal(buildLocaleUrl({ ...legacy, locale: "en" }), "/en/tree/node/5007");
});
