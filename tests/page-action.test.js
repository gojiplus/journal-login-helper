import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { pageAction } from "../extension/page-action.js";

const scope = { origin: "https://mc.manuscriptcentral.com", path: "/jepop" };
const credentials = {
  username: "author@example.test",
  password: "dummy-password",
};

// These test doubles exercise decisions and events; browser tests cover real DOM layout.
function fixture() {
  class Input extends EventTarget {
    constructor(options) {
      super();
      Object.assign(
        this,
        {
          type: "text",
          name: "",
          id: "",
          autocomplete: "",
          disabled: false,
          readOnly: false,
          isConnected: true,
          form: "login",
          visibility: "visible",
          rendered: true,
          storedValue: "",
        },
        options,
      );
    }
    get value() {
      return this.storedValue;
    }
    set value(value) {
      this.storedValue = value;
    }
    getClientRects() {
      return this.rendered ? [{}] : [];
    }
    closest() {
      return null;
    }
  }
  const username = new Input({ name: "USERID" });
  const password = new Input({ type: "password" });
  const inputs = [username, password];
  const location = { ...scope, pathname: "/jepop" };
  const context = vm.createContext({
    location,
    HTMLInputElement: Input,
    Event,
    document: { querySelectorAll: () => inputs },
    getComputedStyle: (input) => ({ visibility: input.visibility }),
  });
  const action = vm.runInContext(`(${pageAction.toString()})`, context);
  return {
    Input,
    inputs,
    username,
    password,
    location,
    action: (name, creds = credentials) => action(name, scope, creds),
  };
}

test("reading is explicit and filling emits events without submitting", () => {
  const f = fixture();
  f.username.value = credentials.username;
  f.password.value = credentials.password;
  const read = f.action("read");
  assert.equal(read.password, credentials.password);
  assert.equal(read.username, credentials.username);
  f.username.value = "";
  f.password.value = "";
  const events = [];
  for (const input of [f.username, f.password]) {
    for (const type of ["input", "change"])
      input.addEventListener(type, () => events.push(type));
  }
  assert.equal(f.action("fill").ok, true);
  assert.equal(f.username.value, credentials.username);
  assert.equal(f.password.value, credentials.password);
  assert.deepEqual(events, ["input", "change", "input", "change"]);
});

test("journal boundary and origin are rechecked for read, fill and save validation", () => {
  for (const pathname of ["/other", "/jepop2", "/login"]) {
    const f = fixture();
    f.location.pathname = pathname;
    for (const action of ["read", "fill", "check"])
      assert.match(f.action(action).error, /journal changed/);
    assert.equal(f.password.value, "");
  }
  const f = fixture();
  f.location.origin = "https://evil.example";
  assert.match(f.action("fill").error, /journal changed/);
});

test("child login paths work and empty captures are rejected", () => {
  const f = fixture();
  f.location.pathname = "/jepop/login";
  assert.match(f.action("read").error, /Fill both/);
  assert.equal(f.action("fill").ok, true);
});

test("hidden password fields do not make a visible login ambiguous", () => {
  const f = fixture();
  f.inputs.push(new f.Input({ type: "password", rendered: false }));
  f.inputs.push(new f.Input({ type: "password", visibility: "hidden" }));
  assert.equal(f.action("fill").ok, true);
});

test("password-change forms and multiple passwords are rejected", () => {
  const f = fixture();
  f.password.autocomplete = "new-password";
  assert.match(f.action("fill").error, /password-change/);
  f.password.autocomplete = "";
  f.inputs.push(new f.Input({ type: "password" }));
  assert.match(f.action("read").error, /multiple login forms/);
  assert.equal(f.password.value, "");
});

test("username autocomplete resolves unrelated text fields", () => {
  const f = fixture();
  f.username.autocomplete = "section-login username";
  f.inputs.push(new f.Input({ type: "text", name: "search" }));
  assert.equal(f.action("fill").ok, true);
});

test("ambiguous username fields fail without filling", () => {
  const f = fixture();
  f.inputs.push(new f.Input({ name: "email" }));
  assert.match(f.action("fill").error, /one username/);
  assert.equal(f.password.value, "");
});

test("inputs in a separate form are ignored", () => {
  const f = fixture();
  f.inputs.push(new f.Input({ name: "username", form: "search" }));
  assert.equal(f.action("fill").ok, true);
});

test("read-only, disabled and absent password fields fail", () => {
  for (const property of ["disabled", "readOnly"]) {
    const f = fixture();
    f.password[property] = true;
    assert.match(f.action("fill").error, /No login form/);
  }
  const f = fixture();
  f.inputs.pop();
  assert.match(f.action("fill").error, /No login form/);
});

test("navigation during username events prevents password disclosure", () => {
  const f = fixture();
  f.username.addEventListener("input", () => {
    f.location.pathname = "/other";
  });
  assert.match(f.action("fill").error, /page changed/);
  assert.equal(f.password.value, "");
});

test("form replacement during username events stops filling", () => {
  const f = fixture();
  f.username.addEventListener("change", () => {
    f.password.isConnected = false;
  });
  assert.match(f.action("fill").error, /page changed/);
  assert.equal(f.password.value, "");
});

test("a site that overwrites the fill is reported", () => {
  const f = fixture();
  f.password.addEventListener("change", () => {
    f.password.value = "old-chrome-value";
  });
  assert.match(f.action("fill").error, /page changed the login fields/);
});
