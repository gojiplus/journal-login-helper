# Journal Login Helper

A small Chrome extension for journal accounts that share a website but use different passwords. It keeps a separate login for each ScholarOne journal path, so `mc.manuscriptcentral.com/jepop` and `mc.manuscriptcentral.com/other-journal` can use the same username without replacing one another’s password.

This first version supports **HTTPS pages on `mc.manuscriptcentral.com`**, with one login per journal. It does not connect to Google Password Manager’s vault. Chrome can continue handling your other websites.

## Install in Chrome

No build or npm installation is needed to use the extension.

1. Download or clone this repository and keep the folder somewhere permanent.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select this repository’s **`extension`** folder, the folder containing `manifest.json`.
5. Open Chrome’s puzzle-piece menu and pin **Journal Login Helper**.

For this checkout, the installation folder is:

```text
/Users/soodoku/Documents/GitHub/gojiplus/journal-login-helper/extension
```

After pulling code updates, click the extension’s **Reload** button on `chrome://extensions`. Reloading preserves saved logins. Removing the extension deletes them; moving the installation folder can also require reinstallation.

## Use it

1. Open the journal’s login page, such as `https://mc.manuscriptcentral.com/jepop`.
2. Enter the correct credentials on the page, or select them from Chrome’s password picker.
3. Click the helper icon. Check the journal name and path shown at the top.
4. Click **Read from page**, then **Save JEPOP**. You can also type or paste credentials directly into the helper.
5. On your next visit, open the helper and click **Fill saved login**, then sign in normally.

For a password change, enter the new password in the helper and click **Update JEPOP**. You can do this while visiting any page under that journal’s path. Nothing is updated automatically. Each journal’s entry is independent, including when usernames are identical. **Forget this journal** removes only the current journal’s entry.

If Chrome fills an incorrect password, use the helper after Chrome has filled the page. It reports immediate changes to its fill, but it does not continuously monitor or suppress Chrome’s autofill. Do not accept a misleading Chrome save/update prompt. The helper neither disables Chrome’s password manager nor changes its saved passwords.

## How matching works

The first URL path segment is the journal identity, using the exact HTTPS origin. `/jepop`, `/jepop/`, and `/jepop/login` share an entry. `/jepop2` does not. Query strings and fragments are excluded, so session parameters are not saved. Path case is preserved.

The popup checks the journal and page document again before reading, filling, or saving. A navigation or a change to another journal requires reopening the popup. A shared `/login` page is not treated as a journal. The helper does not guess journal identity across redirects to shared authentication pages.

The form reader requires one visible, editable password field and one identifiable username field in the same form. It ignores hidden fields, prefers `autocomplete="username"`, and recognizes common username/email field names. Multiple password fields and password-change forms are rejected. Passwords are filled only when requested; the extension never submits a form.

Embedded frames, shadow DOM login forms, multi-step login pages, other ScholarOne hosts, and other submission platforms are not supported in this first version. A journal that loses its path during login needs a site-specific adaptation. Real ScholarOne login/redirect behavior still needs a trial; local tests use dummy pages and credentials.

## Storage and permissions

Credentials are stored in this extension’s `chrome.storage.local` area in your Chrome profile. There is no vault encryption, master password, cloud sync, telemetry, or server. They are not written into this repository. Keep another copy if you need recovery: uninstalling deletes the extension’s records.

The extension requests `activeTab`, `scripting`, and `storage`. Clicking its toolbar button gives it temporary access to that tab; there is no permission to run automatically across all websites. Storage access is restricted to extension pages and its service worker. Only the selected journal’s credential is sent to a page when you click Fill.

## Development

Use Node.js 22 or newer. The extension itself has no runtime dependencies or build step.

```sh
npm install
npx playwright install chromium
npm run check
```

`npm test` runs unit tests for journal identity, distinct same-username entries, updates, stale writes, deletion, form selection, and navigation during filling. `npm run lint` checks JavaScript syntax and Prettier formatting. `npm run test:browser` launches an isolated persistent Chromium profile with the actual extension and dummy journal pages; it exercises the toolbar action, save/fill/update, browser restart, deletion, and navigation. Browser tests never use your normal Chrome profile or real journal accounts.

The browser tests use the Chrome DevTools Protocol’s experimental `Extensions.triggerAction` command to grant `activeTab` through the real action. Use Playwright’s bundled Chromium. To test with an already installed compatible Chromium, set `JOURNAL_HELPER_CHROMIUM` to its executable path. Tests fail if the browser cannot launch; they are not silently skipped.

```sh
npm run format
npm test
npm run test:browser
```

GitHub Actions runs the same checks on Linux. Only development dependencies need npm; the installable extension is the `extension/` folder.

## References

- [Chrome activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
- [Chrome DevTools extension actions](https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Extensions.pdl)
