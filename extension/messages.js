import { journalScope } from "./scope.js";
import { readRecord, writeRecord } from "./records.js";

export async function handleJournalMessage(message, sender, api, locks) {
  const scope = journalScope(sender.url);
  if (
    sender.id !== api.runtime.id ||
    sender.frameId !== 0 ||
    !Number.isInteger(sender.tab?.id) ||
    !scope ||
    message.key !== scope.key
  ) {
    throw new Error(
      "This request is not from the current journal’s login page.",
    );
  }
  const checkTab = async () => {
    const tab = await api.tabs.get(sender.tab.id);
    if (journalScope(tab.url)?.key !== scope.key) {
      throw new Error(
        "The journal changed. Reload the page before continuing.",
      );
    }
  };
  await checkTab();
  if (message.type === "journal:get") {
    return { record: await readRecord(api.storage.local, scope.key) };
  }
  if (message.type !== "journal:save")
    throw new Error("Unknown journal request.");
  if (
    typeof message.credentials?.username !== "string" ||
    typeof message.credentials?.password !== "string" ||
    !(message.revision === null || typeof message.revision === "string")
  ) {
    throw new Error("Enter a username and password before saving.");
  }
  return locks.request(scope.key, async () => {
    await checkTab();
    return {
      record: await writeRecord(
        api.storage.local,
        scope.key,
        message.credentials,
        message.revision,
      ),
    };
  });
}
