// Content script that runs on web pages
console.log('ReadMark content script loaded');

let readmarkEnabled = true;

function applyWidgetVisibility() {
  const container = document.getElementById('readmark-widget-container');
  if (container) {
    container.style.display = readmarkEnabled ? '' : 'none';
  }
}

function setReadmarkEnabled(enabled) {
  readmarkEnabled = enabled;
  applyWidgetVisibility();
  if (!enabled) {
    const overlay = document.getElementById('readmark-modal-overlay');
    if (overlay) overlay.remove();
  }
}

function applyMinimizedUi(minimized) {
  const shell = document.querySelector('#readmark-widget-container .readmark-widget');
  const toggleBtn = document.querySelector('#readmark-widget-container [data-action="toggle"]');
  if (!shell || !toggleBtn) return;
  if (minimized) shell.classList.add('readmark-minimized');
  else shell.classList.remove('readmark-minimized');
  toggleBtn.textContent = minimized ? '+' : '−';
  toggleBtn.title = minimized ? 'Expand' : 'Minimize';
  toggleBtn.setAttribute('aria-expanded', minimized ? 'false' : 'true');
}

function updateHighlightStats(highlights) {
  const countEl = document.getElementById('readmark-count');
  const tagsEl = document.getElementById('readmark-tags-count');
  if (countEl) countEl.textContent = highlights.length;
  if (tagsEl) {
    const allTags = new Set();
    highlights.forEach((h) => (h.tags || []).forEach((t) => allTags.add(t)));
    tagsEl.textContent = allTags.size;
  }
}

let highlightRefreshGeneration = 0;

function refreshHighlightsFromStorage() {
  const list = document.getElementById('readmark-highlights-list');
  if (!list) return;

  const gen = ++highlightRefreshGeneration;
  const activeTab = document.querySelector('.readmark-tab.active');
  const tabId = activeTab?.dataset.tab || 'recent';

  chrome.storage.local.get(['readmarks'], (res) => {
    if (gen !== highlightRefreshGeneration) return;

    const highlights = res.readmarks || [];

    if (tabId === 'tags') {
      updateHighlightStats(highlights);
      renderTagsView(highlights, list);
      return;
    }

    const input = document.getElementById('readmark-search');
    const query = (input?.value || '').toLowerCase().trim();
    if (query) {
      const filtered = highlights.filter(
        (h) =>
          (h.text || '').toLowerCase().includes(query) ||
          (h.note || '').toLowerCase().includes(query) ||
          (h.tags || []).some((t) => t.toLowerCase().includes(query))
      );
      renderHighlights(filtered, list);
    } else {
      renderHighlights(highlights, list);
    }
    updateHighlightStats(highlights);
  });
}

function hydrateHighlightsList(highlights) {
  const list = document.getElementById('readmark-highlights-list');
  if (!list) return;

  updateHighlightStats(highlights);

  if (!highlights.length) {
    list.innerHTML = `
      <div class="readmark-highlight-item">
        <div class="readmark-highlight-text">No highlights yet</div>
      </div>
    `;
    return;
  }

  list.innerHTML = highlights
    .slice()
    .reverse()
    .map(
      (h) => `
        <div class="readmark-highlight-item">

          <div class="readmark-highlight-text">
            "${h.text}"
          </div>

          ${h.note ? `
            <div style="margin-top:6px; font-size:12px; color:#444;">
              ${h.note}
            </div>
          ` : ''}

          ${h.tags && h.tags.length ? `
            <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
              ${h.tags.map((t) => `
                <span class="readmark-tag">${t}</span>
              `).join('')}
            </div>
          ` : ''}

          ${h.timestamp ? `
            <div style="margin-top:8px; font-size:10px; color:#aaa;">
              ${new Date(h.timestamp).toLocaleDateString()}
            </div>
          ` : ''}

        </div>
      `
    )
    .join('');
}

// Inject the floating widget into the page
function injectWidget(initialStorage) {
  if (document.getElementById('readmark-widget-container')) {
    return;
  }

  const container = document.createElement('div');
  container.id = 'readmark-widget-container';
  container.style.cssText = `
    position: fixed;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    left: auto;
    top: auto;
    right: 20px;
    bottom: 20px;
  `;

  const style = document.createElement('style');
  style.textContent = `
    #readmark-widget-container * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
      .readmark-form-group {
  margin-top: 10px;
}

.readmark-form-label {
  display: block;
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

    .readmark-widget {
      --readmark-panel-width: 420px;
      position: relative;
      width: var(--readmark-panel-width);
      max-width: min(640px, calc(100vw - 40px));
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.12);
      overflow: hidden;
      border: 1px solid #eaeaea;
      transition:
        width 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
        height 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
        border-radius 0.4s cubic-bezier(0.34, 1.15, 0.64, 1),
        box-shadow 0.35s ease,
        min-height 0.4s cubic-bezier(0.34, 1.15, 0.64, 1);
      min-height: 0;
    }

    .readmark-widget.readmark-minimized {
      width: 56px;
      height: 56px;
      min-width: 56px;
      min-height: 56px;
      max-width: 56px;
      border-radius: 50%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      border-color: rgba(0,0,0,0.06);
    }

    .readmark-panel {
      transition:
        opacity 0.32s ease,
        transform 0.42s cubic-bezier(0.34, 1.15, 0.64, 1),
        max-height 0.42s cubic-bezier(0.34, 1.15, 0.64, 1);
      transform-origin: center bottom;
      max-height: min(90vh, 680px);
      opacity: 1;
      transform: scale(1) translateY(0);
    }

    .readmark-widget.readmark-minimized .readmark-panel {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
      max-height: 0;
      overflow: hidden;
      pointer-events: none;
    }

    .readmark-fab {
      position: absolute;
      inset: 0;
      margin: auto;
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: #111;
      color: #fff;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      opacity: 0;
      pointer-events: none;
      transform: scale(0.85);
      transition:
        opacity 0.35s ease 0.08s,
        transform 0.45s cubic-bezier(0.34, 1.15, 0.64, 1) 0.06s,
        background 0.2s ease;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
    }

    .readmark-fab:hover {
      background: #222;
    }

    .readmark-fab:active {
      cursor: grabbing;
    }

    .readmark-widget.readmark-minimized .readmark-fab {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1);
    }

    .readmark-fab svg {
      display: block;
    }

    .readmark-size-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      background: #f7f7f7;
      border-bottom: 1px solid #eee;
    }

    .readmark-size-row label {
      font-size: 11px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      white-space: nowrap;
    }

    .readmark-width-slider {
      flex: 1;
      min-width: 0;
      height: 4px;
      accent-color: #111;
      cursor: pointer;
    }

    .readmark-header {
      background: #111;
      padding: 14px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: grab;
      user-select: none;
    }

    .readmark-widget.readmark-dragging .readmark-header {
      cursor: grabbing;
    }

    .readmark-widget.readmark-dragging .readmark-fab {
      cursor: grabbing;
    }

    .readmark-title {
      color: #fff;
      font-weight: 600;
      font-size: 14px;
    }

    .readmark-toggle {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.15);
      color: #fff;
      min-width: 28px;
      height: 28px;
      padding: 0 8px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .readmark-toggle:hover {
      background: rgba(255,255,255,0.14);
    }

    .readmark-content {
      padding: 14px;
      max-height: 500px;
      overflow-y: auto;
    }

    .readmark-content::-webkit-scrollbar {
      width: 6px;
    }

    .readmark-content::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 3px;
    }

    .readmark-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid #eee;
    }

    .readmark-stat-number {
      font-size: 18px;
      font-weight: 700;
      color: #111;
    }

    .readmark-stat-label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
    }

    .readmark-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      border-bottom: 1px solid #eee;
    }

    .readmark-tab {
      background: none;
      border: none;
      padding: 8px 10px;
      font-size: 13px;
      color: #888;
      cursor: pointer;
      border-bottom: 2px solid transparent;
    }

    .readmark-tab.active {
      color: #111;
      border-bottom-color: #111;
    }

    .readmark-highlight-item {
      padding: 12px;
      margin-bottom: 10px;
      background: #fafafa;
      border-left: 2px solid #111;
      border-radius: 8px;
    }

    .readmark-highlight-text {
      color: #111;
      font-style: italic;
    }

    .readmark-tag {
      background: #111;
      color: #fff;
      font-size: 10px;
      padding: 3px 6px;
      border-radius: 4px;
    }

    .readmark-btn-primary {
      background: #111;
      color: #fff;
    }

    .readmark-btn-secondary {
      background: #f2f2f2;
      color: #111;
    }

    .readmark-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000000;
    }

    .readmark-modal {
      background: #fff;
      border-radius: 12px;
      padding: 18px;
      border: 1px solid #eee;
      box-shadow: 0 10px 40px rgba(0,0,0,0.15);
    }

    .readmark-modal-title {
      font-weight: 700;
      margin-bottom: 10px;
      color: #111;
    }

    .readmark-modal-text {
      font-size: 13px;
      padding: 10px;
      background: #fafafa;
      border-left: 2px solid #111;
      margin-bottom: 12px;
    }

    .readmark-form-input,
    .readmark-form-textarea {
      width: 100%;
      border: 1px solid #ddd;
      padding: 8px;
      border-radius: 8px;
    }

    .readmark-form-input:focus,
    .readmark-form-textarea:focus {
      outline: none;
      border-color: #111;
    }

    .readmark-modal-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .readmark-modal-actions button {
      flex: 1;
      padding: 10px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-weight: 600;
    }
  `;
  document.head.appendChild(style);

  container.innerHTML = `
    <div class="readmark-widget">
      <div class="readmark-panel">
      <div class="readmark-header">
        <div class="readmark-title"> Jot</div>
        <button type="button" class="readmark-toggle" data-action="toggle" title="Minimize" aria-expanded="true">−</button>
      </div>
     

      <div class="readmark-content">
      <div style="margin-bottom:10px;">
        <input
            id="readmark-search"
            placeholder="Search highlights..."
            style="
            width:100%;
            padding:8px 10px;
            border:1px solid #ddd;
            border-radius:8px;
            font-size:13px;
            outline:none;
            "
        />
        </div>
        <div class="readmark-stats">
          <div>
            <div class="readmark-stat-number" id="readmark-count">0</div>
            <div class="readmark-stat-label">Highlights</div>
          </div>
          <div>
            <div class="readmark-stat-number" id="readmark-tags-count">0</div>
            <div class="readmark-stat-label">Tags</div>
          </div>
        </div>

        <div class="readmark-tabs">
          <button class="readmark-tab active" data-tab="recent">Recent</button>
          <button class="readmark-tab" data-tab="tags">Tags</button>
        </div>

        <div id="readmark-highlights-list"></div>
      </div>
      </div>
      <button type="button" class="readmark-fab" data-action="expand" title="Open Jot" aria-label="Open Jot">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(container);
  container.style.display = readmarkEnabled ? '' : 'none';

  setupWidgetEvents(initialStorage);
  hydrateHighlightsList((initialStorage && initialStorage.readmarks) || []);
  setupTabs();
  setupSearch();
}

const DEFAULT_WIDGET_WIDTH = 420;
const WIDGET_WIDTH_MIN = 280;
const WIDGET_WIDTH_MAX = 640;

function applyWidgetWidth(px) {
  const root = document.querySelector('#readmark-widget-container .readmark-widget');
  const slider = document.getElementById('readmark-width-slider');
  const w = Math.min(WIDGET_WIDTH_MAX, Math.max(WIDGET_WIDTH_MIN, Math.round(px)));
  if (root) root.style.setProperty('--readmark-panel-width', `${w}px`);
  if (slider) slider.value = String(w);
}

function applyWidgetPosition(container, left, top) {
  const pad = 8;
  const r = container.getBoundingClientRect();
  const w = r.width;
  const h = r.height;
  const maxL = Math.max(pad, window.innerWidth - w - pad);
  const maxT = Math.max(pad, window.innerHeight - h - pad);
  const x = Math.min(maxL, Math.max(pad, left));
  const y = Math.min(maxT, Math.max(pad, top));
  container.style.left = `${Math.round(x)}px`;
  container.style.top = `${Math.round(y)}px`;
  container.style.right = 'auto';
  container.style.bottom = 'auto';
}

function setupWidgetDrag(container, shell, fabGuard) {
  let down = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  let dragStartedOnFab = false;

  let resizeSaveTimer = null;
  function savePosition() {
    const r = container.getBoundingClientRect();
    chrome.storage.local.set({
      readmarkWidgetPosition: { left: Math.round(r.left), top: Math.round(r.top) }
    });
  }

  function scheduleResizePositionSave() {
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      resizeSaveTimer = null;
      savePosition();
    }, 120);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const header = e.target.closest('.readmark-header');
    const fab = e.target.closest('.readmark-fab');
    if (header && e.target.closest('.readmark-toggle')) return;
    if (!header && !fab) return;

    down = true;
    dragging = false;
    dragStartedOnFab = !!fab;
    const r = container.getBoundingClientRect();
    origLeft = r.left;
    origTop = r.top;
    startX = e.clientX;
    startY = e.clientY;
  }

  function onPointerMove(e) {
    if (!down) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      dragging = true;
      document.body.style.userSelect = 'none';
      shell.classList.add('readmark-dragging');
    }
    applyWidgetPosition(container, origLeft + dx, origTop + dy);
  }

  function onPointerUp() {
    if (down && dragging) {
      savePosition();
      if (dragStartedOnFab) fabGuard.ignoreNextClick = true;
    }
    down = false;
    dragging = false;
    dragStartedOnFab = false;
    document.body.style.userSelect = '';
    shell.classList.remove('readmark-dragging');
  }

  shell.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    const r = container.getBoundingClientRect();
    applyWidgetPosition(container, r.left, r.top);
    scheduleResizePositionSave();
  });
}

function setupWidgetEvents(initialStorage) {
  const container = document.getElementById('readmark-widget-container');
  if (!container) return;

  const shell = container.querySelector('.readmark-widget');
  const toggleBtn = container.querySelector('[data-action="toggle"]');
  const expandFab = container.querySelector('[data-action="expand"]');
  const slider = document.getElementById('readmark-width-slider');

  const fabGuard = { ignoreNextClick: false };
  if (shell) {
    setupWidgetDrag(container, shell, fabGuard);
  }

  if (slider) {
    slider.addEventListener('input', () => {
      applyWidgetWidth(Number(slider.value));
    });
    slider.addEventListener('change', () => {
      const w = Number(slider.value);
      chrome.storage.local.set({ readmarkWidgetWidth: w });
    });
  }

  if (toggleBtn && shell) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const minimized = shell.classList.toggle('readmark-minimized');
      applyMinimizedUi(minimized);
      chrome.storage.local.set({ readmarkWidgetMinimized: minimized });
    });
  }

  if (expandFab && shell) {
    expandFab.addEventListener('click', (e) => {
      e.stopPropagation();
      if (fabGuard.ignoreNextClick) {
        fabGuard.ignoreNextClick = false;
        return;
      }
      if (!shell.classList.contains('readmark-minimized')) return;
      shell.classList.remove('readmark-minimized');
      applyMinimizedUi(false);
      chrome.storage.local.set({ readmarkWidgetMinimized: false });
    });
  }

  const boot = initialStorage || {};
  const w = boot.readmarkWidgetWidth ?? DEFAULT_WIDGET_WIDTH;
  applyWidgetWidth(w);
  const pos = boot.readmarkWidgetPosition;
  if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
    requestAnimationFrame(() => {
      applyWidgetPosition(container, pos.left, pos.top);
    });
  }
  if (boot.readmarkWidgetMinimized === true && shell) {
    shell.classList.add('readmark-minimized');
    applyMinimizedUi(true);
  }
}

function showSaveDialog(selectedText) {
if (!readmarkEnabled) return;
  // Remove existing modal if present
  const existing = document.getElementById('readmark-modal-overlay');
  if (existing) existing.remove();

  const selection = window.getSelection();
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.id = 'readmark-modal-overlay';
  overlay.className = 'readmark-modal-overlay';

  overlay.innerHTML = `
    <div class="readmark-modal">
      <div class="readmark-modal-title">Save Highlight</div>

      <div class="readmark-modal-text">
        "${selectedText.substring(0, 200)}${selectedText.length > 200 ? '...' : ''}"
      </div>

      <div class="readmark-form-group">
        <label class="readmark-form-label">Your Notes (optional)</label>
        <textarea class="readmark-form-textarea" id="readmark-note-input"></textarea>
      </div>

      <div class="readmark-form-group">
        <label class="readmark-form-label">Tags</label>
        <input class="readmark-form-input" id="readmark-tags-input" placeholder="e.g. learning, idea" />
      </div>

      <div class="readmark-modal-actions">
        <button class="readmark-btn readmark-btn-secondary" id="readmark-cancel">Cancel</button>
        <button class="readmark-btn readmark-btn-primary" id="readmark-save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const modal = overlay.querySelector(".readmark-modal");
  const title = overlay.querySelector(".readmark-modal-title");

  /* =========================
     POSITION NEAR SELECTION
  ========================= */
  modal.style.position = "fixed";
  modal.style.zIndex = 1000001;

  const top = window.scrollY + rect.bottom + 10;
  const left = window.scrollX + rect.left;

  modal.style.top = `${top}px`;
  modal.style.left = `${left}px`;

  /* keep inside viewport */
  requestAnimationFrame(() => {
    const mRect = modal.getBoundingClientRect();

    if (mRect.right > window.innerWidth) {
      modal.style.left = `${window.innerWidth - mRect.width - 12}px`;
    }

    if (mRect.bottom > window.innerHeight) {
      modal.style.top = `${window.scrollY + rect.top - mRect.height - 12}px`;
    }
  });

  /* =========================
     DRAGGING (FIXED)
  ========================= */
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  title.style.cursor = "grab";

  title.addEventListener("mousedown", (e) => {
    isDragging = true;

    const rect = modal.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    modal.style.position = "fixed";
    modal.style.zIndex = 1000002;

    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    modal.style.left = `${e.clientX - offsetX}px`;
    modal.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
    document.body.style.userSelect = "auto";
  });

  /* =========================
     SAVE LOGIC (UNCHANGED)
  ========================= */
  document.getElementById("readmark-save").onclick = () => {
    const note = document.getElementById("readmark-note-input").value;
    const tags = document
      .getElementById("readmark-tags-input")
      .value.split(",")
      .map(t => t.trim())
      .filter(Boolean);

    chrome.storage.local.get(["readmarks"], (res) => {
      const data = res.readmarks || [];

      data.push({
        text: selectedText,
        note,
        tags,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        domain: window.location.hostname
      });

      chrome.storage.local.set({ readmarks: data }, () => {
        overlay.remove();
        refreshHighlightsFromStorage();

        const toast = document.createElement("div");
        toast.textContent = "✓ Saved!";
        toast.style.cssText = `
          position: fixed;
          bottom: 80px;
          right: 20px;
          background: #111;
          color: #fff;
          padding: 10px 14px;
          border-radius: 8px;
          z-index: 1000000;
        `;

        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      });
    });
  };

  document.getElementById("readmark-cancel").onclick = () => {
    overlay.remove();
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  setTimeout(() => {
    document.getElementById("readmark-note-input").focus();
  }, 0);
}


function setupTabs() {
  const tabs = document.querySelectorAll(".readmark-tab");
  const list = document.getElementById("readmark-highlights-list");

  if (!tabs.length || !list) return;

  const render = (type) => {
    chrome.storage.local.get(["readmarks"], (res) => {
      const highlights = res.readmarks || [];

      if (type === "recent") {
        renderHighlights(highlights, list);
      } else if (type === "tags") {
        renderTagsView(highlights, list);
      }
    });
  };

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      render(tab.dataset.tab);
    });
  });
}

function renderTagsView(highlights, list) {
  const tagMap = {};

  highlights.forEach(h => {
    (h.tags || []).forEach(tag => {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    });
  });

  const tags = Object.entries(tagMap);

  if (!tags.length) {
    list.innerHTML = `
      <div class="readmark-highlight-item">
        <div class="readmark-highlight-text">No tags yet</div>
      </div>
    `;
    return;
  }

  list.innerHTML = tags.map(([tag, count]) => `
    <div class="readmark-highlight-item">
      <div class="readmark-highlight-text">
        #${tag}
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">
        ${count} highlight(s)
      </div>
    </div>
  `).join('');
}

function renderHighlights(highlights, list) {
  document.getElementById('readmark-count').textContent = highlights.length;

  if (!highlights.length) {
    list.innerHTML = `
      <div class="readmark-highlight-item">
        <div class="readmark-highlight-text">No highlights yet</div>
      </div>
    `;
    return;
  }

  list.innerHTML = highlights
    .slice()
    .reverse()
    .map(h => `
      <div class="readmark-highlight-item">

        <div class="readmark-highlight-text">
          "${h.text}"
        </div>

        ${h.note ? `
          <div style="margin-top:6px; font-size:12px; color:#444;">
            ${h.note}
          </div>
        ` : ''}

        ${h.tags && h.tags.length ? `
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            ${h.tags.map(t => `
              <span class="readmark-tag">${t}</span>
            `).join('')}
          </div>
        ` : ''}

        ${h.timestamp ? `
          <div style="margin-top:8px; font-size:10px; color:#aaa;">
            ${new Date(h.timestamp).toLocaleDateString()}
          </div>
        ` : ''}

      </div>
    `)
    .join('');
}

function setupSearch() {
  const input = document.getElementById("readmark-search");
  const list = document.getElementById("readmark-highlights-list");

  if (!input || !list) return;

  input.addEventListener("input", () => {
    const query = input.value.toLowerCase();

    chrome.storage.local.get(["readmarks"], (res) => {
      let highlights = res.readmarks || [];

      if (!query) {
        renderHighlights(highlights, list);
        return;
      }

      const filtered = highlights.filter(h =>
        (h.text || "").toLowerCase().includes(query) ||
        (h.note || "").toLowerCase().includes(query) ||
        (h.tags || []).some(t => t.toLowerCase().includes(query))
      );

      renderHighlights(filtered, list);
    });
  });
}


const READMARK_CONTENT_INIT = '__readmarkJotContentScriptInit';

function registerReadmarkContentListeners() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'TOGGLE_READMARK') {
      setReadmarkEnabled(!!msg.enabled);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.readmarkEnabled) {
      setReadmarkEnabled(changes.readmarkEnabled.newValue ?? true);
    }

    const container = document.getElementById('readmark-widget-container');
    if (!container) {
      return;
    }

    if (changes.readmarkWidgetMinimized) {
      applyMinimizedUi(changes.readmarkWidgetMinimized.newValue === true);
    }

    if (changes.readmarkWidgetWidth) {
      const w = changes.readmarkWidgetWidth.newValue;
      if (typeof w === 'number' && !Number.isNaN(w)) {
        applyWidgetWidth(w);
      }
    }

    if (changes.readmarkWidgetPosition) {
      const pos = changes.readmarkWidgetPosition.newValue;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        requestAnimationFrame(() => applyWidgetPosition(container, pos.left, pos.top));
      }
    }

    if (changes.readmarks) {
      refreshHighlightsFromStorage();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!readmarkEnabled) return;

    const text = window.getSelection().toString().trim();
    if (text.length) showSaveDialog(text);
  });
}

function bootstrapReadmarkContentScript() {
  chrome.storage.local.get(
    [
      'readmarkEnabled',
      'readmarks',
      'readmarkWidgetWidth',
      'readmarkWidgetPosition',
      'readmarkWidgetMinimized',
    ],
    (res) => {
      readmarkEnabled = res.readmarkEnabled ?? true;
      const inject = () => injectWidget(res);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject, { once: true });
      } else {
        inject();
      }
    }
  );
}

if (globalThis[READMARK_CONTENT_INIT]) {
  chrome.storage.local.get(['readmarkEnabled'], (r) => {
    readmarkEnabled = r.readmarkEnabled ?? true;
    applyWidgetVisibility();
  });
} else {
  globalThis[READMARK_CONTENT_INIT] = true;
  registerReadmarkContentListeners();
  bootstrapReadmarkContentScript();
}