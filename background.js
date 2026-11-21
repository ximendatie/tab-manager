import { openManager } from "./open-manager.js";

let opening;

chrome.action.onClicked.addListener(tab => {
  opening ??= openManager(tab.windowId)
    .catch(error => console.error("Could not open tab manager", error))
    .finally(() => { opening = undefined; });
});
