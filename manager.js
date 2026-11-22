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
const status = document.querySelector("#status");
const managerUrl = chrome.runtime.getURL("manager.html");

const cards = new Map();
const groups = new Map();
let domainLabels = new Map();
let closableIds = new Set();
let selected = new Set();
let manager;
let closing = false;
let syncingGroups = false;
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

async function loadDomainLabels() {
  const labels = new Map();
  try {
    const directory = await chrome.runtime.getPackageDirectoryEntry();
    const entry = await new Promise((resolve, reject) => {
      directory.getFile("domain-labels.local.json", {}, resolve, reject);
    });
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const config = JSON.parse(await file.text());
    if (!config || typeof config !== "object" || Array.isArray(config)) return labels;

    for (const [hostname, label] of Object.entries(config)) {
      const key = normalizeHostname(hostname);
      if (key && typeof label === "string" && label.trim()) labels.set(key, label.trim());
    }
  } catch {
    // The optional file may be missing or invalid.
  }
  return labels;
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

function createCard(tab, windowLabel) {
  const card = template.content.firstElementChild.cloneNode(true);
  const checkbox = card.querySelector(".tab-check");
  const label = card.querySelector(".tab-selection");
  const jump = card.querySelector(".tab-jump");
  const title = tab.title?.trim() || "未命名标签页";
  const context = [tab.pinned ? "已固定 · 受保护" : "", windowLabel].filter(Boolean).join(" · ");
  checkbox.id = `tab-check-${tab.id}`;
  label.htmlFor = checkbox.id;
  checkbox.value = tab.id;
  checkbox.checked = closableIds.has(tab.id) && selected.has(tab.id);
  checkbox.disabled = closing || !closableIds.has(tab.id);
  jump.value = tab.id;
  jump.disabled = closing;
  jump.setAttribute("aria-label", `切换到标签页：${title}`);
  card.title = title;
  card.querySelector(".tab-title").textContent = title;
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

    const { key, isWebsite } = getDomain(tab.url || tab.pendingUrl);
    if (!domains.has(key)) {
      const name = isWebsite ? domainLabels.get(key) ?? key : key;
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
  if (closing || syncingGroups || targets.length === 0) return;
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

function createGroup({ key, name, detail, color, isWebsite, nativeGroup, entries }, windowLabels) {
  const group = domainTemplate.content.firstElementChild.cloneNode(true);
  if (color) {
    const marker = group.querySelector(".domain-color");
    marker.dataset.color = color;
    marker.hidden = false;
  }
  if (isWebsite) {
    const representative = entries.find(tab => tab.url && tab.favIconUrl) ?? entries[0];
    const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
    favicon.searchParams.set("pageUrl", representative.url || representative.pendingUrl);
    favicon.searchParams.set("size", "32");
    // Give a new favicon on the same page a different image cache key.
    if (representative.favIconUrl) favicon.searchParams.set("v", representative.favIconUrl);
    const icon = group.querySelector(".domain-favicon");
    icon.addEventListener("load", () => { icon.hidden = false; }, { once: true });
    icon.src = favicon.href;
  }
  const heading = group.querySelector(".domain-name");
  const checkbox = group.querySelector(".group-check");
  checkbox.id = `group-check-${encodeURIComponent(key)}`;
  group.querySelector(".domain-select").htmlFor = checkbox.id;
  heading.textContent = name;
  heading.title = detail;
  group.setAttribute("aria-label", name);
  group.style.setProperty("--group-size", entries.length);
  group.querySelector(".domain-count").textContent = `${entries.length} 个`;
  checkbox.value = key;
  checkbox.setAttribute("aria-label", `整组选中 ${name}`);

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

  groups.set(key, { checkbox, disclosure, grid, nativeGroupId: nativeGroup?.id, ids: entries.map(tab => tab.id) });
  for (const tab of entries) {
    grid.append(createCard(tab, windowLabels?.get(tab.windowId) || ""));
  }
  return group;
}

function renderTabs(tabs, nativeGroupDetails) {
  const focused = board.contains(document.activeElement) ? document.activeElement : null;
  closableIds = new Set(tabs.filter(tab => tab.pinned === false).map(tab => tab.id));
  const windowIds = [...new Set(tabs.map(tab => tab.windowId))];
  const otherWindowIds = windowIds.filter(id => id !== manager.windowId);
  const windowLabels = new Map(otherWindowIds.map((id, index) => [id, `窗口 ${index + 1}`]));
  windowLabels.set(manager.windowId, "当前窗口");

  cards.clear();
  groups.clear();
  const content = document.createDocumentFragment();
  for (const group of groupTabs(tabs, nativeGroupDetails)) {
    content.append(createGroup(group, windowIds.length > 1 ? windowLabels : undefined));
  }
  board.replaceChildren(content);
  board.hidden = tabs.length === 0;
  tabCount.textContent = `${tabs.length} 个标签页 · ${groups.size} 组`;
  emptyMessage.hidden = tabs.length > 0;
  emptyMessage.textContent = "目前没有可以关闭的标签页。";

  setSelection(selected);
  if (focused) {
    const replacement = focused.matches(".group-check, .domain-disclosure")
      ? groups.get(focused.value)
      : cards.get(Number(focused.value));
    const control = focused.matches(".domain-disclosure") ? replacement?.disclosure
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
    checkbox.disabled = closing || isProtected;
    card.toggleAttribute("data-protected", isProtected);
  }
  updateActions();
}

function updateActions() {
  const protectedTabs = cards.size - closableIds.size;
  protectedCount.hidden = protectedTabs === 0;
  protectedCount.textContent = `${protectedTabs} 个受保护`;
  const groupActionsDisabled = closing || syncingGroups;
  let hasExpanded = false;
  let hasCollapsed = false;
  for (const { checkbox, ids, disclosure, grid } of groups.values()) {
    const eligible = ids.filter(id => closableIds.has(id));
    const count = eligible.reduce((total, id) => total + Number(selected.has(id)), 0);
    checkbox.checked = count > 0 && count === eligible.length;
    checkbox.indeterminate = count > 0 && count < eligible.length;
    checkbox.disabled = closing || eligible.length === 0;
    if (disclosure) {
      disclosure.setAttribute("aria-disabled", String(groupActionsDisabled));
      hasExpanded ||= !grid.hidden;
      hasCollapsed ||= grid.hidden;
    }
  }
  groupViewActions.hidden = !hasExpanded && !hasCollapsed;
  expandAllGroups.setAttribute("aria-disabled", String(groupActionsDisabled || !hasCollapsed));
  collapseAllGroups.setAttribute("aria-disabled", String(groupActionsDisabled || !hasExpanded));
  selectAll.disabled = closing || closableIds.size === selected.size;
  clearSelection.disabled = closing || selected.size === 0;
  closeSelected.disabled = groupActionsDisabled || selected.size === 0;
  const label = selected.size ? `关闭所选 ${selected.size} 个标签页` : "关闭所选";
  closeSelected.textContent = closing ? "正在关闭…" : label;
}

function queueRefresh() {
  refreshNeeded = true;
  clearTimeout(refreshTimer);
  if (!closing && !syncingGroups && !gesture && !refreshing) refreshTimer = setTimeout(refreshTabs, 100);
}

async function refreshTabs() {
  if (closing || syncingGroups || gesture || refreshing) return;
  refreshNeeded = false;
  refreshing = true;
  try {
    const tabs = await getTabs();
    const nativeGroupDetails = await getNativeGroupDetails(tabs);
    if (closing || syncingGroups || gesture) {
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
  board.classList.remove("dragging");
  if (refreshNeeded) queueRefresh();
}

window.addEventListener("pointerdown", () => { suppressClick = false; }, true);

board.addEventListener("pointerdown", event => {
  if (closing || event.button !== 0 || event.pointerType !== "mouse"
    || event.target.closest(".domain-select, .domain-disclosure, .tab-jump")) return;
  gesture = {
    pointerId: event.pointerId,
    startX: event.pageX,
    startY: event.pageY,
    clientX: event.clientX,
    clientY: event.clientY,
    initialSelection: new Set(selected),
    active: false,
  };
});

window.addEventListener("pointermove", event => {
  if (gesture?.pointerId !== event.pointerId) return;
  if (!gesture.active) {
    if (Math.hypot(event.pageX - gesture.startX, event.pageY - gesture.startY) < 5) return;
    gesture.active = true;
    board.setPointerCapture(event.pointerId);
    board.classList.add("dragging");
    setStatus("");
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
  if (!jump || closing) return;
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

const usesMacDelete = /^mac/i.test(navigator.userAgentData?.platform || navigator.platform);
if (usesMacDelete) closeSelected.setAttribute("aria-keyshortcuts", "Delete Backspace");

window.addEventListener("keydown", event => {
  if (closing || event.defaultPrevented || event.isComposing || event.repeat
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

  const target = event.target;
  if (target instanceof HTMLElement && (target.isContentEditable
    || target.matches("textarea, select, input:not([type=checkbox]):not([type=radio])"))) return;

  if (event.key === "Escape" && (gesture || !clearSelection.disabled)) {
    event.preventDefault();
    if (gesture) {
      suppressClick = true;
      endGesture(false);
    }
    clearSelection.click();
  }

  const isDelete = event.key === "Delete" || (usesMacDelete && event.key === "Backspace");
  if (isDelete && !gesture && !closeSelected.disabled) {
    event.preventDefault();
    closeSelected.click();
  }
});

async function requestClosures(ids) {
  const protectedIds = new Set();
  const removals = new Map();
  await Promise.allSettled(ids.map(async id => {
    const tab = await chrome.tabs.get(id);
    if (tab.pinned !== false || !closableIds.has(id)) {
      protectedIds.add(id);
      return;
    }
    removals.set(id, chrome.tabs.remove(id).catch(() => {}));
  }));

  let timeout;
  try {
    await Promise.race([
      Promise.all(removals.values()),
      new Promise(resolve => { timeout = setTimeout(resolve, 1500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  return { attemptedIds: [...removals.keys()], protectedIds };
}

closeSelected.addEventListener("click", async event => {
  if (closing || syncingGroups || selected.size === 0) return;
  const restoreKeyboardFocus = event.detail === 0;
  closing = true;
  setStatus("");
  setSelection(selected);
  for (const { jump } of cards.values()) jump.disabled = true;

  const ids = [...selected];
  try {
    const { attemptedIds, protectedIds } = await requestClosures(ids);
    const tabs = await getTabs();
    const openIds = new Set(tabs.map(tab => tab.id));
    const closed = attemptedIds.filter(id => !openIds.has(id)).length;
    const remaining = ids.filter(id => openIds.has(id) && !protectedIds.has(id)).length;
    renderTabs(tabs, await getNativeGroupDetails(tabs));
    const summary = [`已关闭 ${closed} 个标签页`];
    if (protectedIds.size > 0) summary.push(`已保护 ${protectedIds.size} 个标签页`);
    if (remaining > 0) summary.push(`${remaining} 个仍打开`);
    setStatus(`${summary.join("，")}。`, remaining > 0);
  } catch {
    setStatus("暂时无法确认关闭结果，请刷新此页查看。", true);
  } finally {
    closing = false;
    for (const { jump } of cards.values()) jump.disabled = false;
    setSelection(selected);
    if (restoreKeyboardFocus && document.activeElement === document.body) {
      const nextAction = closeSelected.disabled ? boardTitle : closeSelected;
      nextAction.focus({ preventScroll: true });
    }
    if (refreshNeeded) queueRefresh();
  }
});

async function initialize() {
  try {
    [manager, domainLabels] = await Promise.all([chrome.tabs.getCurrent(), loadDomainLabels()]);
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
