// ─────────────────────────────────────────────
//  WikiTrail — background.js (service worker)
// ─────────────────────────────────────────────

const WIKI_PATTERN = /^https?:\/\/([a-z]+\.)?wikipedia\.org\/wiki\/(.+)$/;

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────

function isWikiUrl(url) {
  return WIKI_PATTERN.test(url);
}

function titleFromUrl(url) {
  const match = url.match(WIKI_PATTERN);
  if (!match) return null;
  return decodeURIComponent(match[2]).replace(/_/g, " ");
}

async function getSession() {
  const { activeSession } = await chrome.storage.local.get("activeSession");
  return activeSession || null;
}

async function saveSession(session) {
  await chrome.storage.local.set({ activeSession: session });
}

// ─────────────────────────────────────────────
//  CORE: handle a URL change in a tab
// ─────────────────────────────────────────────

// { tabId: { url, title, arrivedAt } }
const tabState = {};

async function handleNavigation(tabId, url) {
  const nowOnWiki = isWikiUrl(url);
  const prev = tabState[tabId];
  const session = await getSession();

  // ── Leaving Wikipedia ──
  if (!nowOnWiki) {
    if (prev) {
      if (session) {
        updateTimeSpent(session, prev.title, prev.arrivedAt);
        await saveSession(session);
      }
      delete tabState[tabId];
    }
    return;
  }

  // ── On Wikipedia ──
  const title = titleFromUrl(url);
  if (!title) return;

  // Skip special pages
  if (
    /^(File|Special|Talk|User|Wikipedia|Help|Portal|Category|Template):/i.test(
      title,
    )
  )
    return;

  // Same page reload — ignore
  if (prev && prev.title === title) return;

  // ── Update time spent on previous page ──
  if (prev && session) {
    updateTimeSpent(session, prev.title, prev.arrivedAt);
  }

  // ── Start a new session if none exists ──
  if (!session) {
    const newSession = {
      id: Date.now(),
      startTime: Date.now(),
      nodes: [
        {
          title: title,
          url: url,
          from: null,
          time: Date.now(),
          timeSpent: 0,
          notes: [],
        },
      ],
    };
    tabState[tabId] = { url, title, arrivedAt: Date.now() };
    await saveSession(newSession);
    return;
  }

  // ── Add node to existing session ──
  const fromTitle = prev ? prev.title : null;

  const lastNode = session.nodes[session.nodes.length - 1];
  if (lastNode && lastNode.title === title) {
    tabState[tabId] = { url, title, arrivedAt: Date.now() };
    return;
  }

  session.nodes.push({
    title: title,
    url: url,
    from: fromTitle,
    time: Date.now(),
    timeSpent: 0,
    notes: [],
  });

  tabState[tabId] = { url, title, arrivedAt: Date.now() };
  await saveSession(session);
}

function updateTimeSpent(session, title, arrivedAt) {
  const node = session.nodes.find((n) => n.title === title);
  if (node) {
    node.timeSpent = (node.timeSpent || 0) + (Date.now() - arrivedAt);
  }
}

// ─────────────────────────────────────────────
//  TAB EVENT LISTENERS
// ─────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    handleNavigation(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const prev = tabState[tabId];
  if (!prev) return;

  const session = await getSession();
  if (session) {
    updateTimeSpent(session, prev.title, prev.arrivedAt);
    await saveSession(session);
  }

  delete tabState[tabId];
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && isWikiUrl(tab.url)) {
      const title = titleFromUrl(tab.url);
      if (title) {
        tabState[tabId] = {
          url: tab.url,
          title: title,
          arrivedAt: Date.now(),
        };
      }
    }
  } catch (e) {}
});

// ─────────────────────────────────────────────
//  WINDOW FOCUS — pause/resume time tracking
// ─────────────────────────────────────────────

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const session = await getSession();
    if (!session) return;

    for (const [tabId, state] of Object.entries(tabState)) {
      updateTimeSpent(session, state.title, state.arrivedAt);
      tabState[tabId].arrivedAt = Date.now();
    }
    await saveSession(session);
  }
});

// ─────────────────────────────────────────────
//  CONTEXT MENU — "Save to current node"
// ─────────────────────────────────────────────

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-to-node",
      title: "Save to current wiki node",
      contexts: ["selection"],
      documentUrlPatterns: ["*://*.wikipedia.org/*"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "save-to-node") return;

  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  const session = await getSession();
  if (!session) {
    console.log("[WikiTrail] No active session — note not saved.");
    return;
  }

  const currentTitle = titleFromUrl(tab.url);
  if (!currentTitle) return;

  const node = session.nodes.find((n) => n.title === currentTitle);
  if (!node) {
    console.log("[WikiTrail] Node not found for title:", currentTitle);
    return;
  }

  if (!node.notes) node.notes = [];
  node.notes.push({ text: selectedText, time: Date.now() });

  await saveSession(session);
  console.log(`[WikiTrail] Note saved to "${currentTitle}":`, selectedText);
});

// ─────────────────────────────────────────────
//  INSTALL / STARTUP
// ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove("activeSession");
  registerContextMenu();
  console.log("WikiTrail installed.");
});

chrome.runtime.onStartup.addListener(async () => {
  registerContextMenu();
  const session = await getSession();
  if (session) {
    const { completedTrails = [] } =
      await chrome.storage.local.get("completedTrails");
    completedTrails.push({ ...session, endTime: Date.now() });
    await chrome.storage.local.set({ completedTrails, activeSession: null });
  }
});
