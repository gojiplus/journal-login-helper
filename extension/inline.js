import { journalScope } from "./scope.js";
import { pageAction } from "./page-action.js";

export function startInlineHelper() {
  const scope = journalScope(location.href);
  if (!scope) return;
  let saved = null;
  let ready = false;
  let busy = false;
  let dismissed = false;
  let stopped = false;
  let timer;
  let notice = "";
  let loadSequence = 0;
  let lastFill = null;
  const touched = new WeakSet();
  const attempted = new WeakSet();
  const host = document.createElement("journal-login-helper");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; display: block; margin: 12px 0; max-width: 480px; }
    section { font: 13px/1.5 system-ui, sans-serif; color: #1b302c; background: #f0f6f1; border: 1px solid #c4d6ca; border-radius: 8px; padding: 12px 14px; }
    strong { display: block; font-size: 13px; } p { margin: 4px 0 10px; overflow-wrap: anywhere; }
    button { font: inherit; cursor: pointer; border-radius: 5px; padding: 6px 10px; margin: 0 8px 0 0; border: 1px solid #21594c; background: #21594c; color: white; }
    button.secondary { color: #365349; background: transparent; border-color: transparent; }
    button:focus-visible { outline: 2px solid #21594c; outline-offset: 2px; }
    button:disabled { opacity: .5; cursor: default; }
    [hidden] { display: none !important; }
  `;
  const box = document.createElement("section");
  box.setAttribute("aria-label", "Journal Login Helper");
  const title = document.createElement("strong");
  const detail = document.createElement("p");
  detail.setAttribute("role", "status");
  detail.setAttribute("aria-live", "polite");
  const action = document.createElement("button");
  const dismiss = document.createElement("button");
  action.type = dismiss.type = "button";
  dismiss.className = "secondary";
  dismiss.textContent = "Not now";
  box.append(title, detail, action, dismiss);
  shadow.append(style, box);
  let view = null;

  const sameJournal = () => journalScope(location.href)?.key === scope.key;
  const sameCredentials = (a, b) =>
    a?.username === b?.username && a?.password === b?.password;

  async function request(type, extra = {}) {
    if (!sameJournal())
      throw new Error("The journal changed. Reload this page.");
    const response = await chrome.runtime.sendMessage({
      type,
      key: scope.key,
      ...extra,
    });
    if (!sameJournal())
      throw new Error("The journal changed. Reload this page.");
    if (!response || response.error)
      throw new Error(
        response?.error || "Reload this page to reconnect the helper.",
      );
    return response.record;
  }

  function offer() {
    const fields = pageAction("fields", scope);
    if (!fields.error) {
      const credentials = {
        username: fields.username.value,
        password: fields.password.value,
      };
      if (
        credentials.username.trim() &&
        credentials.password &&
        !sameCredentials(credentials, saved)
      ) {
        const kind = !saved
          ? "remember"
          : touched.has(fields.username) || touched.has(fields.password)
            ? "update"
            : "fill";
        return {
          kind,
          credentials,
          anchor: fields.form || fields.password.parentElement,
        };
      }
      return {
        kind: saved
          ? sameCredentials(credentials, saved)
            ? "filled"
            : "fill"
          : "empty",
        credentials,
        anchor: fields.form || fields.password.parentElement,
      };
    }
    if (saved) {
      const change = pageAction("change", scope);
      if (!change.error && (change.password !== saved.password || notice)) {
        return {
          kind: change.password !== saved.password ? "update" : "filled",
          credentials: {
            username: change.username || saved.username,
            password: change.password,
          },
          anchor: change.form,
        };
      }
    }
    return null;
  }

  function render(next) {
    view = next;
    if (!next || dismissed || stopped || next.kind === "empty") {
      host.remove();
      return;
    }
    if (!host.isConnected || host.previousElementSibling !== next.anchor)
      next.anchor.after(host);
    title.textContent =
      next.kind === "remember"
        ? `Remember login for ${scope.label}?`
        : next.kind === "update"
          ? `Update login for ${scope.label}?`
          : `${scope.label} login`;
    detail.textContent =
      notice ||
      (next.kind === "remember"
        ? "Next time, your login will fill automatically."
        : next.kind === "update"
          ? `Replace the saved login with the credentials entered for ${next.credentials.username}?`
          : next.kind === "fill"
            ? "The form already contains different or edited credentials. Use your saved journal login instead?"
            : "Your saved login is filled. Sign in when ready.");
    action.hidden = next.kind === "filled";
    action.textContent =
      next.kind === "remember"
        ? "Remember login"
        : next.kind === "fill"
          ? "Use saved login"
          : "Update saved login";
    action.disabled = busy;
    dismiss.textContent = next.kind === "filled" ? "Dismiss" : "Not now";
  }

  function stopForNavigation() {
    stopped = true;
    host.remove();
    observer.disconnect();
    clearInterval(heartbeat);
    clearTimeout(timer);
    // Remove only our untouched autofill if a SPA reuses the form for another journal.
    if (
      lastFill &&
      sameCredentials(
        {
          username: lastFill.username.value,
          password: lastFill.password.value,
        },
        lastFill.credentials,
      )
    ) {
      for (const input of [lastFill.username, lastFill.password]) {
        if (!input.isConnected) continue;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, "");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    saved = null;
    lastFill = null;
    view = null;
    notice = "";
  }

  function scan() {
    if (stopped || busy) return;
    if (!sameJournal()) {
      stopForNavigation();
      return;
    }
    if (!ready) return;
    const fields = pageAction("fields", scope);
    if (!fields.error && saved && !attempted.has(fields.password)) {
      const empty =
        !fields.password.value &&
        (!fields.username.value || fields.username.value === saved.username);
      if (
        empty &&
        !touched.has(fields.username) &&
        !touched.has(fields.password)
      ) {
        attempted.add(fields.password);
        const result = pageAction("fill", scope, saved);
        if (result.ok)
          lastFill = {
            username: fields.username,
            password: fields.password,
            credentials: saved,
          };
        else notice = result.error;
      }
    }
    const next = offer();
    if (next && view && !sameCredentials(next.credentials, view.credentials))
      notice = "";
    render(next);
  }

  function schedule(event) {
    if (stopped) return;
    if (event?.isTrusted && event.target instanceof HTMLInputElement)
      touched.add(event.target);
    clearTimeout(timer);
    timer = setTimeout(scan, 100);
  }

  async function refresh() {
    const sequence = ++loadSequence;
    try {
      const record = await request("journal:get");
      if (sequence !== loadSequence || stopped) return;
      saved = record;
      ready = true;
      scan();
    } catch {
      if (sequence !== loadSequence || stopped) return;
      ready = false;
      host.remove();
    }
  }

  action.addEventListener("click", async (event) => {
    if (!event.isTrusted || busy || stopped || !sameJournal()) return;
    const current = offer();
    if (
      !current ||
      !["remember", "update", "fill"].includes(current.kind) ||
      current.kind !== view?.kind ||
      current.credentials.username !== view.credentials.username
    ) {
      scan();
      return;
    }
    busy = true;
    action.disabled = true;
    try {
      if (current.kind === "fill") {
        saved = await request("journal:get");
        if (!saved)
          throw new Error(
            "This saved login was removed. Enter your credentials to remember it again.",
          );
        const fields = pageAction("fields", scope);
        const result = pageAction("fill", scope, saved);
        if (!result.ok) throw new Error(result.error);
        lastFill = {
          username: fields.username,
          password: fields.password,
          credentials: saved,
        };
        notice = "Your saved login is filled. Sign in when ready.";
      } else {
        saved = await request("journal:save", {
          credentials: current.credentials,
          revision: saved?.revision ?? null,
        });
        notice = `Saved for ${scope.label}. Your login will fill automatically next time.`;
      }
    } catch (error) {
      notice = error.message;
    } finally {
      busy = false;
      scan();
    }
  });
  dismiss.addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    dismissed = true;
    host.remove();
  });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "type",
      "hidden",
      "style",
      "class",
      "disabled",
      "readonly",
      "autocomplete",
    ],
  });
  for (const event of ["input", "change", "keydown", "paste"])
    document.addEventListener(event, schedule, true);
  // Autofill and history.pushState do not reliably emit input or DOM mutation events.
  const heartbeat = setInterval(() => {
    if (!document.hidden) scan();
  }, 1000);
  window.addEventListener("popstate", scan);
  window.addEventListener("pageshow", refresh);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (
      sender.id === chrome.runtime.id &&
      message?.type === "journal:changed" &&
      message.key === scope.key
    )
      refresh();
  });
  refresh();
}
