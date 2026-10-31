import { handleJournalMessage } from "./messages.js";
import { journalScope } from "./scope.js";

const ready = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!["journal:get", "journal:save"].includes(message?.type)) return;
  ready
    .then(() => handleJournalMessage(message, sender, chrome, navigator.locks))
    .then(respond, (error) => respond({ error: error.message }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  chrome.tabs
    .query({ url: "https://mc.manuscriptcentral.com/*" })
    .then((tabs) => {
      for (const tab of tabs) {
        const scope = journalScope(tab.url);
        if (scope && Object.hasOwn(changes, scope.key)) {
          chrome.tabs
            .sendMessage(
              tab.id,
              { type: "journal:changed", key: scope.key },
              { frameId: 0 },
            )
            .catch(() => {}); // A tab may be navigating or predate the extension reload.
        }
      }
    })
    .catch(() => {});
});
