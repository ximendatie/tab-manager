import { focusTab } from "./open-manager.js";

const board = document.querySelector("#tab-board");
const header = document.querySelector(".page-header");
const template = document.querySelector("#tab-template");
const domainTemplate = document.querySelector("#domain-template");
const selectionBox = document.querySelector("#selection-box");
const tabCount = document.querySelector("#tab-count");
const protectedCount = document.querySelector("#protected-count");
const boardTitle = document.querySelector("#board-title");
const groupViewActions = document.querySelector("#group-view-actions");
const expandAllGroups = document.querySelector("#expand-all-groups");
const collapseAllGroups = document.querySelector("#collapse-all-groups");
const emptyMessage = document.querySelector("#empty-message");
const selectAll = document.querySelector("#select-all");
const clearSelection = document.querySelector("#clear-selection");
const closeSelected = document.querySelector("#close-selected");
const undoClose = document.querySelector("#undo-close");
const status = document.querySelector("#status");
const managerUrl = chrome.runtime.getURL("manager.html");

const cards = new Map();
const groups = new Map();
let domainSettings = new Map();
let closableIds = new Set();
let selected = new Set();
let manager;
let tabAction;
let closedBatch = [];
let syncingGroups = false;
let reloadingGroup;
let refreshing = false;
let refreshNeeded = false;
let refreshTimer;
let gesture;
let frameId;
let suppressClick = false;

function setStatus(message, warning = false) {
  status.textContent = message;
  status.toggleAttribute("data-warning", warning);
}

function isManager(url) {
  return url?.split(/[?#]/, 1)[0] === managerUrl;
}

async function getTabs() {
  const tabs = await chrome.tabs.query({ windowType: "normal" });
  return tabs
    .filter(tab => Number.isInteger(tab.id) && !tab.incognito && tab.id !== manager.id
      && !isManager(tab.url) && !isManager(tab.pendingUrl))
    .sort((first, second) => {
      if (first.windowId === second.windowId) return first.index - second.index;
      if (first.windowId === manager.windowId) return -1;
      if (second.windowId === manager.windowId) return 1;
      return first.windowId - second.windowId;
    });
}

function hasNativeGroup(tab) {
  return Number.isInteger(tab.groupId) && tab.groupId >= 0;
}

async function getNativeGroupDetails(tabs) {
  if (!chrome.tabGroups || !tabs.some(hasNativeGroup)) return new Map();
  try {
    const nativeGroups = await chrome.tabGroups.query({});
    return new Map(nativeGroups.map(group => [group.id, group]));
  } catch {
    // Group membership is still available when Chrome cannot load group details.
    return new Map();
  }
}

function normalizeHostname(hostname) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return normalized.replace(/^www\./, "") || normalized;
}

async function loadDomainSettings() {
  const settings = new Map();
  try {
    const directory = await chrome.runtime.getPackageDirectoryEntry();
    const entry = await new Promise((resolve, reject) => {
      directory.getFile("domain-labels.local.json", {}, resolve, reject);
    });
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const config = JSON.parse(await file.text());
    if (!config || typeof config !== "object" || Array.isArray(config)) return settings;

    for (const [hostname, value] of Object.entries(config)) {
      const key = normalizeHostname(hostname);
      if (!key) continue;
      if (typeof value === "string" && value.trim()) {
        settings.set(key, { label: value.trim() });
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        const label = typeof value.label === "string" ? value.label.trim() : "";
        const groupWith = typeof value.groupWith === "string" ? normalizeHostname(value.groupWith) : "";
        const titleSuffix = typeof value.titleSuffix === "string" ? value.titleSuffix.trim() : "";
        settings.set(key, { label: label || undefined, groupWith: groupWith || undefined, titleSuffix });
      }
    }
  } catch {
    // The optional file may be missing or invalid.
  }
  return settings;
}

function getDomain(url) {
  let page;
  try {
    page = new URL(url);
  } catch {
    return { key: "其他页面", isWebsite: false };
  }
  if (page.protocol === "http:" || page.protocol === "https:") {
    return { key: normalizeHostname(page.hostname) || page.hostname, isWebsite: true };
  }
  const names = { "chrome:": "Chrome 页面", "chrome-extension:": "扩展程序页面", "file:": "本地文件" };
  return { key: names[page.protocol] ?? "其他页面", isWebsite: false };
}

function createCard(tab, windowLabel, titleSuffix) {
  const card = template.content.firstElementChild.cloneNode(true);
  const checkbox = card.querySelector(".tab-check");
  const label = card.querySelector(".tab-selection");
  const jump = card.querySelector(".tab-jump");
  const originalTitle = tab.title?.trim() || "未命名标签页";
  const title = titleSuffix && originalTitle.endsWith(titleSuffix)
    ? originalTitle.slice(0, -titleSuffix.length).trimEnd() || originalTitle
    : originalTitle;
  const context = [tab.pinned ? "已固定 · 受保护" : "", windowLabel].filter(Boolean).join(" · ");
  checkbox.id = `tab-check-${tab.id}`;
  label.htmlFor = checkbox.id;
  checkbox.value = tab.id;
  checkbox.checked = closableIds.has(tab.id) && selected.has(tab.id);
  checkbox.disabled = tabAction || !closableIds.has(tab.id);
  jump.value = tab.id;
  jump.disabled = Boolean(tabAction);
  jump.setAttribute("aria-label", `切换到标签页：${title}`);
  card.title = title;
  card.querySelector(".tab-title").textContent = title;
  if (tab.url && tab.favIconUrl) {
    const icon = jump.querySelector(".tab-favicon");
    icon.addEventListener("load", () => { icon.hidden = false; }, { once: true });
    if (tab.favIconUrl.startsWith("data:image/")) {
      icon.src = tab.favIconUrl;
    } else {
      const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
      favicon.searchParams.set("pageUrl", tab.url);
      favicon.searchParams.set("size", "32");
      favicon.searchParams.set("v", tab.favIconUrl);
      icon.src = favicon.href;
    }
  }
  const contextLabel = card.querySelector(".tab-context");
  contextLabel.textContent = context;
  contextLabel.hidden = !context;

  cards.set(tab.id, { card, checkbox, jump });
  return card;
}

function groupTabs(tabs, nativeGroupDetails) {
  const nativeGroups = new Map();
  const domains = new Map();
  for (const tab of tabs) {
    if (hasNativeGroup(tab)) {
      const key = `chrome-group:${tab.groupId}`;
      if (!nativeGroups.has(key)) {
        const nativeGroup = nativeGroupDetails.get(tab.groupId);
        const name = nativeGroup
          ? nativeGroup.title?.trim() || "未命名标签页分组"
          : "Chrome 标签页分组";
        nativeGroups.set(key, {
          key, name, detail: name, color: nativeGroup?.color,
          nativeGroup,
          entries: [],
        });
      }
      nativeGroups.get(key).entries.push(tab);
      continue;
    }

    const { key: hostname, isWebsite } = getDomain(tab.url || tab.pendingUrl);
    const key = isWebsite ? domainSettings.get(hostname)?.groupWith ?? hostname : hostname;
    if (!domains.has(key)) {
      const name = isWebsite ? domainSettings.get(key)?.label ?? key : key;
      domains.set(key, { key, name, detail: key, isWebsite, entries: [] });
    }
    domains.get(key).entries.push(tab);
  }
  const domainGroups = [...domains.values()].sort((groupA, groupB) =>
    Number(groupB.isWebsite) - Number(groupA.isWebsite)
    || groupB.entries.length - groupA.entries.length
    || groupA.key.localeCompare(groupB.key));
  return [...nativeGroups.values(), ...domainGroups];
}

function setGroupCollapsed(grid, disclosure, collapsed) {
  grid.hidden = collapsed;
  disclosure.setAttribute("aria-expanded", String(!collapsed));
}

async function setGroupsCollapsed(targets, collapsed, batch = false) {
  if (tabAction || syncingGroups || reloadingGroup || targets.length === 0) return;
  syncingGroups = true;
  updateActions();
  setStatus("");
  try {
    const results = await Promise.allSettled(targets.map(async ({ nativeGroupId, grid, disclosure }) => {
      const updated = await chrome.tabGroups.update(nativeGroupId, { collapsed });
      if (updated) setGroupCollapsed(grid, disclosure, updated.collapsed);
      return updated?.collapsed === collapsed;
    }));
    const synced = results.filter(result => result.status === "fulfilled" && result.value).length;
    const failed = targets.length - synced;
    if (batch) {
      const action = collapsed ? "折叠" : "展开";
      const suffix = failed ? `，${failed} 个分组未能同步` : "";
      setStatus(`已${action} ${synced} 个分组${suffix}。`, failed > 0);
    } else if (failed) {
      setStatus("暂时无法同步 Chrome 分组状态，请重试。", true);
    }
  } finally {
    syncingGroups = false;
    updateActions();
    queueRefresh();
  }
}

async function reloadGroup(key, name) {
  if (tabAction || syncingGroups || reloadingGroup) return;
  reloadingGroup = key;
  updateActions();
  setStatus(`正在刷新「${name}」…`);
  try {
    const group = groupTabs(await getTabs(), new Map()).find(group => group.key === key);
    if (!group) {
      setStatus(`「${name}」中已经没有可刷新的标签页。`);
      return;
    }
    const results = await Promise.allSettled(group.entries.map(async ({ id }) => chrome.tabs.reload(id)));
    const reloaded = results.filter(result => result.status === "fulfilled").length;
    const failed = results.length - reloaded;
    const suffix = failed ? `，${failed} 个未能刷新` : "";
    setStatus(`「${name}」已发起 ${reloaded} 个标签页的刷新${suffix}。`, failed > 0);
  } catch {
    setStatus(`暂时无法读取「${name}」中的标签页，请重试。`, true);
  } finally {
    reloadingGroup = undefined;
    updateActions();
    queueRefresh();
  }
}

function getGroupFaviconUrl(entries, hostname) {
  const matching = entries.filter(tab => getDomain(tab.url || tab.pendingUrl).key === hostname);
  const siteTabs = matching.length ? matching : entries;
  const candidates = new Map();
  for (const tab of siteTabs) {
    // Inline document icons belong to individual tabs.
    if (!tab.url || !/^https?:\/\//i.test(tab.favIconUrl ?? "")) continue;
    const candidate = candidates.get(tab.favIconUrl);
    if (candidate) candidate.count += 1;
    else candidates.set(tab.favIconUrl, { tab, count: 1 });
  }

  const [first, second] = [...candidates.values()].sort((a, b) => b.count - a.count);
  const representative = first && first.count > (second?.count ?? 0) ? first.tab : undefined;
  const site = new URL("/", siteTabs[0].url || siteTabs[0].pendingUrl);
  const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
  favicon.searchParams.set("pageUrl", representative?.url ?? site.href);
  favicon.searchParams.set("size", "32");
  if (representative) favicon.searchParams.set("v", representative.favIconUrl);
  return favicon.href;
}

function createGroup({ key, name, detail, color, isWebsite, nativeGroup, entries }, windowLabels) {
  const group = domainTemplate.content.firstElementChild.cloneNode(true);
  group.style.setProperty("--group-size", entries.length);
  group.toggleAttribute("data-full-width", entries.length > 3);
  if (color) {
    const marker = group.querySelector(".domain-color");
    marker.dataset.color = color;
    marker.hidden = false;
  }
  if (isWebsite) {
    const icon = group.querySelector(".domain-favicon");
    icon.addEventListener("load", () => { icon.hidden = false; }, { once: true });
    icon.src = getGroupFaviconUrl(entries, key);
  }
  const heading = group.querySelector(".domain-name");
  const checkbox = group.querySelector(".group-check");
  checkbox.id = `group-check-${encodeURIComponent(key)}`;
  group.querySelector(".domain-select").htmlFor = checkbox.id;
  heading.textContent = name;
  heading.title = detail;
  group.setAttribute("aria-label", name);
  group.querySelector(".domain-count").textContent = `${entries.length} 个`;
  checkbox.value = key;
  checkbox.setAttribute("aria-label", `整组选中 ${name}`);
  const reload = group.querySelector(".group-reload");
  reload.value = key;
  reload.setAttribute("aria-label", `整组刷新 ${name}`);
  reload.addEventListener("click", () => reloadGroup(key, name));

  const grid = group.querySelector(".domain-cards");
  let disclosure;
  if (nativeGroup) {
    grid.id = `group-cards-${encodeURIComponent(key)}`;
    disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "domain-disclosure";
    disclosure.value = key;
    disclosure.textContent = name;
    disclosure.setAttribute("aria-controls", grid.id);
    heading.replaceChildren(disclosure);
    setGroupCollapsed(grid, disclosure, nativeGroup.collapsed);
    disclosure.addEventListener("click", () => setGroupsCollapsed([groups.get(key)], !grid.hidden));
  }

  groups.set(key, { checkbox, disclosure, grid, reload, nativeGroupId: nativeGroup?.id, ids: entries.map(tab => tab.id) });
  const titleSuffix = isWebsite ? domainSettings.get(key)?.titleSuffix : undefined;
  for (const tab of entries) {
    grid.append(createCard(tab, windowLabels.get(tab.windowId), titleSuffix));
  }
  return group;
}

function renderTabs(tabs, nativeGroupDetails) {
  const focused = board.contains(document.activeElement) ? document.activeElement : null;
  closableIds = new Set(tabs.filter(tab => tab.pinned === false).map(tab => tab.id));
  const windowIds = [...new Set(tabs.map(tab => tab.windowId))];
  const otherWindowIds = windowIds.filter(id => id !== manager.windowId);
  const windowLabels = new Map(otherWindowIds.map((id, index) => [id, `窗口 ${index + 1}`]));

  cards.clear();
  groups.clear();
  const content = document.createDocumentFragment();
  for (const [index, group] of groupTabs(tabs, nativeGroupDetails).entries()) {
    const section = createGroup(group, windowLabels);
    // Rotate the hue far enough to separate neighboring groups.
    section.style.setProperty("--group-hue", (225 + index * 137.508) % 360);
    content.append(section);
  }
  board.replaceChildren(content);
  board.hidden = tabs.length === 0;
  tabCount.textContent = `${tabs.length} 个标签页 · ${groups.size} 组`;
  emptyMessage.hidden = tabs.length > 0;
  emptyMessage.textContent = "目前没有可以关闭的标签页。";

  setSelection(selected);
  if (focused) {
    const replacement = focused.matches(".group-check, .domain-disclosure, .group-reload")
      ? groups.get(focused.value)
      : cards.get(Number(focused.value));
    const control = focused.matches(".domain-disclosure") ? replacement?.disclosure
      : focused.matches(".group-reload") ? replacement?.reload
      : focused.matches(".tab-jump") ? replacement?.jump : replacement?.checkbox;
    const hiddenGrid = control?.closest(".domain-cards[hidden]");
    const next = hiddenGrid ? hiddenGrid.parentElement.querySelector(".domain-disclosure") : control;
    next?.focus({ preventScroll: true });
  }
}

function setSelection(next) {
  selected = new Set([...next].filter(id => closableIds.has(id)));
  for (const [id, { card, checkbox }] of cards) {
    const checked = selected.has(id);
    const isProtected = !closableIds.has(id);
    if (checkbox.checked !== checked) checkbox.checked = checked;
    checkbox.disabled = tabAction || isProtected;
    card.toggleAttribute("data-protected", isProtected);
  }
  updateActions();
}

function updateActions() {
  const protectedTabs = cards.size - closableIds.size;
  protectedCount.hidden = protectedTabs === 0;
  protectedCount.textContent = `${protectedTabs} 个受保护`;
  const groupActionsDisabled = Boolean(tabAction) || syncingGroups || reloadingGroup !== undefined;
  let hasExpanded = false;
  let hasCollapsed = false;
  for (const [key, { checkbox, ids, disclosure, grid, reload }] of groups) {
    reload.setAttribute("aria-disabled", String(groupActionsDisabled));
    const isReloading = key === reloadingGroup;
    reload.setAttribute("aria-busy", String(isReloading));
    const reloadLabel = isReloading ? "刷新中" : "刷新";
    if (reload.textContent !== reloadLabel) reload.textContent = reloadLabel;
    const eligible = ids.filter(id => closableIds.has(id));
    const count = eligible.reduce((total, id) => total + Number(selected.has(id)), 0);
    checkbox.checked = count > 0 && count === eligible.length;
    checkbox.indeterminate = count > 0 && count < eligible.length;
    checkbox.disabled = tabAction || eligible.length === 0;
    if (disclosure) {
      disclosure.setAttribute("aria-disabled", String(groupActionsDisabled));
      hasExpanded ||= !grid.hidden;
      hasCollapsed ||= grid.hidden;
    }
  }
  groupViewActions.hidden = !hasExpanded && !hasCollapsed;
  expandAllGroups.setAttribute("aria-disabled", String(groupActionsDisabled || !hasCollapsed));
  collapseAllGroups.setAttribute("aria-disabled", String(groupActionsDisabled || !hasExpanded));
  selectAll.disabled = tabAction || closableIds.size === selected.size;
  clearSelection.disabled = tabAction || selected.size === 0;
  closeSelected.disabled = groupActionsDisabled || selected.size === 0;
  undoClose.disabled = groupActionsDisabled || closedBatch.length === 0;
  undoClose.textContent = tabAction === "restoring" ? "正在恢复…" : "撤销关闭";
  const label = selected.size ? `关闭所选 ${selected.size} 个标签页` : "关闭所选";
  closeSelected.textContent = tabAction === "closing" ? "正在关闭…" : label;
}

function queueRefresh() {
  refreshNeeded = true;
  clearTimeout(refreshTimer);
  if (!tabAction && !syncingGroups && !gesture && !refreshing) refreshTimer = setTimeout(refreshTabs, 100);
}

async function refreshTabs() {
  if (tabAction || syncingGroups || gesture || refreshing) return;
  refreshNeeded = false;
  refreshing = true;
  try {
    const tabs = await getTabs();
    const nativeGroupDetails = await getNativeGroupDetails(tabs);
    if (tabAction || syncingGroups || gesture) {
      refreshNeeded = true;
      return;
    }
    renderTabs(tabs, nativeGroupDetails);
  } catch {
    if (board.hidden) emptyMessage.textContent = "暂时无法读取标签页，请刷新此页重试。";
  } finally {
    refreshing = false;
    if (refreshNeeded) queueRefresh();
  }
}

function paintSelection(autoScroll) {
  if (!gesture?.active) return;
  const { startX, startY, clientX, clientY, initialSelection } = gesture;
  const scrollBefore = scrollY;
  if (autoScroll) {
    const topEdge = header.offsetHeight + 26;
    const bottomEdge = innerHeight - 44;
    if (clientY < topEdge) scrollBy(0, -Math.min(24, (topEdge - clientY) / 3));
    else if (clientY > bottomEdge) scrollBy(0, Math.min(24, (clientY - bottomEdge) / 3));
  }

  const left = Math.min(startX - scrollX, clientX);
  const top = Math.min(startY - scrollY, clientY);
  const right = Math.max(startX - scrollX, clientX);
  const bottom = Math.max(startY - scrollY, clientY);
  const next = new Set(initialSelection);

  for (const [id, { card }] of cards) {
    if (!closableIds.has(id)) continue;
    const bounds = card.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    if (bounds.left < right && bounds.right > left && bounds.top < bottom && bounds.bottom > top) {
      next.add(id);
    }
  }
  setSelection(next);

  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${Math.max(1, right - left)}px`;
  selectionBox.style.height = `${Math.max(1, bottom - top)}px`;
  selectionBox.hidden = false;
  if (scrollY !== scrollBefore) queuePaint();
}

function queuePaint() {
  if (!gesture?.active || frameId) return;
  frameId = requestAnimationFrame(() => {
    frameId = undefined;
    paintSelection(true);
  });
}

function endGesture(cancelled) {
  if (!gesture) return;
  if (gesture.active && cancelled) setSelection(gesture.initialSelection);
  gesture = undefined;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = undefined;
  selectionBox.hidden = true;
  document.body.classList.remove("dragging");
  if (refreshNeeded) queueRefresh();
}

window.addEventListener("pointerdown", event => {
  suppressClick = false;
  if (tabAction || board.hidden || event.button !== 0 || event.pointerType !== "mouse"
    || !(event.target instanceof Element)
    || event.target.closest(".page-header, .domain-select, .domain-disclosure, .group-reload, .tab-jump")
    || event.clientY < board.getBoundingClientRect().top) return;
  gesture = {
    pointerId: event.pointerId,
    startX: event.pageX,
    startY: event.pageY,
    clientX: event.clientX,
    clientY: event.clientY,
    initialSelection: new Set(selected),
    active: false,
  };
}, true);

window.addEventListener("pointermove", event => {
  if (gesture?.pointerId !== event.pointerId) return;
  if (!gesture.active) {
    if (Math.hypot(event.pageX - gesture.startX, event.pageY - gesture.startY) < 5) return;
    gesture.active = true;
    board.setPointerCapture(event.pointerId);
    document.body.classList.add("dragging");
  }
  gesture.clientX = event.clientX;
  gesture.clientY = event.clientY;
  queuePaint();
});

window.addEventListener("pointerup", event => {
  if (gesture?.pointerId !== event.pointerId) return;
  if (gesture.active) {
    gesture.clientX = event.clientX;
    gesture.clientY = event.clientY;
    paintSelection(false);
    suppressClick = true;
    setStatus("");
  }
  endGesture(false);
});

window.addEventListener("pointercancel", () => endGesture(true));
window.addEventListener("blur", () => endGesture(true));
window.addEventListener("scroll", queuePaint, { passive: true });
board.addEventListener("lostpointercapture", () => endGesture(true));
board.addEventListener("dragstart", event => event.preventDefault());
board.addEventListener("click", event => {
  if (!suppressClick || event.detail === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  suppressClick = false;
}, true);

board.addEventListener("click", async event => {
  const jump = event.target.closest(".tab-jump");
  if (!jump || tabAction) return;
  try {
    await focusTab(Number(jump.value));
  } catch {
    setStatus("无法切换到该标签页。", true);
    queueRefresh();
  }
});

board.addEventListener("change", event => {
  const checkbox = event.target;
  if (checkbox.disabled) return;
  const ids = checkbox.matches(".group-check") ? groups.get(checkbox.value).ids : [Number(checkbox.value)];
  for (const id of ids) {
    if (checkbox.checked) selected.add(id);
    else selected.delete(id);
  }
  setStatus("");
  setSelection(selected);
});

selectAll.addEventListener("click", () => {
  setStatus("");
  setSelection(closableIds);
});

clearSelection.addEventListener("click", () => {
  setStatus("");
  setSelection(new Set());
});

for (const [button, collapsed] of [[expandAllGroups, false], [collapseAllGroups, true]]) {
  button.addEventListener("click", () => {
    if (button.getAttribute("aria-disabled") === "true") return;
    const nativeGroups = [...groups.values()].filter(({ disclosure }) => disclosure);
    setGroupsCollapsed(nativeGroups, collapsed, true);
  });
}

const usesMacShortcuts = /^mac/i.test(navigator.userAgentData?.platform || navigator.platform);
if (usesMacShortcuts) {
  closeSelected.setAttribute("aria-keyshortcuts", "Delete Backspace");
  undoClose.setAttribute("aria-keyshortcuts", "Meta+Z");
  document.querySelector("#undo-shortcut").textContent = "⌘Z";
}

window.addEventListener("keydown", event => {
  if (tabAction || event.defaultPrevented || event.isComposing || event.repeat
    || event.altKey || event.shiftKey) return;

  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable
    || target.matches("textarea, select, input:not([type=checkbox]):not([type=radio])"))) return;

  const undoModifier = usesMacShortcuts ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (undoModifier && event.key.toLowerCase() === "z" && !gesture && !undoClose.disabled) {
    event.preventDefault();
    undoClose.click();
    return;
  }
  if (event.ctrlKey || event.metaKey) return;

  if (event.key === "Escape" && (gesture || !clearSelection.disabled)) {
    event.preventDefault();
    if (gesture) {
      suppressClick = true;
      endGesture(false);
    }
    clearSelection.click();
  }

  const isDelete = event.key === "Delete" || (usesMacShortcuts && event.key === "Backspace");
  if (isDelete && !gesture && !closeSelected.disabled) {
    event.preventDefault();
    closeSelected.click();
  }
});

async function requestClosures(ids) {
  const protectedIds = new Set();
  const removals = [];
  await Promise.allSettled(ids.map(async id => {
    const tab = await chrome.tabs.get(id);
    if (tab.pinned !== false || !closableIds.has(id)) {
      protectedIds.add(id);
      return;
    }
    removals.push({ tab, pending: chrome.tabs.remove(id).catch(() => {}) });
  }));

  let timeout;
  try {
    await Promise.race([
      Promise.all(removals.map(({ pending }) => pending)),
      new Promise(resolve => { timeout = setTimeout(resolve, 1500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  return { attemptedTabs: removals.map(({ tab }) => tab), protectedIds };
}

closeSelected.addEventListener("click", async event => {
  if (tabAction || syncingGroups || reloadingGroup || selected.size === 0) return;
  const restoreKeyboardFocus = event.detail === 0;
  tabAction = "closing";
  setStatus("");
  setSelection(selected);
  for (const { jump } of cards.values()) jump.disabled = true;

  const ids = [...selected];
  try {
    const { attemptedTabs, protectedIds } = await requestClosures(ids);
    const tabs = await getTabs();
    const openIds = new Set(tabs.map(tab => tab.id));
    const closed = attemptedTabs.filter(({ id }) => !openIds.has(id));
    if (closed.length) {
      closedBatch = closed
        .filter(tab => tab.url || tab.pendingUrl)
        .sort((a, b) => a.windowId - b.windowId || a.index - b.index);
    }
    const remaining = ids.filter(id => openIds.has(id) && !protectedIds.has(id)).length;
    renderTabs(tabs, await getNativeGroupDetails(tabs));
    const summary = [`已关闭 ${closed.length} 个标签页`];
    if (protectedIds.size > 0) summary.push(`已保护 ${protectedIds.size} 个标签页`);
    if (remaining > 0) summary.push(`${remaining} 个仍打开`);
    setStatus(`${summary.join("，")}。`, remaining > 0);
  } catch {
    setStatus("暂时无法确认关闭结果，请刷新此页查看。", true);
  } finally {
    tabAction = undefined;
    for (const { jump } of cards.values()) jump.disabled = false;
    setSelection(selected);
    if (restoreKeyboardFocus && document.activeElement === document.body) {
      const nextAction = closeSelected.disabled ? (undoClose.disabled ? boardTitle : undoClose) : closeSelected;
      nextAction.focus({ preventScroll: true });
    }
    if (refreshNeeded) queueRefresh();
  }
});

undoClose.addEventListener("click", async event => {
  if (undoClose.disabled || gesture) return;
  const restoreKeyboardFocus = event.detail === 0;
  tabAction = "restoring";
  setStatus("");
  setSelection(selected);
  for (const { jump } of cards.values()) jump.disabled = true;

  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    const windowIds = new Set(windows.map(({ id }) => id));
    const failed = [];
    for (const tab of closedBatch) {
      const originalWindowExists = windowIds.has(tab.windowId);
      let reopened;
      try {
        reopened = await chrome.tabs.create({
          url: tab.url || tab.pendingUrl,
          windowId: originalWindowExists ? tab.windowId : manager.windowId,
          ...(originalWindowExists && { index: tab.index }),
          active: false,
        });
      } catch {
        failed.push(tab);
        continue;
      }

      if (originalWindowExists && hasNativeGroup(tab)) {
        // Keep any surviving browser group. An empty group may have been removed by the browser.
        await chrome.tabs.group({ groupId: tab.groupId, tabIds: reopened.id }).catch(() => {});
      }
    }
    const restored = closedBatch.length - failed.length;
    closedBatch = failed;
    const suffix = failed.length ? `，${failed.length} 个未能恢复，可重试` : "";
    setStatus(`已恢复 ${restored} 个标签页${suffix}。`, failed.length > 0);
  } catch {
    setStatus("暂时无法恢复标签页，请重试。", true);
  } finally {
    tabAction = undefined;
    for (const { jump } of cards.values()) jump.disabled = false;
    setSelection(selected);
    if (restoreKeyboardFocus && document.activeElement === document.body) {
      (undoClose.disabled ? boardTitle : undoClose).focus({ preventScroll: true });
    }
    queueRefresh();
  }
});

async function initialize() {
  try {
    [manager, domainSettings] = await Promise.all([chrome.tabs.getCurrent(), loadDomainSettings()]);
    if (!manager) throw new Error("Missing tab for manager");
    for (const event of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onMoved,
      chrome.tabs.onAttached, chrome.tabs.onReplaced, chrome.tabGroups?.onCreated,
      chrome.tabGroups?.onUpdated, chrome.tabGroups?.onRemoved]) {
      event?.addListener(queueRefresh);
    }
    chrome.tabs.onUpdated.addListener((id, change) => {
      if (change.pinned === true && closableIds.delete(id)) setSelection(selected);
      if (id !== manager.id && ("title" in change || "url" in change || "pinned" in change
        || "groupId" in change || "favIconUrl" in change)) {
        queueRefresh();
      }
    });
    window.addEventListener("focus", queueRefresh);
    await refreshTabs();
  } catch {
    emptyMessage.textContent = "暂时无法读取标签页，请刷新此页重试。";
  }
}

initialize();
