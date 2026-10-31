import test from "node:test";
import assert from "node:assert/strict";
import { readRecord, writeRecord, removeRecord } from "../extension/records.js";

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return structuredClone({ [key]: data[key] });
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(key) {
      delete data[key];
    },
  };
}

test("same username, different journals: save, update and forget stay isolated", async () => {
  const storage = memoryStorage();
  const a = await writeRecord(
    storage,
    "journal:a",
    { username: "author@example.test", password: "alpha" },
    null,
  );
  const b = await writeRecord(
    storage,
    "journal:b",
    { username: "author@example.test", password: "beta" },
    null,
  );
  const updated = await writeRecord(
    storage,
    "journal:b",
    { username: b.username, password: "new beta" },
    b.revision,
  );
  assert.deepEqual(await readRecord(storage, "journal:a"), a);
  assert.equal((await readRecord(storage, "journal:b")).password, "new beta");
  assert.notEqual(updated.revision, b.revision);
  await removeRecord(storage, "journal:b", updated.revision);
  assert.equal(await readRecord(storage, "journal:b"), null);
  assert.deepEqual(await readRecord(storage, "journal:a"), a);
});

test("stale windows cannot overwrite or delete newer credentials", async () => {
  const storage = memoryStorage();
  const first = await writeRecord(
    storage,
    "journal:a",
    { username: "u", password: "p" },
    null,
  );
  const second = await writeRecord(
    storage,
    "journal:a",
    { username: "u", password: "new" },
    first.revision,
  );
  await assert.rejects(
    writeRecord(
      storage,
      "journal:a",
      { username: "u", password: "old" },
      first.revision,
    ),
    /another window/,
  );
  await assert.rejects(
    removeRecord(storage, "journal:a", first.revision),
    /another window/,
  );
  await assert.rejects(
    writeRecord(
      storage,
      "journal:a",
      { username: "u", password: "overwrite" },
      null,
    ),
    /another window/,
  );
  assert.deepEqual(await readRecord(storage, "journal:a"), second);
});

test("empty credentials are rejected without creating a record", async () => {
  const storage = memoryStorage();
  for (const credentials of [
    { username: "", password: "p" },
    { username: " \t", password: "p" },
    { username: "u", password: "" },
  ]) {
    await assert.rejects(
      writeRecord(storage, "journal:a", credentials, null),
      /both/,
    );
  }
  assert.deepEqual(storage.data, {});
});

test("credential characters are preserved exactly", async () => {
  const storage = memoryStorage();
  const credentials = {
    username: " a+研究@example.test ",
    password: " \t<>&\"'🔒\n ",
  };
  const record = await writeRecord(storage, "journal:a", credentials, null);
  assert.equal(record.username, credentials.username);
  assert.equal(record.password, credentials.password);
});

test("corrupt or unknown records are preserved instead of overwritten", async () => {
  const storage = memoryStorage();
  const bad = { version: 99, password: "keep" };
  storage.data["journal:a"] = bad;
  await assert.rejects(readRecord(storage, "journal:a"), /could not be read/);
  await assert.rejects(
    writeRecord(storage, "journal:a", { username: "u", password: "new" }, null),
    /could not be read/,
  );
  assert.deepEqual(storage.data["journal:a"], bad);
});

test("storage write errors are surfaced", async () => {
  const storage = memoryStorage();
  storage.set = async () => {
    throw new Error("QUOTA_BYTES");
  };
  await assert.rejects(
    writeRecord(storage, "journal:a", { username: "u", password: "p" }, null),
    /QUOTA_BYTES/,
  );
  assert.equal(await readRecord(storage, "journal:a"), null);
});
