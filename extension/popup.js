import { journalScope } from "./scope.js";
import { pageAction } from "./page-action.js";
import { readRecord, writeRecord, removeRecord } from "./records.js";

const el = (id) => document.getElementById(id);
let tabId;
let scope;
let documentId;
let saved = null;
let busy = false;

function status(message, error = false) {
  el("status").textContent = message;
  el("status").dataset.error = String(error);
}

function render() {
  el("saved-state").textContent = saved
    ? `Saved for ${scope.label}`
    : "No login saved for this journal yet.";
  el("fill").disabled = !saved;
  el("save").textContent = `${saved ? "Update" : "Save"} ${scope.label}`;
  el("forget").hidden = !saved;
  el("username").value = saved?.username ?? "";
  el("password").value = saved?.password ?? "";
  el("password").type = "password";
  el("reveal").textContent = "Show";
  el("reveal").setAttribute("aria-label", "Show password");
  el("reveal").setAttribute("aria-pressed", "false");
}

async function onPage(action, credentials) {
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, ...(documentId ? { documentIds: [documentId] } : {}) },
      func: pageAction,
      args: [action, scope, credentials ?? null],
    });
  } catch {
    throw new Error(
      "This page is no longer available. Close and reopen the helper on the journal’s login page.",
    );
  }
  const result = results[0];
  if (!result?.result)
    throw new Error(
      "Could not read this page. Reopen the helper and try again.",
    );
  if (result.result.error) throw new Error(result.result.error);
  documentId = result.documentId;
  return result.result;
}

async function run(operation) {
  if (busy) return;
  busy = true;
  el("controls").disabled = true;
  status("");
  try {
    await operation();
  } catch (error) {
    status(error.message, true);
  } finally {
    busy = false;
    el("controls").disabled = false;
  }
}

el("read").addEventListener("click", () =>
  run(async () => {
    const credentials = await onPage("read");
    el("username").value = credentials.username;
    el("password").value = credentials.password;
    status(
      `Read from ${scope.label}. Click ${saved ? "Update" : "Save"} to remember it.`,
    );
  }),
);

el("fill").addEventListener("click", () =>
  run(async () => {
    const latest = await readRecord(chrome.storage.local, scope.key);
    if (!latest || latest.revision !== saved?.revision) {
      throw new Error(
        "This saved login changed. Reopen the helper before filling.",
      );
    }
    await onPage("fill", {
      username: latest.username,
      password: latest.password,
    });
    status(`Filled ${scope.label}. Sign in on the page when ready.`);
  }),
);

el("login").addEventListener("submit", (event) => {
  event.preventDefault();
  run(async () => {
    const credentials = {
      username: el("username").value,
      password: el("password").value,
    };
    await onPage("check");
    await navigator.locks.request(scope.key, async () => {
      saved = await writeRecord(
        chrome.storage.local,
        scope.key,
        credentials,
        saved?.revision ?? null,
      );
    });
    render();
    status(`Saved for ${scope.label}. Other journals are unchanged.`);
  });
});

el("forget").addEventListener("click", () =>
  run(async () => {
    if (!confirm(`Forget the saved login for ${scope.label}?`)) return;
    await navigator.locks.request(scope.key, () =>
      removeRecord(chrome.storage.local, scope.key, saved?.revision ?? null),
    );
    saved = null;
    render();
    status(`Forgot ${scope.label}.`);
  }),
);

el("reveal").addEventListener("click", () => {
  const show = el("password").type === "password";
  el("password").type = show ? "text" : "password";
  el("reveal").textContent = show ? "Hide" : "Show";
  el("reveal").setAttribute(
    "aria-label",
    show ? "Hide password" : "Show password",
  );
  el("reveal").setAttribute("aria-pressed", String(show));
});

async function initialize() {
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  scope = journalScope(tab?.url);
  if (!scope) {
    el("scope").textContent =
      "Open a journal-specific ScholarOne login, such as mc.manuscriptcentral.com/jepop, then click the extension again.";
    return;
  }
  tabId = tab.id;
  el("journal").textContent = scope.label;
  el("scope").textContent =
    `${scope.origin.replace("https://", "")}${scope.path}`;
  await onPage("check");
  saved = await readRecord(chrome.storage.local, scope.key);
  render();
  el("login").hidden = false;
}

initialize().catch((error) => status(error.message, true));
