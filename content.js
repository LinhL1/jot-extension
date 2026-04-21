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
      (h, idx) => `
        <div class="readmark-highlight-item" data-index="${highlights.length - 1 - idx}">
          <button class="readmark-highlight-delete" data-index="${highlights.length - 1 - idx}" title="Delete">×</button>
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

  // Attach delete handlers
  list.querySelectorAll('.readmark-highlight-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      deleteHighlight(idx);
    };
  });
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

 
    .readmark-content {
      padding: 16px 24px 24px 24px;
      background: #f5f3f0;
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 15px; 
    }

   



    /* ===============================
      TABS CONTAINER - FIXED
    =============================== */

    .readmark-tabs-container {
      display: flex;
      gap: 12px;
      margin-bottom: 0; /* Remove bottom margin */
      align-items: center;
      padding: 8px 0; /* Add some vertical padding */
      border-bottom: 1px solid #e5e5e5; /* Visual separation */
    }

    /* ===============================
      HIGHLIGHTS GRID - FIXED
    =============================== */

    .readmark-highlights-grid {
      padding: 16px 0; /* Adjusted padding */
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      align-items: start;
      flex: 1; /* Allow grid to take available space */
      overflow-y: auto; /* Ensure scrolling works */
    }

    /* ===============================
      WIDGET SHELL - ENSURE PROPER SIZING
    =============================== */

    .readmark-widget {
      --readmark-panel-width: 480px;
      width: var(--readmark-panel-width);
      max-width: min(720px, calc(100vw - 40px));
      background: #f5f3f0;
      border-radius: 0;
      border: 1px solid #ddd;
      box-shadow: 0 12px 32px rgba(0,0,0,0.12);
      overflow: hidden;
      transition: all 0.3s ease;
      display: flex;
      flex-direction: column;
      height: auto; /* Ensure height is auto */
      min-height: 400px; /* Minimum height */
      
    }

    /* ===============================
      PANEL - FIXED
    =============================== */

    .readmark-panel {
      display: flex;
      flex-direction: column;
      max-height: min(90vh, 700px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      flex: 1; /* Make panel take available space */
    }

    /* ===============================
      HEADER - FIXED
    =============================== */

    .readmark-header {
      background: #2a2a2a;
      padding: 16px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
      border-bottom: 1px solid #1a1a1a;
      margin: 0; /* Ensure no margin */
    }

    .readmark-header-logo {
      height: 48px;
      width: auto;
      object-fit: contain;
      flex-shrink: 0;
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
      TAGLINE - FIXED
    =============================== */

    .readmark-tagline {
      color: #666;
      font-size: 13px;
      font-style: italic;
      padding: 24px 20px 16px 32px; /* Even more left padding */
      margin: 0;
      text-align: left;
    }

    /* ===============================
       CONTENT AREA
    =============================== */

    .readmark-content {
      padding: 16px 24px 24px 24px;
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
        position: relative;
        margin: 0; /* Remove margins, flexbox gap handles spacing */
        padding: 0 20px; /* Add horizontal padding */
      }

    .readmark-search-input {
      width: 90%;
      margin-left: auto;
      margin-right: auto;
      display: block;
      padding: 14px 14px 14px 14px;
      border: 1px solid #ddd;
      border-radius: 0;
      font-size: 13px;
      outline: none;
      background: #f5f3f0;
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
      padding: 12px 20px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      align-items: start;
    }

    .readmark-tags-view .readmark-highlights-grid {
      padding: 12px 20px;
      gap: 12px;
    }

    .readmark-highlight-item {
      background: #f8f8f8;
      border: 1px solid #222220;
      border-radius: 0;
      padding: 16px;
      min-height: auto;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      position: relative;
      gap: 8px;
    }

    .readmark-highlight-item:hover {
      border-color: #ccc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }

    .readmark-highlight-text {
      font-size: 13px;
      line-height: 1.4;
      color: #111;
      word-break: break-word;
      padding-right: 20px;
    }

    .readmark-highlight-note {
      font-size: 11px;
      color: #666;
      background: #f9f9f9;
      padding: 8px 10px;
      border-radius: 0;
      border-left: 2px solid #ddd;
      line-height: 1.4;
    }

    .readmark-highlight-tags {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .readmark-tag {
      background: #f0f0f0;
      border: 1px solid #e0e0e0;
      color: #555;
      font-size: 10px;
      padding: 4px 8px;
      border-radius: 0;
      white-space: nowrap;
    }

    .readmark-highlight-date {
      font-size: 9px;
      color: #aaa;
      margin-top: 4px;
    }

    .readmark-highlight-delete {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 20px;
      height: 20px;
      background: transparent;
      border: none;
      color: #999;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      line-height: 1;
      padding: 0;
      flex-shrink: 0;
    }

    .readmark-highlight-delete:hover {
      color: #333;
    }

    .readmark-highlight-item:hover .readmark-highlight-delete {
      opacity: 1;
    }

    .readmark-no-highlights {
      text-align: center;
      padding: 60px 20px;
      color: #999;
    }

    .readmark-tags-view {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .readmark-tags-back {
      padding: 0 4px;
    }

    .readmark-back-btn {
      background: none;
      border: none;
      color: #666;
      cursor: pointer;
      font-size: 13px;
      padding: 8px 0;
      text-decoration: underline;
    }

    .readmark-back-btn:hover {
      color: #111;
    }

    .readmark-tag-item {
      cursor: pointer;
      min-height: 80px;
    }

    .readmark-tag-item:hover {
      border-color: #333;
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
       HIGHLIGHT MODAL - JOT STYLE
    =============================== */

    .jot-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: center;
      pointer-events: auto;
      backdrop-filter: blur(2px);
    }

    .jot-modal {
      background: #f6f4f0;
      border: 1px solid #e5e5e5;
      border-radius: 0;
      padding: 28px;
      max-width: 500px;
      width: 90%;
      position: relative;
      z-index: 2147483648;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 50px rgba(0,0,0,0.15);
      animation: jotSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    @keyframes jotSlideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .jot-modal-title {
      font-weight: 600;
      margin-bottom: 18px;
      font-size: 16px;
      color: #111;
      letter-spacing: -0.3px;
    }

    .jot-modal-text {
      font-size: 14px;
      background: #fff;
      border-left: 3px solid #111;
      padding: 14px 16px;
      margin-bottom: 20px;
      line-height: 1.6;
      word-wrap: break-word;
      word-break: break-word;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      color: #111;
      font-style: italic;
    }

    .jot-form-group {
      margin-bottom: 18px;
    }

    .jot-form-label {
      display: block;
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 500;
    }

    .jot-form-input,
    .jot-form-textarea {
      width: 95%;
      border: 1px solid #e5e5e5;
      padding: 12px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #111;
      background: #fff;
      transition: all 0.15s ease;
    }

    .jot-form-input::placeholder,
    .jot-form-textarea::placeholder {
      color: #bbb;
    }

    .jot-form-textarea {
      resize: vertical;
      min-height: 80px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    .jot-form-input:focus,
    .jot-form-textarea:focus {
      outline: none;
      border-color: #111;
      box-shadow: 0 0 0 3px rgba(17, 17, 17, 0.08);
    }

    .jot-tags-input-container {
      position: relative;
      width: 100%;
    }

    .jot-tags-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #fff;
      border: 1px solid #e5e5e5;
      border-top: none;
      max-height: 150px;
      overflow-y: auto;
      z-index: 1000003;
      display: none;
      margin-top: -1px;
    }

    .jot-tags-dropdown.active {
      display: block;
    }

    .jot-tags-dropdown-item {
      padding: 10px 12px;
      font-size: 13px;
      color: #111;
      cursor: pointer;
      border-bottom: 1px solid #f5f5f5;
      transition: background 0.15s ease;
    }

    .jot-tags-dropdown-item:hover,
    .jot-tags-dropdown-item.highlighted {
      background: #f9f9f9;
    }

    .jot-tags-dropdown-item:last-child {
      border-bottom: none;
    }

    .jot-modal-actions {
      display: flex;
      gap: 12px;
      margin-top: 22px;
    }

    .jot-modal-actions button {
      flex: 1;
      padding: 12px 16px;
      border-radius: 6px;
      border: 1px solid #e5e5e5;
      cursor: pointer;
      font-weight: 500;
      font-size: 13px;
      transition: all 0.15s ease;
      background: #fff;
      color: #111;
    }

    .jot-modal-actions .jot-btn-primary {
      background: #111;
      color: #f6f4f0;
      border: 1px solid #111;
    }

    .jot-modal-actions .jot-btn-primary:hover {
      background: #2b2a2a;
      border-color: #2b2a2a;
    }

    .jot-modal-actions .jot-btn-secondary:hover {
      background: #f9f9f9;
      border-color: #ddd;
    }

    .jot-modal-title {
      cursor: grab;
      user-select: none;
    }

    .jot-modal-title:active {
      cursor: grabbing;
    }

        /* Ensure the highlights list is properly scrollable */
    .readmark-highlights-grid {
      max-height: none; /* Remove any max-height constraints */
    }

    /* Fix for the content area scroll */
    .readmark-content {
      min-height: 0; /* Important for flexbox scrolling */
    }

  `;
  document.head.appendChild(style);

  container.innerHTML = `
    <div class="readmark-widget">
      <div class="readmark-panel">
        <div class="readmark-header">
        <img src="${chrome.runtime.getURL('/logo2.png')}" class="readmark-header-logo" alt="Jot" />
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

function setupTagAutocomplete(tagsInput, availableTags) {
  const container = tagsInput.parentElement;
  let dropdown = container.querySelector('.jot-tags-dropdown');
  
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'jot-tags-dropdown';
    container.appendChild(dropdown);
  }

  let highlightedIndex = -1;

  function updateDropdown() {
    const inputValue = tagsInput.value.toLowerCase();
    const currentTags = inputValue
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    const lastTag = currentTags[currentTags.length - 1] || '';

    const matches = availableTags.filter(tag =>
      tag.toLowerCase().includes(lastTag.toLowerCase()) &&
      !currentTags.includes(tag)
    );

    if (!lastTag || matches.length === 0) {
      dropdown.classList.remove('active');
      return;
    }

    dropdown.innerHTML = matches
      .map((tag, idx) => `
        <div class="jot-tags-dropdown-item" data-index="${idx}">
          #${tag}
        </div>
      `)
      .join('');

    dropdown.classList.add('active');
    highlightedIndex = -1;

    dropdown.querySelectorAll('.jot-tags-dropdown-item').forEach((item, idx) => {
      item.addEventListener('click', () => {
        selectTag(tag = item.textContent.trim().substring(1));
      });
    });
  }

  function selectTag(tag) {
    const currentTags = tagsInput.value
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    
    currentTags[currentTags.length - 1] = tag;
    tagsInput.value = currentTags.join(', ') + ', ';
    dropdown.classList.remove('active');
    tagsInput.focus();
    updateDropdown();
  }

  tagsInput.addEventListener('input', updateDropdown);

  tagsInput.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('active')) return;

    const items = dropdown.querySelectorAll('.jot-tags-dropdown-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightedIndex = Math.max(highlightedIndex - 1, -1);
      updateHighlight(items);
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      const selectedTag = items[highlightedIndex].textContent.trim().substring(1);
      selectTag(selectedTag);
    } else if (e.key === 'Escape') {
      dropdown.classList.remove('active');
    }
  });

  function updateHighlight(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('highlighted', idx === highlightedIndex);
    });
  }
}

function showSaveDialog(selectedText) {
  if (!readmarkEnabled) return;
  if (!extensionContextValid()) return;
  const trimmed = (selectedText || '').trim();
  if (!trimmed) return;

  // Remove existing modal if present
  const existing = document.getElementById('jot-modal-overlay');
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
  overlay.id = 'jot-modal-overlay';
  overlay.className = 'jot-modal-overlay';

  overlay.innerHTML = `
    <div class="jot-modal">
      <div class="jot-modal-title">Save Highlight</div>

      <div class="jot-modal-text">"${trimmed.substring(0, 300)}${trimmed.length > 300 ? '...' : ''}"</div>

      <div class="jot-form-group">
        <label class="jot-form-label">Your Notes (optional)</label>
        <textarea class="jot-form-textarea" id="jot-note-input" placeholder="Add your thoughts or context..."></textarea>
      </div>

      <div class="jot-form-group">
        <label class="jot-form-label">Tags</label>
        <div class="jot-tags-input-container">
          <input class="jot-form-input" id="jot-tags-input" placeholder="e.g. learning, idea (separate with commas)" />
        </div>
      </div>

      <div class="jot-modal-actions">
        <button class="jot-btn-secondary" id="jot-cancel">Cancel</button>
        <button class="jot-btn-primary" id="jot-save">Save</button>
      </div>
    </div>
  `;

  // Ensure overlay is added to body and not affected by page styles
  const htmlElement = document.documentElement;
  htmlElement.appendChild(overlay);

  const modal = overlay.querySelector(".jot-modal");
  const title = overlay.querySelector(".jot-modal-title");

  // Style overlay to be truly on top
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    z-index: 2147483647;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  `;

  // Reset modal positioning to center by default
  modal.style.cssText = `
    position: fixed;
    z-index: 2147483648;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  `;

  /* =========================
     DRAGGING (CENTERED, THEN FREE)
  ========================= */
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;
  let dragStarted = false;

  title.style.cursor = "grab";

  title.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStarted = true;

    const rect = modal.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    modal.style.position = "fixed";
    modal.style.zIndex = "2147483648";
    modal.style.transform = "none";

    document.body.style.userSelect = "none";
    title.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    if (dragStarted) {
      modal.style.left = `${e.clientX - offsetX}px`;
      modal.style.top = `${e.clientY - offsetY}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.userSelect = "auto";
      title.style.cursor = "grab";
    }
  });

  /* =========================
     SETUP TAG AUTOCOMPLETE
  ========================= */
  safeStorageGet(['readmarks'], (res) => {
    const highlights = res.readmarks || [];
    const allTags = new Set();
    highlights.forEach(h => {
      (h.tags || []).forEach(t => allTags.add(t));
    });
    const availableTags = Array.from(allTags).sort();
    const tagsInput = document.getElementById('jot-tags-input');
    if (tagsInput) {
      setupTagAutocomplete(tagsInput, availableTags);
    }
  });

  /* =========================
     SAVE LOGIC
  ========================= */
  document.getElementById("jot-save").onclick = () => {
    const note = document.getElementById("jot-note-input").value.trim();
    const tags = document
      .getElementById("jot-tags-input")
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
          border-radius: 6px;
          z-index: 1000000;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        `;

        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      });
    });
  };

  document.getElementById("jot-cancel").onclick = () => {
    overlay.remove();
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  setTimeout(() => {
    const noteInput = document.getElementById("jot-note-input");
    if (noteInput) noteInput.focus();
  }, 0);
}


function setupTabs() {
  const tabs = document.querySelectorAll(".readmark-tab");
  const list = document.getElementById("readmark-highlights-list");

  if (!tabs.length || !list) return;

  const render = (type) => {
    window.__readmarkSelectedTag = null;
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

function renderTagsView(highlights, list, selectedTag = null) {
  const tagMap = {};

  highlights.forEach(h => {
    (h.tags || []).forEach(tag => {
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    });
  });

  const tags = Object.entries(tagMap);

  // If a tag is selected, show highlights for that tag
  if (selectedTag) {
    const filtered = highlights.filter(h => (h.tags || []).includes(selectedTag));
    list.innerHTML = `
      <div class="readmark-tags-view">
        <div class="readmark-tags-back">
          <button class="readmark-back-btn" id="readmark-back-btn">← Back to tags</button>
        </div>
        <div class="readmark-highlights-grid">
          ${filtered.map((h, idx) => {
            const origIdx = highlights.indexOf(h);
            return `
              <div class="readmark-highlight-item" data-index="${origIdx}">
                <button class="readmark-highlight-delete" data-index="${origIdx}" title="Delete">×</button>
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
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach back button handler
    const backBtn = document.getElementById('readmark-back-btn');
    if (backBtn) {
      backBtn.onclick = () => {
        renderTagsView(highlights, list, null);
      };
    }

    // Attach delete handlers
    list.querySelectorAll('.readmark-highlight-delete').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        deleteHighlight(idx);
      };
    });
    return;
  }

  if (!tags.length) {
    list.innerHTML = `<div class="readmark-no-highlights">No tags yet</div>`;
    return;
  }

  list.innerHTML = tags.map(([tag, count]) => `
    <div class="readmark-highlight-item readmark-tag-item" data-tag="${tag}">
      <div class="readmark-highlight-text">#${tag}</div>
      <div style="font-size:12px; color:#666; margin-top:4px;">${count} highlight(s)</div>
    </div>
  `).join('');

  // Attach click handlers for tag items
  list.querySelectorAll('.readmark-tag-item').forEach(item => {
    item.onclick = () => {
      const tag = item.dataset.tag;
      window.__readmarkSelectedTag = tag;
      renderTagsView(highlights, list, tag);
    };
  });

  window.__readmarkShowTags = () => {
    window.__readmarkSelectedTag = null;
    renderTagsView(highlights, list, null);
  };
}

function deleteHighlight(index) {
  safeStorageGet(['readmarks'], (res) => {
    const highlights = res.readmarks || [];
    highlights.splice(index, 1);
    safeStorageSet({ readmarks: highlights }, () => {
      refreshHighlightsFromStorage();
    });
  });
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
    .map((h, idx) => `
      <div class="readmark-highlight-item" data-index="${highlights.length - 1 - idx}">
        <button class="readmark-highlight-delete" data-index="${highlights.length - 1 - idx}" title="Delete">×</button>
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

  // Attach delete handlers
  list.querySelectorAll('.readmark-highlight-delete').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      deleteHighlight(idx);
    };
  });
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
      return !!(el && el.closest && (el.closest('#readmark-widget-container') || el.closest('#jot-modal-overlay')));
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

if (window.__READMARK_LOADED__) {
  console.log("⚠️ Readmark already initialized");
} else {
  window.__READMARK_LOADED__ = true;

  registerReadmarkContentListeners(window.self === window.top);
  bootstrapReadmarkContentScript();
}