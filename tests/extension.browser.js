import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const origin = "https://mc.manuscriptcentral.com";
const html = `<!doctype html><html><head><title>Journal login fixture</title></head>
<body><h1>Journal login</h1><form id="login"><label>Username<input name="USERID" autocomplete="username"></label>
<label>Password<input name="PASSWORD" type="password" autocomplete="current-password"></label>
<button>Sign in</button></form><script>
window.submissions = 0;
document.querySelector('form').addEventListener('submit', event => {event.preventDefault(); window.submissions++;});
</script></body></html>`;

async function start(profile) {
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
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) {
      return route.fulfill({ contentType: "text/html", body: html });
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
    const opened = context.waitForEvent("page", { timeout: 10000 });
    // Exercise the real toolbar action, including its activeTab permission grant.
    await cdp.send("Extensions.triggerAction", {
      id: extensionId,
      targetId: target.targetId,
    });
    const panel = await opened;
    await panel.locator("#login:not([hidden]), #scope").first().waitFor();
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
    await panel.screenshot({ path: "test-results/popup.png" });
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
