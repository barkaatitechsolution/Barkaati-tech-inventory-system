// A small gate in front of every edit and delete request.
//
// The API layer calls guardAction() before an update/delete, and the mounted
// PasswordPrompt component supplies the handler that actually asks the user for
// the password. Keeping the UI out of this module means api.js stays free of
// React while still being unable to run a protected request without the gate.
//
// Once the password is accepted the gate stays open briefly. A single product
// save can issue several requests (update, remove images, upload images, save
// customer prices); without this window the user would be asked four times for
// one action.

let promptHandler = null;
let pendingPrompt = null;
let unlockedUntil = 0;

const UNLOCK_MS = 30000;

export function setPasswordPromptHandler(fn) {
  promptHandler = fn;
  return () => {
    if (promptHandler === fn) promptHandler = null;
  };
}

export function isActionUnlocked() {
  return Date.now() < unlockedUntil;
}

export function unlockActions(ms = UNLOCK_MS) {
  unlockedUntil = Date.now() + ms;
}

export function lockActions() {
  unlockedUntil = 0;
}

export async function guardAction(label) {
  if (isActionUnlocked()) return;

  if (pendingPrompt) {
    await pendingPrompt;
    if (isActionUnlocked()) return;
    throw new Error("Action cancelled");
  }

  if (!promptHandler) {
    throw new Error("Password protection is on, but the password prompt is not available.");
  }

  pendingPrompt = (async () => {
    const ok = await promptHandler({ label });
    if (!ok) throw new Error("Action cancelled");
    unlockActions();
  })();

  try {
    await pendingPrompt;
  } finally {
    pendingPrompt = null;
  }
}
