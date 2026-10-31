export function validRecord(value) {
  return (
    value &&
    value.version === 1 &&
    typeof value.username === "string" &&
    value.username.trim().length > 0 &&
    typeof value.password === "string" &&
    value.password.length > 0 &&
    typeof value.revision === "string"
  );
}

export async function readRecord(storage, key) {
  const value = (await storage.get(key))[key];
  if (value === undefined) return null;
  if (!validRecord(value))
    throw new Error("This saved login could not be read. Nothing was changed.");
  return value;
}

export async function writeRecord(storage, key, credentials, expectedRevision) {
  const current = await readRecord(storage, key);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new Error(
      "This login changed in another window. Reload this page or reopen the helper before saving.",
    );
  }
  if (!credentials.username.trim() || !credentials.password) {
    throw new Error("Enter both a username and password.");
  }
  const record = {
    version: 1,
    username: credentials.username,
    password: credentials.password,
    revision: crypto.randomUUID(),
    updatedAt: new Date().toISOString(),
  };
  await storage.set({ [key]: record });
  return record;
}

export async function removeRecord(storage, key, expectedRevision) {
  const current = await readRecord(storage, key);
  if ((current?.revision ?? null) !== expectedRevision) {
    throw new Error(
      "This login changed in another window. Reopen the helper before removing it.",
    );
  }
  await storage.remove(key);
}
