const SHARED_PATHS = new Set([
  "login",
  "signin",
  "sign-in",
  "logout",
  "auth",
  "oauth",
  "sso",
  "register",
  "password",
  "reset",
  "reset-password",
  "forgot-password",
  "help",
  "index.html",
]);

export function journalScope(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "mc.manuscriptcentral.com" ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const journal = url.pathname.split("/")[1];
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(journal ?? "") ||
    SHARED_PATHS.has(journal.toLowerCase())
  )
    return null;
  const path = `/${journal}`;
  return {
    origin: url.origin,
    path,
    key: `journal:${url.origin}${path}`,
    label: journal.toUpperCase(),
  };
}
