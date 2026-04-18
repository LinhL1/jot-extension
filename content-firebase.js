// Content script that runs on web pages
console.log('ReadMark content script loaded');

// IMPORTANT: Replace with YOUR Firebase config from Firebase Console
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase (will be loaded from CDN)
let db, auth;

// Load Firebase from CDN
function initializeFirebase() {
  if (!window.firebase) {
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js';
    script.onload = () => {
      const script2 = document.createElement('script');
      script2.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js';
      script2.onload = () => {
        const script3 = document.createElement('script');
        script3.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js';
        script3.onload = () => {
          try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.firestore();
            auth = firebase.auth();
            console.log('Firebase initialized!');
          } catch (e) {
            console.log('Firebase config not set - using local storage only');
          }
        };
        document.head.appendChild(script3);
      };
      document.head.appendChild(script2);
    };
    document.head.appendChild(script);
  }
}

// Initialize Firebase on load
initializeFirebase();

// Inject the floating widget into the page
function injectWidget() {
  // Check if widget already exists
  if (document.getElementById('readmark-widget-container')) {
    return;
  }

  // Create widget container
  const container = document.createElement('div');
  container.id = 'readmark-widget-container';
  container.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
  `;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = `
    #readmark-widget-container * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    .readmark-widget {
      width: 480px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
      transition: width 0.3s ease;
    }

    .readmark-widget.size-small {
      width: 320px;
    }

    .readmark-widget.size-medium {
      width: 420px;
    }

    .readmark-widget.size-large {
      width: 520px;
    }

    .readmark-header {
      background: rgba(0, 0, 0, 0.2);
      padding: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
    }

    .readmark-title {
      color: white;
      font-weight: 600;
      font-size: 14px;
      letter-spacing: 0.5px;
    }

    .readmark-toggle {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.2s ease;
    }

    .readmark-toggle:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
    }

    .readmark-size-btn {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .readmark-size-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .readmark-size-btn.active {
      background: rgba(255, 255, 255, 0.4);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
    }

    .readmark-sync-status {
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.8);
      text-align: center;
      margin-bottom: 8px;
    }

    .readmark-sync-status.synced {
      background: rgba(76, 175, 80, 0.3);
      color: #4caf50;
    }

    .readmark-sync-status.syncing {
      background: rgba(255, 193, 7, 0.3);
      color: #ffc107;
    }

    .readmark-content {
      padding: 14px;
      background: #f6f4f0;
      max-height: 500px;
      overflow-y: auto;
    }

    .readmark-content::-webkit-scrollbar {
      width: 6px;
    }

    .readmark-content::-webkit-scrollbar-track {
      background: transparent;
    }

    .readmark-content::-webkit-scrollbar-thumb {
      background: #667eea;
      border-radius: 3px;
    }

    .readmark-stats {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #f0f0f0;
    }

    .readmark-stat {
      flex: 1;
      text-align: center;
    }

    .readmark-stat-number {
      font-size: 20px;
      font-weight: 700;
      color: #667eea;
      display: block;
    }

    .readmark-stat-label {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    .readmark-tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      border-bottom: 2px solid #f0f0f0;
    }

    .readmark-tab {
      padding: 8px 12px;
      background: none;
      border: none;
      font-size: 13px;
      font-weight: 500;
      color: #999;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.2s ease;
    }

    .readmark-tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
    }

    .readmark-tab:hover {
      color: #667eea;
    }

    .readmark-highlight-item {
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 12px;
  padding: 14px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}

.readmark-highlight-item:hover {
  box-shadow: 0 4px 14px rgba(0,0,0,0.06);
  transform: translateY(-1px);
}

.readmark-highlight-text {
  border-left: 3px solid #111;
  padding-left: 10px;
}

    .readmark-highlight-note {
      color: #666;
      font-size: 12px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e0e0e0;
    }

    .readmark-highlight-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .readmark-tag {
      display: inline-block;
      padding: 4px 8px;
      background: #667eea;
      color: white;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }

    .readmark-empty {
      text-align: center;
      padding: 32px 16px;
      color: #999;
    }

    .readmark-empty-icon {
      font-size: 32px;
      margin-bottom: 12px;
    }

    .readmark-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f0f0f0;
    }

    .readmark-btn {
      flex: 1;
      padding: 10px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .readmark-btn-primary {
      background: #667eea;
      color: white;
    }

    .readmark-btn-primary:hover {
      background: #5568d3;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    .readmark-btn-secondary {
      background: #f0f0f0;
      color: #333;
    }

    .readmark-btn-secondary:hover {
      background: #e0e0e0;
    }

    .readmark-search {
      width: 100%;
      padding: 10px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 12px;
    }

    .readmark-search:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .readmark-minimized {
      width: auto;
    }

    .readmark-minimized .readmark-content,
    .readmark-minimized .readmark-actions {
      display: none;
    }

    .readmark-minimized .readmark-header {
      border-radius: 16px;
    }

    .highlight-selection {
      background-color: rgba(102, 126, 234, 0.3);
      transition: background-color 0.2s ease;
    }

    .readmark-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000000;
    }

    .readmark-modal {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 500px;
      width: 90%;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
    }

    .readmark-modal-title {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 16px;
      color: #333;
     
    }

    .readmark-modal-text {
      font-size: 14px;
      line-height: 1.6;
      color: #666;
      margin-bottom: 24px;
      word-break: break-word;
      padding: 12px;
      background: #f9f9f9;
      border-radius: 8px;
      border-left: 3px solid #667eea;
    }

    .readmark-form-group {
      margin-bottom: 16px;
    }

    .readmark-form-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
    }

    .readmark-form-input,
    .readmark-form-textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 13px;
      color: #999;
    }

    .readmark-form-textarea {
      resize: vertical;
      min-height: 80px;
    }

    .readmark-form-input:focus,
    .readmark-form-textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .readmark-modal-actions {
      display: flex;
      gap: 12px;
    }

    .readmark-modal-actions button {
      flex: 1;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 13px;
    }

    .readmark-modal-actions .readmark-btn-primary {
      background: #667eea;
      color: white;
    }

    .readmark-modal-actions .readmark-btn-primary:hover {
      background: #5568d3;
    }

    .readmark-modal-actions .readmark-btn-secondary {
      background: #f0f0f0;
      color: #333;
    }

    .readmark-modal-actions .readmark-btn-secondary:hover {
      background: #e0e0e0;
    }
  `;
  document.head.appendChild(style);

  // Create initial widget HTML
  container.innerHTML = `
    <div class="readmark-widget">
      <div class="readmark-header">
        <div class="readmark-title">📖 ReadMark</div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button class="readmark-size-btn" data-size="small" title="Small">S</button>
          <button class="readmark-size-btn active" data-size="medium" title="Medium">M</button>
          <button class="readmark-size-btn" data-size="large" title="Large">L</button>
          <button class="readmark-toggle" data-action="toggle" title="Minimize">−</button>
        </div>
      </div>
      <div class="readmark-content">
        <div class="readmark-sync-status" id="readmark-sync-status" style="display: none;">
          ☁️ Syncing...
        </div>

        <div class="readmark-stats">
          <div class="readmark-stat">
            <span class="readmark-stat-number" id="readmark-count">0</span>
            <span class="readmark-stat-label">Highlights</span>
          </div>
          <div class="readmark-stat">
            <span class="readmark-stat-number" id="readmark-tags-count">0</span>
            <span class="readmark-stat-label">Tags</span>
          </div>
        </div>
        
        <div class="readmark-tabs">
          <button class="readmark-tab active" data-tab="recent">Recent</button>
          <button class="readmark-tab" data-tab="search">Search</button>
          <button class="readmark-tab" data-tab="tags">Tags</button>
        </div>

        <div id="readmark-recent-tab" class="readmark-tab-content">
          <input type="text" class="readmark-search" id="readmark-search" placeholder="Search highlights..." style="display: none;">
          <div id="readmark-highlights-list"></div>
        </div>

        <div id="readmark-search-tab" class="readmark-tab-content" style="display: none;">
          <input type="text" class="readmark-search" id="readmark-search-input" placeholder="Search your highlights...">
          <div id="readmark-search-results"></div>
        </div>

        <div id="readmark-tags-tab" class="readmark-tab-content" style="display: none;">
          <div id="readmark-tags-list"></div>
        </div>

        <div class="readmark-actions">
          <button class="readmark-btn readmark-btn-secondary" data-action="clear">Clear All</button>
          <button class="readmark-btn readmark-btn-primary" data-action="export">Export</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  // Setup event listeners
  setupWidgetEvents();
  loadAndDisplayHighlights();

  // Make widget draggable
  makeWidgetDraggable();

  // Load saved size preference
  chrome.storage.local.get(['readmarkSize'], function(result) {
    if (result.readmarkSize && result.readmarkSize !== 'medium') {
      const readmarkWidget = document.querySelector('.readmark-widget');
      readmarkWidget.classList.add(`size-${result.readmarkSize}`);
      
      const sizeBtn = document.querySelector(`[data-size="${result.readmarkSize}"]`);
      if (sizeBtn) {
        document.querySelectorAll('.readmark-size-btn').forEach(b => b.classList.remove('active'));
        sizeBtn.classList.add('active');
      }
    }
  });
}

function setupWidgetEvents() {
  const widget = document.getElementById('readmark-widget-container');
  
  // Size control buttons
  widget.querySelectorAll('.readmark-size-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const size = this.dataset.size;
      const readmarkWidget = widget.querySelector('.readmark-widget');
      
      // Remove all size classes
      readmarkWidget.classList.remove('size-small', 'size-medium', 'size-large');
      
      // Add new size class (if not medium, which is default)
      if (size !== 'medium') {
        readmarkWidget.classList.add(`size-${size}`);
      }
      
      // Update active button
      widget.querySelectorAll('.readmark-size-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      // Save preference
      chrome.storage.local.set({ readmarkSize: size });
    });
  });
  
  // Tab switching
  widget.querySelectorAll('.readmark-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      const tabName = this.dataset.tab;
      
      widget.querySelectorAll('.readmark-tab').forEach(t => t.classList.remove('active'));
      widget.querySelectorAll('.readmark-tab-content').forEach(c => c.style.display = 'none');
      
      this.classList.add('active');
      const contentId = `readmark-${tabName}-tab`;
      document.getElementById(contentId).style.display = 'block';

      if (tabName === 'search') {
        setTimeout(() => document.getElementById('readmark-search-input').focus(), 0);
      }
    });
  });

  // Search functionality
  document.getElementById('readmark-search-input').addEventListener('input', function(e) {
    searchHighlights(e.target.value);
  });

  // Action buttons
  widget.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', function() {
      const action = this.dataset.action;
      
      if (action === 'toggle') {
        widget.querySelector('.readmark-widget').classList.toggle('readmark-minimized');
        this.textContent = widget.querySelector('.readmark-widget').classList.contains('readmark-minimized') ? '+' : '−';
      } else if (action === 'clear') {
        if (confirm('Are you sure you want to clear all highlights? This cannot be undone.')) {
          chrome.storage.local.set({ readmarks: [] });
          if (db && auth.currentUser) {
            db.collection('users').doc(auth.currentUser.uid).collection('highlights').get()
              .then(snapshot => {
                snapshot.forEach(doc => doc.ref.delete());
              });
          }
          loadAndDisplayHighlights();
        }
      } else if (action === 'export') {
        exportHighlights();
      }
    });
  });
}

function makeWidgetDraggable() {
  const container = document.getElementById('readmark-widget-container');
  const header = container.querySelector('.readmark-header');
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

  header.addEventListener('mousedown', dragMouseDown);

  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.addEventListener('mousemove', elementDrag);
    document.addEventListener('mouseup', closeDragElement);
  }

  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    container.style.bottom = (container.offsetParent.offsetHeight - container.offsetTop - pos2) + 'px';
    container.style.right = (container.offsetParent.offsetWidth - container.offsetLeft - pos1) + 'px';
  }

  function closeDragElement() {
    document.removeEventListener('mousemove', elementDrag);
    document.removeEventListener('mouseup', closeDragElement);
  }
}

function loadAndDisplayHighlights() {
  // Load from both local storage and Firebase
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];
    const widget = document.getElementById('readmark-widget-container');
    
    if (!widget) return;

    document.getElementById('readmark-count').textContent = highlights.length;
    
    // Get unique tags
    const allTags = new Set();
    highlights.forEach(h => {
      if (h.tags) {
        h.tags.forEach(tag => allTags.add(tag));
      }
    });
    document.getElementById('readmark-tags-count').textContent = allTags.size;

    // Display recent highlights
    const list = document.getElementById('readmark-highlights-list');
    if (highlights.length === 0) {
      list.innerHTML = '<div class="readmark-empty"><div class="readmark-empty-icon"></div><p>Highlight text on any page to get started!</p></div>';
    } else {
      list.innerHTML = highlights.slice().reverse().map((h, idx) => `
        <div class="readmark-highlight-item">
          <div class="readmark-highlight-text">"${h.text}"</div>
          ${h.note ? `<div class="readmark-highlight-note"><strong>Note:</strong> ${h.note}</div>` : ''}
          ${h.tags && h.tags.length > 0 ? `
            <div class="readmark-highlight-tags">
              ${h.tags.map(tag => `<span class="readmark-tag">${tag}</span>`).join('')}
            </div>
          ` : ''}
          <div style="font-size: 11px; color: #aaa; margin-top: 8px;">
            ${new Date(h.timestamp).toLocaleDateString()} ${new Date(h.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
          </div>
        </div>
      `).join('');
    }

    // Display tags
    const tagsList = document.getElementById('readmark-tags-list');
    if (allTags.size === 0) {
      tagsList.innerHTML = '<div class="readmark-empty"><p>No tags yet. Add tags when saving highlights!</p></div>';
    } else {
      tagsList.innerHTML = Array.from(allTags).map(tag => {
        const count = highlights.filter(h => h.tags && h.tags.includes(tag)).length;
        return `
          <div class="readmark-highlight-item" style="cursor: pointer;">
            <strong>${tag}</strong> <span style="color: #667eea; font-weight: 600;">${count}</span>
          </div>
        `;
      }).join('');
    }
  });
}

function searchHighlights(query) {
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];
    const results = highlights.filter(h => 
      h.text.toLowerCase().includes(query.toLowerCase()) ||
      (h.note && h.note.toLowerCase().includes(query.toLowerCase())) ||
      (h.tags && h.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase())))
    );

    const resultsDiv = document.getElementById('readmark-search-results');
    if (results.length === 0) {
      resultsDiv.innerHTML = '<div class="readmark-empty"><p>No highlights found</p></div>';
    } else {
      resultsDiv.innerHTML = results.map(h => `
        <div class="readmark-highlight-item">
          <div class="readmark-highlight-text">"${h.text}"</div>
          ${h.note ? `<div class="readmark-highlight-note"><strong>Note:</strong> ${h.note}</div>` : ''}
          ${h.tags && h.tags.length > 0 ? `
            <div class="readmark-highlight-tags">
              ${h.tags.map(tag => `<span class="readmark-tag">${tag}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `).join('');
    }
  });
}

function exportHighlights() {
  chrome.storage.local.get(['readmarks'], function(result) {
    const highlights = result.readmarks || [];
    const dataStr = JSON.stringify(highlights, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `readmarks-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  });
}

// Sync highlight to Firebase
function syncHighlightToFirebase(highlight) {
  if (!db || !auth.currentUser) {
    console.log('Firebase not ready or user not signed in');
    return;
  }

  const syncStatus = document.getElementById('readmark-sync-status');
  if (syncStatus) {
    syncStatus.style.display = 'block';
    syncStatus.className = 'readmark-sync-status syncing';
    syncStatus.textContent = '☁️ Syncing...';
  }

  db.collection('users').doc(auth.currentUser.uid).collection('highlights').add({
    ...highlight,
    syncedAt: new Date()
  }).then(() => {
    if (syncStatus) {
      syncStatus.className = 'readmark-sync-status synced';
      syncStatus.textContent = '✓ Synced to cloud!';
      setTimeout(() => { syncStatus.style.display = 'none'; }, 3000);
    }
  }).catch(error => {
    console.error('Sync error:', error);
    if (syncStatus) {
      syncStatus.className = 'readmark-sync-status';
      syncStatus.textContent = '⚠️ Sync failed (check console)';
    }
  });
}

// Listen for text selection and show save dialog
document.addEventListener('mouseup', function() {
  const selectedText = window.getSelection().toString().trim();
  
  if (selectedText.length > 0) {
    showSaveDialog(selectedText);
  }
});

function showSaveDialog(selectedText) {
  // Remove existing modal if present
  const existing = document.getElementById('readmark-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'readmark-modal-overlay';
  overlay.className = 'readmark-modal-overlay';
  overlay.innerHTML = `
    <div class="readmark-modal">
      <div class="readmark-modal-title">Save Highlight</div>
      <div class="readmark-modal-text">"${selectedText.substring(0, 200)}${selectedText.length > 200 ? '...' : ''}"</div>
      
      <div class="readmark-form-group">
        <label class="readmark-form-label">Your Notes (optional)</label>
        <textarea class="readmark-form-textarea" id="readmark-note-input" placeholder="Add your thoughts, connections, or reflections..."></textarea>
      </div>

      <div class="readmark-form-group">
        <label class="readmark-form-label">Tags (comma-separated)</label>
        <input type="text" class="readmark-form-input" id="readmark-tags-input" placeholder="e.g., psychology, learning, review">
      </div>

      <div class="readmark-modal-actions">
        <button class="readmark-btn readmark-btn-secondary" id="readmark-cancel">Cancel</button>
        <button class="readmark-btn readmark-btn-primary" id="readmark-save">Save Highlight</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('readmark-save').addEventListener('click', function() {
    const note = document.getElementById('readmark-note-input').value;
    const tagsInput = document.getElementById('readmark-tags-input').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);

    const highlightData = {
      text: selectedText,
      note: note,
      tags: tags,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      domain: window.location.hostname
    };

    // Save to local storage
    chrome.storage.local.get(['readmarks'], function(result) {
      const highlights = result.readmarks || [];
      highlights.push(highlightData);

      chrome.storage.local.set({ readmarks: highlights }, function() {
        overlay.remove();
        loadAndDisplayHighlights();
        
        // Try to sync to Firebase
        syncHighlightToFirebase(highlightData);
        
        // Show confirmation
        const toast = document.createElement('div');
        toast.style.cssText = `
          position: fixed;
          bottom: 100px;
          right: 20px;
          background: #667eea;
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          z-index: 1000000;
          animation: slideIn 0.3s ease;
        `;
        toast.textContent = '✓ Highlight saved!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      });
    });
  });

  document.getElementById('readmark-cancel').addEventListener('click', function() {
    overlay.remove();
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  // Focus on notes input
  setTimeout(() => document.getElementById('readmark-note-input').focus(), 0);
}

// Inject widget when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectWidget);
} else {
  injectWidget();
}

// Add animation styles
const animStyle = document.createElement('style');
animStyle.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(400px);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
`;
document.head.appendChild(animStyle);