// Relative URLs so the app works at a domain root and under Home Assistant ingress.
async function req(path, opts = {}) {
  const res = await fetch("api/" + path, {
    credentials: "same-origin",
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}
const send = (method, body) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  me: () => req("me"),
  updateMe: changes => req("me", send("PATCH", changes)),
  profiles: () => req("profiles"),
  createProfile: p => req("profiles", send("POST", p)),
  programs: () => req("programs"),
  login: (profileId, pin) => req("login", send("POST", { profileId, pin })),
  logout: () => req("logout", send("POST")),
  program: () => req("program"),
  getLog: () => req("log"),
  putEntry: (k, entry) => req("log/" + encodeURIComponent(k), send("PUT", entry)),
  deleteEntry: k => req("log/" + encodeURIComponent(k), send("DELETE")),
  importLog: entries => req("log/import", send("POST", { entries })),
  startBlock: programId => req("blocks", send("POST", { programId })),
  connector: () => req("connector"),
  watchKey: () => req("watch-key"),
  regenerateWatchKey: () => req("watch-key/regenerate", send("POST")),
  regenerateConnector: () => req("connector/regenerate", send("POST")),
};
