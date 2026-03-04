// ─────────────────────────────────────────────
//  WikiTrail — popup.js
// ─────────────────────────────────────────────

const statusDot      = document.getElementById('status-dot');
const statusText     = document.getElementById('status-text');
const pageCount      = document.getElementById('page-count');
const timeElapsed    = document.getElementById('time-elapsed');
const sessionLabel   = document.getElementById('session-start-label');
const emptyState     = document.getElementById('empty-state');
const graphSvg       = document.getElementById('graph-svg');
const tooltip        = document.getElementById('tooltip');
const btnEnd         = document.getElementById('btn-end');
const btnHistory     = document.getElementById('btn-history');
const btnExport      = document.getElementById('btn-export');
const historyPanel   = document.getElementById('history-panel');
const historyList    = document.getElementById('history-list');
const btnCloseHist   = document.getElementById('btn-close-history');
const notesDrawer    = document.getElementById('notes-drawer');
const drawerTitle    = document.getElementById('drawer-node-title');
const drawerLink     = document.getElementById('drawer-wiki-link');
const notesList      = document.getElementById('notes-list');
const btnCloseDrawer = document.getElementById('btn-close-drawer');

let elapsedInterval  = null;
let currentSession   = null;

// ─────────────────────────────────────────────
//  INIT — load state from background on open
// ─────────────────────────────────────────────
async function init() {
  const { activeSession, completedTrails } = await chrome.storage.local.get([
    'activeSession',
    'completedTrails'
  ]);

  currentSession = activeSession || null;

  if (currentSession && currentSession.nodes.length > 0) {
    setActiveUI(currentSession);
    renderGraph(currentSession.nodes);
    startElapsedTimer(currentSession.startTime);
  } else {
    setIdleUI();
  }
}

// ─────────────────────────────────────────────
//  UI STATE HELPERS
// ─────────────────────────────────────────────
function setActiveUI(session) {
  statusDot.classList.add('active');
  statusText.textContent = 'tracking';
  btnEnd.disabled = false;
  btnExport.disabled = false;
  emptyState.style.display = 'none';

  pageCount.textContent = session.nodes.length;

  const start = new Date(session.startTime);
  sessionLabel.textContent = `started ${formatTime(start)}`;
}

function setIdleUI() {
  statusDot.classList.remove('active');
  statusText.textContent = 'idle';
  btnEnd.disabled = true;
  btnExport.disabled = true;
  emptyState.style.display = 'flex';
  pageCount.textContent = '0';
  timeElapsed.textContent = '0m';
  sessionLabel.textContent = '';
  clearInterval(elapsedInterval);

  // Clear graph
  d3.select('#graph-svg').selectAll('*').remove();
}

function startElapsedTimer(startTime) {
  clearInterval(elapsedInterval);

  function update() {
    const mins = Math.floor((Date.now() - startTime) / 60000);
    timeElapsed.textContent = mins < 60
      ? `${mins}m`
      : `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  update();
  elapsedInterval = setInterval(update, 10000);
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────
//  END TRAIL
// ─────────────────────────────────────────────
btnEnd.addEventListener('click', async () => {
  if (!currentSession) return;

  const { completedTrails = [] } = await chrome.storage.local.get('completedTrails');

  const finishedTrail = {
    ...currentSession,
    endTime: Date.now()
  };

  completedTrails.push(finishedTrail);

  await chrome.storage.local.set({
    completedTrails,
    activeSession: null
  });

  clearInterval(elapsedInterval);
  currentSession = null;
  setIdleUI();
});

// ─────────────────────────────────────────────
//  HISTORY PANEL
// ─────────────────────────────────────────────
btnHistory.addEventListener('click', async () => {
  const { completedTrails = [] } = await chrome.storage.local.get('completedTrails');
  renderHistoryList(completedTrails);
  historyPanel.classList.add('open');
});

btnCloseHist.addEventListener('click', () => {
  historyPanel.classList.remove('open');
});

// ─────────────────────────────────────────────
//  NOTES DRAWER
// ─────────────────────────────────────────────
function openNotesDrawer(nodeData) {
  drawerTitle.textContent = nodeData.title;
  drawerLink.href         = nodeData.url;
  notesList.innerHTML     = '';

  const notes = nodeData.notes || [];

  if (notes.length === 0) {
    notesList.innerHTML = '<p class="no-notes">No notes yet. Highlight text on this Wikipedia page and right-click → "Save to current hole".</p>';
  } else {
    notes.forEach(note => {
      const div = document.createElement('div');
      div.className = 'note-item';
      const time = new Date(note.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = `
        <div>${escapeHtml(note.text)}</div>
        <div class="note-time">${time}</div>
      `;
      notesList.appendChild(div);
    });
  }

  notesDrawer.classList.add('open');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

btnCloseDrawer.addEventListener('click', () => {
  notesDrawer.classList.remove('open');
});

function renderHistoryList(trails) {
  if (trails.length === 0) {
    historyList.innerHTML = '<p class="no-history">No past trails yet. Go explore!</p>';
    return;
  }

  historyList.innerHTML = '';

  // Most recent first
  [...trails].reverse().forEach((trail, i) => {
    const div = document.createElement('div');
    div.className = 'trail-item';

    const date     = new Date(trail.startTime);
    const duration = Math.round((trail.endTime - trail.startTime) / 60000);
    const first    = trail.nodes[0]?.title || '?';
    const last     = trail.nodes[trail.nodes.length - 1]?.title || '?';

    div.innerHTML = `
      <div class="trail-date">${date.toLocaleDateString()} at ${formatTime(date)} · ${duration}m</div>
      <div class="trail-summary">
        <strong>${first}</strong> → … → <strong>${last}</strong>
        &nbsp;·&nbsp; ${trail.nodes.length} articles
      </div>
    `;

    div.addEventListener('click', () => {
      historyPanel.classList.remove('open');
      renderGraph(trail.nodes, { readOnly: true });
      emptyState.style.display = 'none';
    });

    historyList.appendChild(div);
  });
}

// ─────────────────────────────────────────────
//  EXPORT PNG
// ─────────────────────────────────────────────
btnExport.addEventListener('click', () => {
  const svgEl   = document.getElementById('graph-svg');
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const canvas  = document.createElement('canvas');
  const ctx     = canvas.getContext('2d');
  const img     = new Image();

  canvas.width  = svgEl.clientWidth  || 460;
  canvas.height = svgEl.clientHeight || 300;

  const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);

  img.onload = () => {
    ctx.fillStyle = '#0f0f0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const link    = document.createElement('a');
    link.download = `wikitrail-${Date.now()}.png`;
    link.href     = canvas.toDataURL('image/png');
    link.click();
  };

  img.src = url;
});

// ─────────────────────────────────────────────
//  D3 GRAPH RENDERING
// ─────────────────────────────────────────────

/*
  nodes: Array of { title, url, from, time, timeSpent }
  
  We build:
    - a nodes array for D3 (one entry per unique title)
    - a links array (source → target based on `from` field)

  Layout: D3 tree layout if it's a clean tree,
  falling back to force-directed for graphs with backtracking loops.
*/

function renderGraph(nodes, options = {}) {
  const svg = d3.select('#graph-svg');
  svg.selectAll('*').remove();

  if (!nodes || nodes.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  const W = 480;
  const H = 300;
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  // ── Arrow marker ──
  svg.append('defs').append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -4 8 8')
    .attr('refX', 20)
    .attr('refY', 0)
    .attr('markerWidth', 5)
    .attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L8,0L0,4')
    .attr('fill', '#2a4a6b');

  // ── Build unique node list (pass 1: register all nodes) ──
  const nodeMap  = new Map();
  const linkData = [];

  nodes.forEach((n, i) => {
    if (!nodeMap.has(n.title)) {
      nodeMap.set(n.title, {
        id        : n.title,
        title     : n.title,
        url       : n.url,
        time      : n.time,
        timeSpent : n.timeSpent || 0,
        notes     : n.notes || [],
        index     : i
      });
    }
  });

  // ── Pass 2: build links now that all nodes are registered ──
  nodes.forEach((n) => {
    if (n.from && nodeMap.has(n.from) && nodeMap.has(n.title)) {
      const exists = linkData.some(l => l.source === n.from && l.target === n.title);
      if (!exists) {
        linkData.push({ source: n.from, target: n.title });
      }
    }
  });

  const nodeData = Array.from(nodeMap.values());

  // ── Radius scaled by time spent ──
  const maxTime = Math.max(...nodeData.map(n => n.timeSpent), 1);
  const rScale  = d3.scaleLinear().domain([0, maxTime]).range([6, 16]);

  // ── Force simulation ──
  const simulation = d3.forceSimulation(nodeData)
    .force('link',   d3.forceLink(linkData).id(d => d.id).distance(70).strength(0.8))
    .force('charge', d3.forceManyBody().strength(-180))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide(d => rScale(d.timeSpent) + 12));

  const g = svg.append('g');

  // ── Zoom & pan ──
  svg.call(
    d3.zoom()
      .scaleExtent([0.4, 3])
      .on('zoom', (event) => g.attr('transform', event.transform))
  );

  // ── Links ──
  const link = g.append('g').selectAll('line')
    .data(linkData)
    .join('line')
    .attr('class', 'link');

  // ── Nodes ──
  const node = g.append('g').selectAll('g')
    .data(nodeData)
    .join('g')
    .attr('class', d => {
      if (d.index === 0) return 'node start';
      if (d.index === nodes.length - 1) return 'node current';
      return 'node';
    })
    .call(
      d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x; d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
    );

  node.append('circle')
    .attr('r', d => rScale(d.timeSpent));

  // ── Label (truncated) ──
  node.append('text')
    .attr('dy', d => rScale(d.timeSpent) + 11)
    .text(d => d.title.length > 18 ? d.title.slice(0, 16) + '…' : d.title);

  // ── Tooltip ──
  node
    .on('mouseenter', (event, d) => {
      const mins = Math.round(d.timeSpent / 60000);
      tooltip.innerHTML = `
        <strong>${d.title}</strong>
        ${mins > 0 ? `${mins}m spent` : 'just passing through'}
      `;
      tooltip.classList.add('visible');
    })
    .on('mousemove', (event) => {
      const rect = document.getElementById('graph-container').getBoundingClientRect();
      let x = event.clientX - rect.left + 12;
      let y = event.clientY - rect.top  - 10;
      if (x + 190 > rect.width) x -= 200;
      tooltip.style.left = `${x}px`;
      tooltip.style.top  = `${y}px`;
    })
    .on('mouseleave', () => {
      tooltip.classList.remove('visible');
    });

  // ── Click → open notes drawer ──
  node.on('click', (event, d) => {
    // Prevent drag triggering a click
    if (event.defaultPrevented) return;
    openNotesDrawer(d);
  });

  // ── Tick ──
  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// ─────────────────────────────────────────────
//  LIVE POLLING
//  chrome.storage.onChanged only fires if the popup is already open
//  when the write happens — which is rare since the popup is destroyed
//  and recreated on every open. Instead we poll storage every second
//  while the popup is open, and re-render only when node count changes.
// ─────────────────────────────────────────────
let lastNodeCount = 0;
let pollInterval  = null;

function startPolling() {
  pollInterval = setInterval(async () => {
    const { activeSession } = await chrome.storage.local.get('activeSession');

    if (activeSession && activeSession.nodes.length !== lastNodeCount) {
      lastNodeCount  = activeSession.nodes.length;
      currentSession = activeSession;
      setActiveUI(activeSession);
      renderGraph(activeSession.nodes);
      startElapsedTimer(activeSession.startTime);
    }

    // Session ended externally (e.g. navigated away from wiki)
    if (!activeSession && currentSession) {
      currentSession = null;
      lastNodeCount  = 0;
      setIdleUI();
    }
  }, 1000);
}

// ─────────────────────────────────────────────
//  GO
// ─────────────────────────────────────────────
init();
startPolling();
