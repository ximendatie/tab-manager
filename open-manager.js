const managerUrl = chrome.runtime.getURL("manager.html");

export async function focusTab(id) {
  const tab = await chrome.tabs.update(id, { active: true });
  if (!tab) throw new Error("The tab is no longer available");
  await chrome.windows.update(tab.windowId, { focused: true });
}

export async function openManager(windowId) {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  const existing = tabs.find(tab => tab.url === managerUrl || tab.pendingUrl === managerUrl);

  if (existing) {
    try {
      await focusTab(existing.id);
      return;
    } catch {
      // The tab can disappear between querying and activating it.
    }
  }

  await chrome.tabs.create({ windowId, url: managerUrl });
}
