# Journal Login Helper

A small Chrome extension for journal accounts that share a website but use different passwords. It keeps a separate login for each ScholarOne journal path, so `mc.manuscriptcentral.com/jepop` and `mc.manuscriptcentral.com/other-journal` can use the same username without replacing one another’s password.

Saved logins fill automatically when you return to a journal. A small prompt beside the login form lets you remember new credentials or confirm an update. The extension supports **HTTPS pages on `mc.manuscriptcentral.com`**, with one login per journal. It does not connect to Google Password Manager’s vault. Chrome can continue handling your other websites.

## Install in Chrome

No build or npm installation is needed to use the extension.

1. Download or clone this repository and keep the folder somewhere permanent.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select this repository’s **`extension`** folder, the folder containing `manifest.json`.
5. Allow access to `mc.manuscriptcentral.com` if Chrome asks. Pin **Journal Login Helper** if you want quick access to the optional editing controls.

For this checkout, the installation folder is:

```text
/Users/soodoku/Documents/GitHub/gojiplus/journal-login-helper/extension
```

After pulling code updates, click the extension’s **Reload** button on `chrome://extensions`, then refresh any open journal pages. When updating from the manual-only version, Chrome may ask you to approve the new site access. Existing saved logins are retained and become available for automatic filling. Removing the extension deletes them; moving the installation folder can also require reinstallation.

## Use it

1. Open the journal’s login page, such as `https://mc.manuscriptcentral.com/jepop`.
2. Enter the correct credentials on the page, or select them from Chrome’s password picker.
3. Click **Remember login** in the **Remember login for JEPOP?** prompt beside the form. **Not now** dismisses the prompt for this visit without saving anything.
4. On your next visit, the helper fills the saved username and password automatically. Just click the journal’s **Log in** button.

If you type different credentials into a saved journal’s login form, the helper offers **Update saved login**. It also recognizes password-change forms with `autocomplete="new-password"`: the new password and confirmation must agree before an update is offered. The old password is never automatically filled into a password-change form. Saving and updating always require your click; the helper never submits a form or verifies whether a login or password change succeeded.

The toolbar icon is for occasional management: read credentials from a page, edit them directly, fill manually, or **Forget this journal**. Each journal’s entry is independent, including when usernames are identical.

Automatic filling waits for a recognizable login form and never overwrites credentials you have started typing. If Chrome or the website has already filled different credentials, use the inline **Use saved login** button or the toolbar’s **Fill saved login** button. The helper does not fight subsequent Chrome autofill, disable Google Password Manager, or change Google’s saved passwords.

## How matching works

The first URL path segment is the journal identity, using the exact HTTPS origin. `/jepop`, `/jepop/`, and `/jepop/login` share an entry. `/jepop2` does not. Query strings and fragments are excluded, so session parameters are not saved. Path case is preserved.

The helper checks the journal again before reading, filling, or saving. A full navigation starts a fresh lookup for the new journal. If a page changes its journal path without reloading, the helper stops and clears its own untouched autofill; reload that page to resume. A shared `/login` page is not treated as a journal. The helper does not guess journal identity across redirects to shared authentication pages.

The login reader requires one visible, editable password field and one identifiable username field in the same form. It ignores hidden fields, prefers `autocomplete="username"`, and recognizes common username/email field names. Multiple login forms are rejected. New-password fields are used only for an explicit save/update prompt, never for automatic filling.

Embedded frames, shadow DOM login forms, multi-step login pages, other ScholarOne hosts, and other submission platforms are not supported. A journal that loses its path during login needs a site-specific adaptation. Real ScholarOne login/redirect behavior still needs a trial; automated tests use dummy pages and credentials.

## Storage and permissions

Credentials are stored in this extension’s `chrome.storage.local` area in your Chrome profile. There is no vault encryption, master password, cloud sync, telemetry, or server. They are not written into this repository. Keep another copy if you need recovery: uninstalling deletes the extension’s records.

The extension requests `scripting`, `storage`, and access to `https://mc.manuscriptcentral.com/*`. That site access lets it recognize forms and fill saved logins without opening the toolbar. It has no automatic access to other websites. Storage is restricted to extension pages and its service worker. The worker checks the requesting page, frame, and current tab before returning or saving that journal’s entry; content scripts cannot read the entire vault.

## Development

Use Node.js 22 or newer. The extension itself has no runtime dependencies or build step.

```sh
npm ci
npx playwright install chromium
npm run check
```

`npm test` runs unit tests for journal identity, message authorization, distinct same-username entries, updates, stale writes, deletion, form selection, and navigation during filling. `npm run lint` checks JavaScript syntax and Prettier formatting. `npm run test:browser` launches an isolated persistent Chromium profile with the actual extension and dummy journal pages. It exercises inline prompts, automatic filling, delayed forms, explicit password updates, browser restart, journal isolation, and the optional toolbar controls. Browser tests never use your normal Chrome profile or real journal accounts.

The toolbar tests use the Chrome DevTools Protocol’s experimental `Extensions.triggerAction` command, then inspect the popup document in a background tab while leaving the journal tab active. Inline tests never open the toolbar. Tests use the production manifest and real Chrome APIs. Use Playwright’s bundled Chromium. To test with an already installed compatible Chromium, set `JOURNAL_HELPER_CHROMIUM` to its executable path. Tests fail if the browser cannot launch; they are not silently skipped.

```sh
npm run format
npm test
npm run test:browser
```

GitHub Actions runs the same checks on Linux. Only development dependencies need npm; the installable extension is the `extension/` folder.

## References

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
- [Chrome DevTools extension actions](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Extensions.pdl)
