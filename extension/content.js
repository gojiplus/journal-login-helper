(() => {
  if (globalThis.journalLoginHelperStarted) return;
  globalThis.journalLoginHelperStarted = true;
  import(chrome.runtime.getURL("inline.js"))
    .then(({ startInlineHelper }) => startInlineHelper())
    .catch(() =>
      console.warn(
        "Journal Login Helper could not start. Reload the page after reloading the extension.",
      ),
    );
})();
