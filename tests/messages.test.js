import test from "node:test";
import assert from "node:assert/strict";
import { handleJournalMessage } from "../extension/messages.js";

const url = "https://mc.manuscriptcentral.com/jepop";
const key = `journal:${url}`;
const credentials = { username: "author@example.test", password: "dummy" };

function setup() {
  const records = {};
  const sender = { id: "extension-id", frameId: 0, tab: { id: 7 }, url };
  const api = {
    runtime: { id: "extension-id" },
    tabs: { get: async () => ({ url }) },
    storage: {
      local: {
        get: async (name) => ({ [name]: records[name] }),
        set: async (values) => Object.assign(records, values),
      },
    },
  };
  const locks = { request: async (_name, fn) => fn() };
  return {
    sender,
    api,
    locks,
    records,
    call: (message) =>
      handleJournalMessage({ key, ...message }, sender, api, locks),
  };
}

test("a journal page can read and explicitly save only its own login", async () => {
  const f = setup();
  assert.equal((await f.call({ type: "journal:get" })).record, null);
  const result = await f.call({
    type: "journal:save",
    credentials,
    revision: null,
  });
  assert.equal(result.record.password, credentials.password);
  assert.deepEqual(Object.keys(f.records), [key]);
  assert.equal(
    (await f.call({ type: "journal:get" })).record.revision,
    result.record.revision,
  );
});

test("background rejects other journals, domains, extensions and frames", async () => {
  for (const patch of [
    { url: "https://mc.manuscriptcentral.com/other" },
    { url: "https://mc.manuscriptcentral.com.evil.example/jepop" },
    { url: "https://mc.manuscriptcentral.com/login" },
    { frameId: 1 },
    { id: "different-extension" },
    { tab: undefined },
  ]) {
    const f = setup();
    Object.assign(f.sender, patch);
    await assert.rejects(f.call({ type: "journal:get" }), /not from/);
    await assert.rejects(
      f.call({ type: "journal:save", credentials, revision: null }),
      /not from/,
    );
    assert.deepEqual(f.records, {});
  }
});

test("navigation before the message arrives blocks access", async () => {
  const f = setup();
  f.api.tabs.get = async () => ({
    url: "https://mc.manuscriptcentral.com/other",
  });
  await assert.rejects(f.call({ type: "journal:get" }), /journal changed/);
  await assert.rejects(
    f.call({ type: "journal:save", credentials, revision: null }),
    /journal changed/,
  );
});

test("navigation while awaiting the write lock blocks the save", async () => {
  const f = setup();
  f.locks.request = async (_name, fn) => {
    f.api.tabs.get = async () => ({
      url: "https://mc.manuscriptcentral.com/other",
    });
    return fn();
  };
  await assert.rejects(
    f.call({ type: "journal:save", credentials, revision: null }),
    /journal changed/,
  );
  assert.deepEqual(f.records, {});
});

test("a stale inline update cannot replace a newer popup save", async () => {
  const f = setup();
  const first = (
    await f.call({ type: "journal:save", credentials, revision: null })
  ).record;
  await f.call({
    type: "journal:save",
    credentials: { ...credentials, password: "new" },
    revision: first.revision,
  });
  await assert.rejects(
    f.call({ type: "journal:save", credentials, revision: first.revision }),
    /another window/,
  );
  assert.equal(f.records[key].password, "new");
});

test("malformed saves and unsupported actions are rejected", async () => {
  const f = setup();
  for (const message of [
    { type: "journal:save", credentials: null, revision: null },
    { type: "journal:save", credentials },
    {
      type: "journal:save",
      credentials: { username: 1, password: "a" },
      revision: null,
    },
    { type: "journal:remove" },
  ]) {
    await assert.rejects(f.call(message));
  }
  assert.deepEqual(f.records, {});
});
