import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { journalScope } from "../extension/scope.js";

const origin = "https://mc.manuscriptcentral.com";
const html = `<!doctype html><html><head><title>Journal login fixture</title></head>
<body><h1>Journal login</h1><form id="login"><label>Username<input name="USERID" autocomplete="username"></label>
<label>Password<input name="PASSWORD" type="password" autocomplete="current-password"></label>
<button>Sign in</button></form><script>
window.submissions = 0;
document.querySelector('form').addEventListener('submit', event => {event.preventDefault(); window.submissions++;});
</script></body></html>`;

async function start(profile, fixtureHtml = html) {
  const extension = path.resolve("extension");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    ...(process.env.JOURNAL_HELPER_CHROMIUM
      ? { executablePath: process.env.JOURNAL_HELPER_CHROMIUM }
      : {}),
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  context.setDefaultTimeout(10000);
  context.on("page", (openedPage) => {
    openedPage.on("pageerror", (error) =>
      console.error("Browser test:", error.message),
    );
  });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).protocol === "chrome-extension:") {
      return route.continue();
    }
    if (new URL(route.request().url()).origin === origin) {
      return route.fulfill({ contentType: "text/html", body: fixtureHtml });
    }
    return route.abort();
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  const cdp = await context.browser().newBrowserCDPSession();
  async function popup() {
    await page.bringToFront();
    const { targetInfos } = await cdp.send("Target.getTargets", {
      filter: [{ type: "tab" }, { exclude: true }],
    });
    const target = targetInfos.find((info) => info.url === page.url());
    assert.ok(target, "The journal tab must have a DevTools tab target");
    // Exercise the real toolbar action, then inspect the popup as a tab.
    await cdp.send("Extensions.triggerAction", {
      id: extensionId,
      targetId: target.targetId,
    });
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const { targetInfos: popupTargets } = await cdp.send("Target.getTargets");
    for (const popupTarget of popupTargets.filter(
      (info) => info.url === popupUrl,
    )) {
      await cdp.send("Target.closeTarget", { targetId: popupTarget.targetId });
    }
    const opened = context.waitForEvent("page", { timeout: 10000 });
    // Keeping the journal tab active preserves the popup's actual tab lookup.
    await worker.evaluate(
      (url) => chrome.tabs.create({ url, active: false }),
      popupUrl,
    );
    const panel = await opened;
    await panel.locator("#login:not([hidden]), #scope").first().waitFor();
    try {
      await panel.waitForFunction(
        () =>
          !document.getElementById("login").hidden ||
          document.getElementById("status").textContent ||
          document
            .getElementById("scope")
            .textContent.includes("journal-specific"),
      );
      if (journalScope(page.url())) {
        assert.equal(
          await panel.locator("#login").isVisible(),
          true,
          `Popup initialization: ${await panel.locator("#scope").textContent()} ${await panel.locator("#status").textContent()}`,
        );
      }
    } catch (error) {
      await mkdir("test-results", { recursive: true });
      await panel.screenshot({
        path: `test-results/popup-error-${Date.now()}.png`,
        fullPage: true,
      });
      throw error;
    }
    return panel;
  }
  return { context, page, popup, worker };
}

async function statusContains(panel, text) {
  await panel.waitForFunction(
    (value) => document.getElementById("status").textContent.includes(value),
    text,
  );
}

test(
  "real extension: two journals, update isolation, persistence, boundaries and deletion",
  { timeout: 90000 },
  async (t) => {
    const profile = await mkdtemp(path.join(tmpdir(), "journal-helper-test-"));
    let app;
    t.after(async () => {
      await app?.context.close();
      await rm(profile, { recursive: true, force: true });
    });
    app = await start(profile);
    for (const [journal, password] of [
      ["jepop", "dummy-alpha"],
      ["other-journal", "dummy-beta"],
    ]) {
      await app.page.goto(`${origin}/${journal}?session=discard-me`);
      await app.page.locator('[name="USERID"]').fill("author@example.test");
      await app.page.locator('[name="PASSWORD"]').fill(password);
      const panel = await app.popup();
      await panel
        .getByRole("button", { name: "Read from page", exact: true })
        .click();
      await statusContains(panel, "Read from");
      assert.equal(await panel.locator("#password").inputValue(), password);
      await panel
        .getByRole("button", {
          name: `Save ${journal.toUpperCase()}`,
          exact: true,
        })
        .click();
      await statusContains(panel, "Saved for");
      await panel.close();
    }

    await app.page.goto(`${origin}/other-journal`);
    let panel = await app.popup();
    await panel.locator("#password").fill("dummy-beta-updated");
    await panel
      .getByRole("button", { name: "Update OTHER-JOURNAL", exact: true })
      .click();
    await statusContains(panel, "Saved for");
    await panel.close();

    await app.context.close();
    app = await start(profile);
    for (const [journal, password] of [
      ["jepop", "dummy-alpha"],
      ["other-journal", "dummy-beta-updated"],
    ]) {
      await app.page.goto(`${origin}/${journal}/?new-session=ignored`);
      panel = await app.popup();
      await panel
        .getByRole("button", { name: "Fill saved login", exact: true })
        .click();
      await statusContains(panel, "Filled");
      assert.equal(
        await app.page.locator('[name="USERID"]').inputValue(),
        "author@example.test",
      );
      assert.equal(
        await app.page.locator('[name="PASSWORD"]').inputValue(),
        password,
      );
      assert.equal(await app.page.evaluate(() => window.submissions), 0);
      await panel.close();
    }

    await app.page.goto(`${origin}/jepop2`);
    panel = await app.popup();
    await panel.locator("#saved-state").waitFor();
    assert.equal(await panel.locator("#fill").isDisabled(), true);
    assert.equal(await panel.locator("#password").inputValue(), "");
    await panel.close();

    await app.page.goto(`${origin}/jepop`);
    panel = await app.popup();
    await panel.locator("#username").waitFor();
    await app.page.evaluate(() => history.pushState({}, "", "/other-journal"));
    await panel
      .getByRole("button", { name: "Fill saved login", exact: true })
      .click();
    await statusContains(panel, "journal changed");
    await app.page.waitForFunction(
      () => document.querySelector('[name="PASSWORD"]').value === "",
    );
    assert.equal(await app.page.locator('[name="PASSWORD"]').inputValue(), "");
    await panel.close();

    await app.page.goto(`${origin}/other-journal`);
    panel = await app.popup();
    panel.once("dialog", (dialog) => dialog.accept());
    await panel
      .getByRole("button", { name: "Forget this journal", exact: true })
      .click();
    await statusContains(panel, "Forgot OTHER-JOURNAL");
    const records = await app.worker.evaluate(() =>
      chrome.storage.local.get(null),
    );
    assert.equal(records[`journal:${origin}/jepop`].password, "dummy-alpha");
    assert.equal(records[`journal:${origin}/other-journal`], undefined);
    await panel.close();

    await app.page.goto(`${origin}/jepop`);
    panel = await app.popup();
    await panel.locator("#username").waitFor();
    await mkdir("test-results", { recursive: true });
    await panel.setViewportSize({ width: 360, height: 640 });
    await panel.screenshot({ path: "test-results/popup.png", fullPage: true });
  },
);

async function waitForLogin(page, password) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[name="USERID"]')?.value ===
        "author@example.test" &&
      document.querySelector('[name="PASSWORD"]')?.value === expected,
    password,
  );
}

async function seed(app, journal, password = "saved-password") {
  await app.worker.evaluate(
    ({ journal, password, origin }) =>
      chrome.storage.local.set({
        [`journal:${origin}/${journal}`]: {
          version: 1,
          username: "author@example.test",
          password,
          revision: crypto.randomUUID(),
          updatedAt: new Date().toISOString(),
        },
      }),
    { journal, password, origin },
  );
}

test(
  "inline first visit, dismissal, return autofill, explicit updates and restart",
  { timeout: 90000 },
  async (t) => {
    const profile = await mkdtemp(
      path.join(tmpdir(), "journal-helper-inline-"),
    );
    let app;
    t.after(async () => {
      await app?.context.close();
      await rm(profile, { recursive: true, force: true });
    });
    app = await start(profile);
    await app.page.goto(`${origin}/jepop`);
    await app.page.locator('[name="USERID"]').fill("author@example.test");
    await app.page.locator('[name="PASSWORD"]').fill("alpha");
    await app.page
      .getByRole("button", { name: "Remember login", exact: true })
      .waitFor();
    await app.page
      .getByRole("button", { name: "Remember login", exact: true })
      .evaluate((button) => button.click());
    assert.deepEqual(
      await app.worker.evaluate(() => chrome.storage.local.get(null)),
      {},
    );
    await app.page
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    assert.deepEqual(
      await app.worker.evaluate(() => chrome.storage.local.get(null)),
      {},
    );
    await app.page.reload();
    assert.equal(await app.page.locator('[name="PASSWORD"]').inputValue(), "");

    for (const [journal, password] of [
      ["jepop", "alpha"],
      ["other-journal", "beta"],
    ]) {
      await app.page.goto(`${origin}/${journal}`);
      await app.page.locator('[name="USERID"]').fill("author@example.test");
      await app.page.locator('[name="PASSWORD"]').fill(password);
      await app.page
        .getByRole("button", { name: "Remember login", exact: true })
        .click();
      await app.page
        .getByText(
          `Saved for ${journal.toUpperCase()}. Your login will fill automatically next time.`,
          { exact: true },
        )
        .waitFor();
    }

    await app.page.goto(`${origin}/jepop?session=new`);
    await waitForLogin(app.page, "alpha");
    assert.equal(await app.page.evaluate(() => window.submissions), 0);
    await app.page.locator('[name="PASSWORD"]').fill("alpha-new");
    await app.page
      .getByRole("button", { name: "Update saved login", exact: true })
      .waitFor();
    assert.equal(
      (await app.worker.evaluate(() => chrome.storage.local.get(null)))[
        `journal:${origin}/jepop`
      ].password,
      "alpha",
    );
    await app.page
      .getByRole("button", { name: "Update saved login", exact: true })
      .click();
    await app.page
      .getByText(
        "Saved for JEPOP. Your login will fill automatically next time.",
        { exact: true },
      )
      .waitFor();
    const records = await app.worker.evaluate(() =>
      chrome.storage.local.get(null),
    );
    assert.equal(records[`journal:${origin}/jepop`].password, "alpha-new");
    assert.equal(records[`journal:${origin}/other-journal`].password, "beta");

    await app.context.close();
    app = await start(profile);
    await app.page.goto(`${origin}/jepop/login`);
    await waitForLogin(app.page, "alpha-new");
    assert.equal(await app.page.evaluate(() => window.submissions), 0);
    await mkdir("test-results", { recursive: true });
    await app.page.screenshot({ path: "test-results/inline-autofilled.png" });
    await app.page.goto(`${origin}/jepop2`);
    await app.page
      .getByRole("heading", { name: "Journal login", exact: true })
      .waitFor();
    assert.equal(await app.page.locator('[name="PASSWORD"]').inputValue(), "");
  },
);

test(
  "autofill handles delayed forms and leaves typed or prefilled credentials alone",
  { timeout: 60000 },
  async (t) => {
    const empty =
      "<!doctype html><html><body><h1>Loading journal</h1></body></html>";
    const app = await start("", empty);
    t.after(() => app.context.close());
    await seed(app, "jepop");
    await app.page.goto(`${origin}/jepop`);
    await app.page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form><input name="USERID"><input name="PASSWORD" type="password"><button>Sign in</button></form>',
      );
    });
    await waitForLogin(app.page, "saved-password");
    await app.page.locator('[name="PASSWORD"]').fill("editing-password");
    await app.page
      .getByRole("button", { name: "Update saved login", exact: true })
      .waitFor();
    await app.page.evaluate(() => document.body.classList.add("changed"));
    assert.equal(
      await app.page.locator('[name="PASSWORD"]').inputValue(),
      "editing-password",
    );

    await app.page.reload();
    await app.page.evaluate(() => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form><input name="USERID" value="wrong-account"><input name="PASSWORD" type="password" value="wrong-password"><button>Sign in</button></form>',
      );
    });
    await app.page
      .getByRole("button", { name: "Use saved login", exact: true })
      .waitFor();
    assert.equal(
      await app.page.locator('[name="PASSWORD"]').inputValue(),
      "wrong-password",
    );
    await app.page
      .getByRole("button", { name: "Use saved login", exact: true })
      .click();
    await waitForLogin(app.page, "saved-password");

    await app.page.evaluate(() => history.pushState({}, "", "/other-journal"));
    await app.page.waitForFunction(
      () => document.querySelector('[name="PASSWORD"]').value === "",
    );
    assert.equal(await app.page.locator('[name="USERID"]').inputValue(), "");
  },
);

test(
  "password-change forms offer explicit updates and never receive automatic fills",
  { timeout: 45000 },
  async (t) => {
    const changeHtml = `<!doctype html><html><body><form>
    <input aria-label="Current password" type="password" autocomplete="current-password">
    <input aria-label="New password" type="password" autocomplete="new-password">
    <input aria-label="Confirm password" type="password" autocomplete="new-password">
    <button type="button">Change password</button></form></body></html>`;
    const app = await start("", changeHtml);
    t.after(() => app.context.close());
    await seed(app, "jepop");
    await seed(app, "other-journal", "other-password");
    await app.page.goto(`${origin}/jepop/change-password`);
    assert.equal(
      await app.page
        .getByLabel("Current password", { exact: true })
        .inputValue(),
      "",
    );
    await app.page
      .getByLabel("Current password", { exact: true })
      .fill("saved-password");
    await app.page
      .getByLabel("New password", { exact: true })
      .fill("new-password");
    await app.page
      .getByLabel("Confirm password", { exact: true })
      .fill("mismatch");
    assert.equal(
      await app.page
        .getByRole("button", { name: "Update saved login", exact: true })
        .count(),
      0,
    );
    await app.page
      .getByLabel("Confirm password", { exact: true })
      .fill("new-password");
    await app.page
      .getByRole("button", { name: "Update saved login", exact: true })
      .waitFor();
    assert.equal(
      (await app.worker.evaluate(() => chrome.storage.local.get(null)))[
        `journal:${origin}/jepop`
      ].password,
      "saved-password",
    );
    await mkdir("test-results", { recursive: true });
    await app.page.screenshot({ path: "test-results/inline-update.png" });
    await app.page
      .getByRole("button", { name: "Update saved login", exact: true })
      .click();
    await app.page
      .getByText(
        "Saved for JEPOP. Your login will fill automatically next time.",
        { exact: true },
      )
      .waitFor();
    const records = await app.worker.evaluate(() =>
      chrome.storage.local.get(null),
    );
    assert.equal(records[`journal:${origin}/jepop`].password, "new-password");
    assert.equal(
      records[`journal:${origin}/other-journal`].password,
      "other-password",
    );
  },
);

test(
  "real extension: ambiguous forms, unsupported URLs and empty captures",
  { timeout: 45000 },
  async (t) => {
    const app = await start("");
    t.after(() => app.context.close());
    await app.page.goto(`${origin}/jepop`);
    let panel = await app.popup();
    await panel
      .getByRole("button", { name: "Read from page", exact: true })
      .click();
    await statusContains(panel, "Fill both");
    await panel.close();

    await app.page.evaluate(() => {
      const field = document.createElement("input");
      field.type = "password";
      document.querySelector("form").append(field);
    });
    panel = await app.popup();
    await panel
      .getByRole("button", { name: "Read from page", exact: true })
      .click();
    await statusContains(panel, "multiple login forms");
    await panel.close();

    await app.page.goto(`${origin}/login`);
    panel = await app.popup();
    await panel.waitForFunction(() =>
      document.getElementById("scope").textContent.includes("journal-specific"),
    );
    assert.equal(await panel.locator("#login").isVisible(), false);
  },
);
