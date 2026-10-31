// executeScript serializes this function; keep its dependencies inside the function.
export function pageAction(action, expected, credentials = null) {
  const matches = () =>
    location.origin === expected.origin &&
    (location.pathname === expected.path ||
      location.pathname.startsWith(`${expected.path}/`));
  if (!matches())
    return { error: "The journal changed. Close and reopen the helper." };
  if (action === "check") return { ok: true };
  if (!["read", "fill", "fields", "change"].includes(action))
    return { error: "Unknown action." };

  const visible = (input) => {
    const style = getComputedStyle(input);
    return (
      !input.disabled &&
      !input.readOnly &&
      !input.closest("[inert]") &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      input.getClientRects().length > 0
    );
  };
  const passwords = [...document.querySelectorAll("input")].filter(
    (input) => input.type === "password" && visible(input),
  );
  if (action === "change") {
    const newFields = passwords.filter((input) =>
      input.autocomplete.split(/\s+/).includes("new-password"),
    );
    const form = newFields[0]?.form;
    if (
      !form ||
      !newFields.length ||
      passwords.some((input) => input.form !== form)
    ) {
      return { error: "No unambiguous password-change form found." };
    }
    const confirmationFields = passwords.filter(
      (input) => !input.autocomplete.split(/\s+/).includes("current-password"),
    );
    const value = newFields[0].value;
    if (!value || confirmationFields.some((input) => input.value !== value)) {
      return { error: "Complete the matching new-password fields first." };
    }
    const usernames = [...document.querySelectorAll("input")].filter(
      (input) =>
        input.form === form &&
        visible(input) &&
        ["text", "email", "tel"].includes(input.type) &&
        (input.autocomplete.split(/\s+/).includes("username") ||
          /user|email|login|e-mail/i.test(`${input.name} ${input.id}`)),
    );
    if (usernames.length > 1) return { error: "Ambiguous username." };
    return {
      password: value,
      username: usernames[0]?.value || null,
      anchor: newFields.at(-1),
      form,
    };
  }
  if (
    passwords.length !== 1 ||
    passwords[0].autocomplete.split(/\s+/).includes("new-password")
  ) {
    return {
      error:
        passwords.length === 0
          ? "No login form found. Open the journal’s login page. Embedded frames are not supported yet."
          : "This looks like a password-change page or has multiple login forms. Use the main login page, or enter the new password in the helper to save it.",
    };
  }
  const password = passwords[0];
  const candidates = [...document.querySelectorAll("input")].filter(
    (input) =>
      ["text", "email", "tel"].includes(input.type) &&
      input.form === password.form &&
      visible(input),
  );
  const explicit = candidates.filter((input) =>
    input.autocomplete.split(/\s+/).includes("username"),
  );
  const named = candidates.filter((input) =>
    /user|email|login|e-mail/i.test(`${input.name} ${input.id}`),
  );
  const users = explicit.length ? explicit : named.length ? named : candidates;
  if (users.length !== 1) {
    return {
      error:
        "Could not identify one username field. This login form is not supported yet.",
    };
  }
  const username = users[0];
  if (action === "fields") return { username, password, form: password.form };
  if (action === "read") {
    if (!username.value.trim() || !password.value) {
      return {
        error:
          "Fill both login fields first, or type the credentials in the helper.",
      };
    }
    return { username: username.value, password: password.value };
  }
  if (!credentials || !credentials.username.trim() || !credentials.password) {
    return { error: "Save a username and password before filling." };
  }

  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  ).set;
  setValue.call(username, credentials.username);
  username.dispatchEvent(new Event("input", { bubbles: true }));
  username.dispatchEvent(new Event("change", { bubbles: true }));
  // A page can navigate or replace its form in response to the username events.
  if (
    !matches() ||
    !username.isConnected ||
    !password.isConnected ||
    !visible(password)
  ) {
    return {
      error: "The page changed while filling. Reopen the helper and try again.",
    };
  }
  setValue.call(password, credentials.password);
  password.dispatchEvent(new Event("input", { bubbles: true }));
  password.dispatchEvent(new Event("change", { bubbles: true }));
  if (
    !matches() ||
    !password.isConnected ||
    username.value !== credentials.username ||
    password.value !== credentials.password
  ) {
    return {
      error: "The page changed the login fields. Check them before signing in.",
    };
  }
  return { ok: true };
}
