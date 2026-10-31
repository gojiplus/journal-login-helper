import test from "node:test";
import assert from "node:assert/strict";
import { journalScope } from "../extension/scope.js";

const base = "https://mc.manuscriptcentral.com";

test("journal identity ignores session queries, fragments, trailing slash and child pages", () => {
  const scope = journalScope(`${base}/jepop`);
  for (const suffix of [
    "",
    "/",
    "/login",
    "?PARAMS=temporary",
    "#login",
    "/login?session=123",
  ]) {
    assert.deepEqual(journalScope(`${base}/jepop${suffix}`), scope);
  }
  assert.equal(scope.label, "JEPOP");
  assert.equal(scope.key, `journal:${base}/jepop`);
});

test("distinct journals and path case retain distinct identities", () => {
  const keys = ["jepop", "jepop2", "Jepop", "other-journal"].map(
    (p) => journalScope(`${base}/${p}`).key,
  );
  assert.equal(new Set(keys).size, 4);
});

test("only the supported HTTPS host and journal paths are accepted", () => {
  for (const url of [
    undefined,
    "",
    "invalid",
    base,
    `${base}/`,
    `${base}/login`,
    `${base}/LOGIN/next`,
    `${base}/auth`,
    `${base}/jepop%2Fother`,
    `${base}/jepop%3Fother`,
    `${base}//jepop`,
    `${base}:8443/jepop`,
    "http://mc.manuscriptcentral.com/jepop",
    "https://mc.manuscriptcentral.com.evil.example/jepop",
    "https://mc.manuscriptcentral.com@evil.example/jepop",
    "https://username:secret@mc.manuscriptcentral.com/jepop",
    "https://mc.manuscriptcentral.com./jepop",
    "chrome://extensions/",
    "file:///jepop",
  ]) {
    assert.equal(journalScope(url), null, String(url));
  }
});

test("URL normalization does not retain a previous journal after dot-segment navigation", () => {
  assert.equal(journalScope(`${base}/jepop/../other`).path, "/other");
  assert.equal(journalScope(`${base}/jepop/%2e%2e/login`), null);
});
