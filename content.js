let readmarkEnabled = true;

function extensionContextValid() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch {
    return false;
  }
}

function safeStorageGet(keys, callback) {
  if (!extensionContextValid()) return;
  try {
    chrome.storage.local.get(keys, (res) => {
      if (!extensionContextValid()) return;
      void chrome.runtime.lastError;
      callback(res);
    });
  } catch {
    /* extension context invalidated */
  }
}

function safeStorageSet(items, callback) {
  if (!extensionContextValid()) return;
  try {
    chrome.storage.local.set(items, () => {
      if (!extensionContextValid()) return;
      void chrome.runtime.lastError;
      if (callback) callback();
    });
  } catch {
    /* extension context invalidated */
  }
}

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

  safeStorageGet(['readmarks'], (res) => {
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
    list.innerHTML = `<div class="readmark-no-highlights">No highlights yet</div>`;
    return;
  }

  list.innerHTML = highlights
    .slice()
    .reverse()
    .map(
      (h) => `
        <div class="readmark-highlight-item">
          <div class="readmark-highlight-text">"${h.text}"</div>
          ${h.note ? `<div class="readmark-highlight-note">${h.note}</div>` : ''}
          ${h.tags && h.tags.length ? `
            <div class="readmark-highlight-tags">
              ${h.tags.map((t) => `<span class="readmark-tag">#${t}</span>`).join('')}
            </div>
          ` : ''}
          ${h.timestamp ? `
            <div class="readmark-highlight-date">${new Date(h.timestamp).toLocaleDateString()}</div>
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

    /* ===============================
       WIDGET SHELL
    =============================== */

    .readmark-widget {
      --readmark-panel-width: 480px;
      width: var(--readmark-panel-width);
      max-width: min(720px, calc(100vw - 40px));
      background: #f5f3f0;
      border-radius: 12px;
      border: 1px solid #ddd;
      box-shadow: 0 12px 32px rgba(0,0,0,0.12);
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
    }

    .readmark-widget.readmark-minimized {
      width: 56px;
      height: 56px;
      border-radius: 50%;
    }

    /* ===============================
       PANEL
    =============================== */

    .readmark-panel {
      display: flex;
      flex-direction: column;
      max-height: min(90vh, 700px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }

    .readmark-widget.readmark-minimized .readmark-panel {
      opacity: 0;
      pointer-events: none;
    }

    /* ===============================
       FLOATING BUTTON
    =============================== */

    .readmark-fab {
      position: absolute;
      inset: 0;
      margin: auto;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: none;
      background: #111;
      color: #f6f4f0;
      opacity: 0;
      pointer-events: none;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .readmark-fab:hover {
      background: #333;
    }

    .readmark-widget.readmark-minimized .readmark-fab {
      opacity: 1;
      pointer-events: auto;
    }

    /* ===============================
       HEADER
    =============================== */

    .readmark-header {
      background: #2a2a2a;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      border-bottom: 1px solid #1a1a1a;
    }

    .readmark-title {
      color: #fff;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.5px;
    }

    .readmark-toggle {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.3);
      color: #fff;
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s ease;
    }

    .readmark-toggle:hover {
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.5);
    }

    /* ===============================
       TAGLINE
    =============================== */

    .readmark-tagline {
      color: #666;
      font-size: 13px;
      font-style: italic;
      padding: 12px 20px 0;
      margin-bottom: 12px;
    }

    /* ===============================
       CONTENT AREA
    =============================== */

    .readmark-content {
      padding: 0 20px 20px 20px;
      background: #f5f3f0;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .readmark-content::-webkit-scrollbar {
      width: 6px;
    }

    .readmark-content::-webkit-scrollbar-thumb {
      background: #ccc;
      border-radius: 3px;
    }

    .readmark-content::-webkit-scrollbar-track {
      background: transparent;
    }

    /* ===============================
       SEARCH
    =============================== */

    .readmark-search-container {
      margin-bottom: 16px;
      position: relative;
      margin-top: 16px;
    }

    .readmark-search-input {
      width: 100%;
      padding: 10px 14px 10px 14px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      background: #fff;
      transition: all 0.2s ease;
    }

    .readmark-search-input:focus {
      border-color: #999;
      box-shadow: 0 0 0 2px rgba(0,0,0,0.05);
    }

    .readmark-search-input::placeholder {
      color: #999;
    }

    .readmark-search-icon {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #999;
      pointer-events: none;
    }

    /* ===============================
       TABS
    =============================== */

    .readmark-tabs-container {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      align-items: center;
    }

    .readmark-tabs {
      display: flex;
      gap: 16px;
    }

    .readmark-tab {
      background: none;
      border: none;
      padding: 8px 0;
      font-size: 13px;
      color: #888;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s ease;
      font-weight: 500;
    }

    .readmark-tab:hover {
      color: #555;
    }

    .readmark-tab.active {
      color: #111;
      border-bottom: 2px solid #111;
    }

    .readmark-tabs-divider {
      margin-left: auto;
      width: 1px;
      height: 16px;
      background: #ddd;
    }

    .readmark-stats {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .readmark-stat {
      text-align: right;
    }

    .readmark-stat-number {
      font-size: 13px;
      font-weight: 700;
      color: #111;
    }

    .readmark-stat-label {
      font-size: 10px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    /* ===============================
       HIGHLIGHTS GRID
    =============================== */

    .readmark-highlights-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      flex: 1;
    }

    .readmark-highlight-item {
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 120px;
      transition: all 0.2s ease;
    }

    .readmark-highlight-item:hover {
      border-color: #ccc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }

    .readmark-highlight-text {
      font-size: 13px;
      line-height: 1.4;
      color: #111;
      flex: 1;
      word-break: break-word;
    }

    .readmark-highlight-note {
      margin-top: 4px;
      font-size: 11px;
      color: #666;
      background: #f9f9f9;
      padding: 6px 8px;
      border-radius: 4px;
      border-left: 2px solid #ddd;
    }

    .readmark-highlight-tags {
      margin-top: auto;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .readmark-tag {
      background: #f0f0f0;
      border: 1px solid #e0e0e0;
      color: #555;
      font-size: 10px;
      padding: 3px 7px;
      border-radius: 4px;
    }

    .readmark-highlight-date {
      font-size: 9px;
      color: #aaa;
    }

    .readmark-no-highlights {
      text-align: center;
      padding: 60px 20px;
      color: #999;
      font-size: 13px;
    }

    /* ===============================
       BUTTONS
    =============================== */

    .readmark-btn-primary {
      background: #111;
      color: #f6f4f0;
    }

    .readmark-btn-secondary {
      background: #f6f4f0;
      border: 1px solid #ccc;
    }

    /* ===============================
       MODAL
    =============================== */

    .readmark-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.35);
      z-index: 1000000;
    }

    .readmark-modal {
      background: #f5f3f0;
      border: 1px solid #e5e5e5;
      border-radius: 12px;
      padding: 18px;
    }

    .readmark-modal-title {
      font-weight: 600;
      margin-bottom: 10px;
    }

    .readmark-modal-text {
      font-size: 13px;
      background: #fff;
      border-left: 3px solid #111;
      padding: 10px;
      margin-bottom: 12px;
    }

    .readmark-form-input,
    .readmark-form-textarea {
      width: 100%;
      border: 1px solid #ddd;
      padding: 8px;
      border-radius: 8px;
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
      font-weight: 500;
    }
  `;
  document.head.appendChild(style);

  container.innerHTML = `
    <div class="readmark-widget">
      <div class="readmark-panel">
        <div class="readmark-header">
          <div class="readmark-title">Jot.</div>
          <button type="button" class="readmark-toggle" data-action="toggle" title="Minimize" aria-expanded="true">−</button>
        </div>

        <div class="readmark-content">
          <div class="readmark-tagline">Your second brain.</div>

          <div class="readmark-search-container">
            <input
              id="readmark-search"
              class="readmark-search-input"
              placeholder="Search highlights..."
            />
            <svg class="readmark-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
          </div>

          <div class="readmark-tabs-container">
            <div class="readmark-tabs">
              <button class="readmark-tab active" data-tab="recent">Notes</button>
              <button class="readmark-tab" data-tab="tags">Tags</button>
            </div>
            <div class="readmark-tabs-divider"></div>
            <div class="readmark-stats">
              <div class="readmark-stat">
                <div class="readmark-stat-number" id="readmark-count">0</div>
                <div class="readmark-stat-label">Notes</div>
              </div>
              <div class="readmark-stat">
                <div class="readmark-stat-number" id="readmark-tags-count">0</div>
                <div class="readmark-stat-label">Tags</div>
              </div>
            </div>
          </div>

          <div id="readmark-highlights-list" class="readmark-highlights-grid"></div>
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

const DEFAULT_WIDGET_WIDTH = 480;
const WIDGET_WIDTH_MIN = 320;
const WIDGET_WIDTH_MAX = 720;

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
    safeStorageSet({
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
      safeStorageSet({ readmarkWidgetWidth: w });
    });
  }

  if (toggleBtn && shell) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const minimized = shell.classList.toggle('readmark-minimized');
      applyMinimizedUi(minimized);
      safeStorageSet({ readmarkWidgetMinimized: minimized });
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
      safeStorageSet({ readmarkWidgetMinimized: false });
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
  if (!extensionContextValid()) return;
  const trimmed = (selectedText || '').trim();
  if (!trimmed) return;

  // Remove existing modal if present
  const existing = document.getElementById('readmark-modal-overlay');
  if (existing) existing.remove();

  const selection = window.getSelection();
  let rect = null;
  if (selection && selection.rangeCount > 0) {
    rect = selection.getRangeAt(0).getBoundingClientRect();
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    rect = new DOMRect(
      Math.max(16, window.innerWidth / 2 - 160),
      Math.max(16, window.innerHeight / 3),
      320,
      24
    );
  }

  const overlay = document.createElement('div');
  overlay.id = 'readmark-modal-overlay';
  overlay.className = 'readmark-modal-overlay';

  overlay.innerHTML = `
    <div class="readmark-modal">
      <div class="readmark-modal-title">Save Highlight</div>

      <div class="readmark-modal-text">
        "${trimmed.substring(0, 200)}${trimmed.length > 200 ? '...' : ''}"
      </div>

      <div class="readmark-form-group">
        <label class="readmark-form-label">Your Notes (optional)</label>
        <textarea class="readmark-form-textarea" id="readmark-note-input" style="font-family: inherit;"></textarea>
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
  const rectTop = rect.top;

  modal.style.top = `${top}px`;
  modal.style.left = `${left}px`;

  /* keep inside viewport */
  requestAnimationFrame(() => {
    const mRect = modal.getBoundingClientRect();

    if (mRect.right > window.innerWidth) {
      modal.style.left = `${window.innerWidth - mRect.width - 12}px`;
    }

    if (mRect.bottom > window.innerHeight) {
      modal.style.top = `${window.scrollY + rectTop - mRect.height - 12}px`;
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
     SAVE LOGIC
  ========================= */
  document.getElementById("readmark-save").onclick = () => {
    const note = document.getElementById("readmark-note-input").value.trim();
    const tags = document
      .getElementById("readmark-tags-input")
      .value.split(",")
      .map(t => t.trim())
      .filter(Boolean);

    safeStorageGet(["readmarks"], (res) => {
      const data = res.readmarks || [];

      data.push({
        text: trimmed,
        note,
        tags,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        domain: window.location.hostname
      });

      safeStorageSet({ readmarks: data }, () => {
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
    const noteInput = document.getElementById("readmark-note-input");
    if (noteInput) noteInput.focus();
  }, 0);
}


function setupTabs() {
  const tabs = document.querySelectorAll(".readmark-tab");
  const list = document.getElementById("readmark-highlights-list");

  if (!tabs.length || !list) return;

  const render = (type) => {
    safeStorageGet(["readmarks"], (res) => {
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
    list.innerHTML = `<div class="readmark-no-highlights">No tags yet</div>`;
    return;
  }

  list.innerHTML = tags.map(([tag, count]) => `
    <div class="readmark-highlight-item">
      <div class="readmark-highlight-text">#${tag}</div>
      <div style="font-size:12px; color:#666; margin-top:4px;">${count} highlight(s)</div>
    </div>
  `).join('');
}

function renderHighlights(highlights, list) {
  document.getElementById('readmark-count').textContent = highlights.length;

  if (!highlights.length) {
    list.innerHTML = `<div class="readmark-no-highlights">No highlights yet</div>`;
    return;
  }

  list.innerHTML = highlights
    .slice()
    .reverse()
    .map(h => `
      <div class="readmark-highlight-item">
        <div class="readmark-highlight-text">"${h.text}"</div>
        ${h.note ? `<div class="readmark-highlight-note">${h.note}</div>` : ''}
        ${h.tags && h.tags.length ? `
          <div class="readmark-highlight-tags">
            ${h.tags.map(t => `<span class="readmark-tag">#${t}</span>`).join('')}
          </div>
        ` : ''}
        ${h.timestamp ? `
          <div class="readmark-highlight-date">${new Date(h.timestamp).toLocaleDateString()}</div>
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

    safeStorageGet(["readmarks"], (res) => {
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

function registerReadmarkContentListeners(syncWidgetFromStorage) {
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!extensionContextValid()) return;
      if (msg && msg.type === 'TOGGLE_READMARK') {
        setReadmarkEnabled(!!msg.enabled);
      }
    });
  } catch {
    /* invalidated before listener attached */
  }

  if (syncWidgetFromStorage) {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!extensionContextValid()) return;
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
    } catch {
      /* invalidated */
    }
  } else {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (!extensionContextValid() || areaName !== 'local') return;
        if (changes.readmarkEnabled) {
          setReadmarkEnabled(changes.readmarkEnabled.newValue ?? true);
        }
      });
    } catch {
      /* invalidated */
    }
  }

  // Selection handling - works for both web pages and PDFs
  let selectionTimeout = null;

  function handleTextSelection() {
    if (!readmarkEnabled) return;
    
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim()) return;

    const text = sel.toString().trim();
    if (!text) return;

    // Check if selection is in our UI
    const anchor = sel.anchorNode;
    const focusNode = sel.focusNode;
    const inOurUi = (n) => {
      const el = n && n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
      return !!(el && el.closest && (el.closest('#readmark-widget-container') || el.closest('#readmark-modal-overlay')));
    };
    if (anchor && focusNode && inOurUi(anchor) && inOurUi(focusNode)) return;

    showSaveDialog(text);
  }

  // For regular web pages and PDFs - mouseup is more reliable than pointerup for PDFs
  document.addEventListener('mouseup', () => {
    clearTimeout(selectionTimeout);
    // Small delay to let PDF selections register properly
    selectionTimeout = setTimeout(handleTextSelection, 100);
  }, true);

  // Also listen for keyboard selection (Shift+Arrow keys)
  document.addEventListener('keyup', () => {
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(handleTextSelection, 100);
  }, true);

  // Fallback for pointerup on other devices
  document.addEventListener('pointerup', () => {
    clearTimeout(selectionTimeout);
    selectionTimeout = setTimeout(handleTextSelection, 100);
  }, true);
}

function bootstrapReadmarkContentScript() {
  const isTopFrame = window.self === window.top;

  if (!isTopFrame) {
    safeStorageGet(['readmarkEnabled'], (res) => {
      readmarkEnabled = res.readmarkEnabled ?? true;
    });
    return;
  }

  safeStorageGet(
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
  safeStorageGet(['readmarkEnabled'], (r) => {
    readmarkEnabled = r.readmarkEnabled ?? true;
    if (window.self === window.top) applyWidgetVisibility();
  });
} else {
  globalThis[READMARK_CONTENT_INIT] = true;
  registerReadmarkContentListeners(window.self === window.top);
  bootstrapReadmarkContentScript();
}