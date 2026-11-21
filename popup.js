import { openManager } from "./open-manager.js";

// Keep the installed toolbar action usable until Chrome reloads the manifest.
try {
  await openManager((await chrome.windows.getCurrent()).id);
  window.close();
} catch {
  document.querySelector("a").focus();
}
