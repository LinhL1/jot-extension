//Main Brain - board view 

// Global variables
let notes = [];
let connections = [];
let activeCard = null;
let isDragging = false;
let isDraggingBoard = false;
let isSpacePanning = false;
let dragOffset = { x: 0, y: 0 };
let boardDragStart = { x: 0, y: 0 };
let connectingFrom = null;
let currentEditId = null;
let boardOffset = { x: 0, y: 0 };
let scale = 1;
let _saveSettingsTimer = null;

// Multi-board state — set by loadBoardIntoCanvas before any canvas renders.
let currentBoardId = null;
let currentBoardIsLegacy = false;

// Tracks note IDs whose AI tagging is in flight so cards can show a loading pill.
const _taggingInProgress = new Set();

// Drawing mode variables
let isDrawing = false;
let isDrawMode = false;
let isViewMode = true;
let drawColor = '#111111';
let drawSize = 2;
let lastX = 0;
let lastY = 0;

// Vector stroke storage — each stroke: { color, size, points: [{x,y}] } in board space
let strokes = [];
let currentStroke = null;

// Render all strokes onto the drawing canvas using the current board transform.
// Called on every pan/zoom so doodles move and scale with the board.
function renderStrokes() {
    const canvas = document.getElementById('drawing-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const all = currentStroke ? [...strokes, currentStroke] : strokes;
    for (const stroke of all) {
        if (!stroke.points || stroke.points.length < 2) continue;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.size * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(
            stroke.points[0].x * scale + boardOffset.x,
            stroke.points[0].y * scale + boardOffset.y
        );
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(
                stroke.points[i].x * scale + boardOffset.x,
                stroke.points[i].y * scale + boardOffset.y
            );
        }
        ctx.stroke();
    }
}

// Load data from storage — now multi-board aware.
function loadData() {
    migrateNotesToUniqueIds();

    JotBoardStorage.ensureBoardsInitialized(function (boards, activeId) {
        loadBoardIntoCanvas(activeId, function () {
            init();
            setupLiveHighlightSync();
        });
    });
}

// Populate all canvas globals from storage for the given board, then call onLoaded.
// Also sets currentBoardId and currentBoardIsLegacy.
function loadBoardIntoCanvas(boardId, onLoaded) {
    JotBoardStorage.loadBoardData(boardId, function (data) {
        currentBoardId = boardId;
        currentBoardIsLegacy = !!data.legacy;

        connections = data.connections || [];
        strokes = data.strokes || [];
        currentStroke = null;
        _taggingInProgress.clear();

        if (data.viewSettings) {
            boardOffset = data.viewSettings.boardOffset || { x: 0, y: 0 };
            scale = data.viewSettings.scale || 1;
        } else {
            boardOffset = { x: 0, y: 0 };
            scale = 1;
        }

        const highlights = data.highlights || [];
        notes = highlights.map(function (h, index) {
            let noteId = h.id;
            if (!noteId) {
                const textHash = hashString(h.text).substring(0, 8);
                const timeStamp = h.timestamp ? new Date(h.timestamp).getTime() : Date.now();
                const randomSuffix = Math.random().toString(36).substring(2, 8);
                noteId = `note_${textHash}_${timeStamp}_${index}_${randomSuffix}`;
            }
            noteId = String(noteId);
            return {
                id: noteId,
                text: h.text,
                note: h.note,
                tags: h.tags || [],
                url: h.url,
                timestamp: h.timestamp,
                x: typeof h.x === 'number' ? h.x : Math.random() * 300,
                y: typeof h.y === 'number' ? h.y : Math.random() * 200,
                color: h.color || '#ffffff',
                aiCategory: h.aiCategory || null,
                aiTags: h.aiTags || null
            };
        });

        if (typeof onLoaded === 'function') onLoaded();
    });
}

// One-time setup: live-sync new highlights into the active board when content.js
// captures something. Legacy board captures land in the flat readmarks/* keys;
// non-legacy board captures land in jotBoardData[boardId].highlights. Without the
// non-legacy branch, a capture to the open board would be lost on the next
// saveToStorage() snapshot, which only knows about in-memory notes.
function setupLiveHighlightSync() {
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;

        if (currentBoardIsLegacy) {
            if (!changes.readmarks && !changes.readmarkConnections) return;
            chrome.storage.local.get(['readmarks', 'readmarkConnections'], function (result) {
                _syncBoardFromStorage(result.readmarks || [], result.readmarkConnections || []);
            });
            return;
        }

        if (!changes.jotBoardData) return;
        const all = changes.jotBoardData.newValue || {};
        const data = all[currentBoardId];
        if (!data) return;
        _syncBoardFromStorage(data.highlights || [], data.connections || []);
    });
}

// Merge a storage snapshot of the active board into the in-memory notes array:
// adds highlights we don't have yet, drops ones deleted elsewhere, and queues
// brand-new ones for AI tagging. Idempotent — echoes of this tab's own
// saveToStorage() writes produce no changes and no re-render.
function _syncBoardFromStorage(highlights, conns) {
    connections = conns;

    const existingIds = new Set(notes.map(n => String(n.id)));
    const newNotesForTagging = [];
    let changed = false;

    highlights.forEach(function (h) {
        const hId = String(h.id || '');
        if (!hId || existingIds.has(hId)) return;
        const position = getNonOverlappingPosition();
        const newNote = {
            id: hId,
            text: h.text,
            note: h.note,
            tags: h.tags || [],
            url: h.url,
            timestamp: h.timestamp,
            x: typeof h.x === 'number' ? h.x : position.x,
            y: typeof h.y === 'number' ? h.y : position.y,
            color: h.color || '#ffffff',
            aiCategory: h.aiCategory || null,
            aiTags: h.aiTags || null
        };
        notes.push(newNote);
        changed = true;
        if (!newNote.aiCategory && !newNote.aiTags) {
            newNotesForTagging.push(newNote);
        }
    });

    const storageIds = new Set(highlights.map(h => String(h.id || '')));
    const lengthBefore = notes.length;
    notes = notes.filter(n => storageIds.has(String(n.id)));
    if (notes.length !== lengthBefore) changed = true;

    if (changed) {
        renderNotes();
        updateEmptyState();
    }
    newNotesForTagging.forEach(_tagNote);
}

// Simple hash function to create consistent hashes from text
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
}

// Migration function to regenerate IDs for existing notes
function migrateNotesToUniqueIds() {
    console.log('Checking if note IDs need migration...');
    
    chrome.storage.local.get(['readmarks', 'noteIdMigrationDone'], function(result) {
        const highlights = result.readmarks || [];
        const migrationDone = result.noteIdMigrationDone || false;
        
        // Only migrate once
        if (migrationDone) {
            console.log('Migration already completed');
            return;
        }
        
        // Check if any notes lack proper unique IDs (old format)
        const needsMigration = highlights.some(h => {
            return !h.id || (typeof h.id === 'number') || (String(h.id).length < 10);
        });
        
        if (!needsMigration) {
            console.log('No migration needed - notes already have proper IDs');
            chrome.storage.local.set({ noteIdMigrationDone: true });
            return;
        }
        
        console.log('Migrating', highlights.length, 'notes to new ID format...');
        
        // Regenerate IDs for all notes
        const migratedHighlights = highlights.map((h, index) => {
            const textHash = hashString(h.text).substring(0, 8);
            const timeStamp = h.timestamp ? new Date(h.timestamp).getTime() : Date.now();
            const randomSuffix = Math.random().toString(36).substring(2, 8);
            const newId = `note_${textHash}_${timeStamp}_${index}_${randomSuffix}`;
            
            console.log(`Migrated note ${index}: "${h.text.substring(0, 30)}..." -> ID: ${newId}`);
            
            return {
                ...h,
                id: newId
            };
        });
        
        // Also need to update connections to use new IDs
        chrome.storage.local.get('readmarkConnections', function(connResult) {
            const oldConnections = connResult.readmarkConnections || [];
            
            // Create a map of old IDs to new IDs
            const idMap = {};
            highlights.forEach((h, index) => {
                const textHash = hashString(h.text).substring(0, 8);
                const timeStamp = h.timestamp ? new Date(h.timestamp).getTime() : Date.now();
                const randomSuffix = Math.random().toString(36).substring(2, 8);
                const newId = `note_${textHash}_${timeStamp}_${index}_${randomSuffix}`;
                idMap[String(h.id)] = newId;
            });
            
            // Update connections with new IDs
            const newConnections = oldConnections.map(conn => ({
                from: idMap[String(conn.from)] || conn.from,
                to: idMap[String(conn.to)] || conn.to
            }));
            
            // Save migrated data
            chrome.storage.local.set({
                readmarks: migratedHighlights,
                readmarkConnections: newConnections,
                noteIdMigrationDone: true
            }, function() {
                console.log('Migration complete! Notes and connections updated.');
                console.log('Please reload the page to see the changes.');
            });
        });
    });
}

// Save the active board's data to storage via the central utility.
function saveToStorage() {
    if (!currentBoardId) return;

    const highlights = notes.map(note => ({
        id: note.id,
        text: note.text,
        note: note.note,
        tags: note.tags,
        url: note.url,
        timestamp: note.timestamp,
        x: note.x,
        y: note.y,
        color: note.color || '#ffffff',
        aiCategory: note.aiCategory || null,
        aiTags: note.aiTags || null
    }));

    JotBoardStorage.saveBoardData(
        currentBoardId,
        {
            highlights,
            connections,
            viewSettings: { boardOffset, scale },
            strokes
        },
        currentBoardIsLegacy
    );
}

// ==================== DRAWING SYSTEM ====================
function initializeDrawing() {
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (!drawingCanvas) return;
    
    const ctx = drawingCanvas.getContext('2d');
    resizeDrawingCanvas();
    
    const container = drawingCanvas.closest('.canvas-container');

    function pointerToBoardSpace(clientX, clientY) {
        const rect = container.getBoundingClientRect();
        return {
            x: (clientX - rect.left - boardOffset.x) / scale,
            y: (clientY - rect.top  - boardOffset.y) / scale
        };
    }

    function boardToCanvas(bx, by) {
        return { x: bx * scale + boardOffset.x, y: by * scale + boardOffset.y };
    }

    // Drawing event listeners
    drawingCanvas.addEventListener('mousedown', (e) => {
        if (!isDrawMode) return;
        isDrawing = true;
        const bp = pointerToBoardSpace(e.clientX, e.clientY);
        currentStroke = { color: drawColor, size: drawSize, points: [bp] };
        lastX = bp.x;
        lastY = bp.y;
    });

    drawingCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isDrawMode) return;
        const bp = pointerToBoardSpace(e.clientX, e.clientY);
        currentStroke.points.push(bp);

        // Incremental draw — only add the newest segment, no full re-render needed
        const prev = boardToCanvas(lastX, lastY);
        const curr = boardToCanvas(bp.x, bp.y);
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = drawSize * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();

        lastX = bp.x;
        lastY = bp.y;
    });

    function finishStroke() {
        if (isDrawing && currentStroke && currentStroke.points.length > 1) {
            strokes.push(currentStroke);
            saveToStorage();
        }
        currentStroke = null;
        isDrawing = false;
    }

    drawingCanvas.addEventListener('mouseup', finishStroke);
    drawingCanvas.addEventListener('mouseleave', finishStroke);

    window.addEventListener('resize', resizeDrawingCanvas);

    setupDrawingControls();
}

function resizeDrawingCanvas() {
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (!drawingCanvas) return;
    drawingCanvas.width = drawingCanvas.offsetWidth;
    drawingCanvas.height = drawingCanvas.offsetHeight;
    renderStrokes();
}


function setupDrawingControls() {
    const drawModeBtn = document.getElementById('draw-mode-btn');
    const selectModeBtn = document.getElementById('select-mode-btn');
    const viewModeBtn = document.getElementById('view-mode-btn');
    const drawColorInput = document.getElementById('draw-color');
    const drawSizeInput = document.getElementById('draw-size');
    const clearCanvasBtn = document.getElementById('clear-canvas-btn');

    if (drawModeBtn) {
        drawModeBtn.addEventListener('click', () => {
            isDrawMode = true;
            isViewMode = false;
            const drawingCanvas = document.getElementById('drawing-canvas');
            const notesContainer = document.querySelector('.notes-container');
            if (drawingCanvas) {
                drawingCanvas.classList.remove('disabled');
                drawingCanvas.classList.remove('view-mode');
            }
            if (notesContainer) notesContainer.classList.remove('view-mode');
            document.querySelector('.canvas-container').style.cursor = '';
            drawModeBtn.classList.add('active');
            if (selectModeBtn) selectModeBtn.classList.remove('active');
            if (viewModeBtn) viewModeBtn.classList.remove('active');
        });
    }

    if (selectModeBtn) {
        selectModeBtn.addEventListener('click', () => {
            isDrawMode = false;
            isViewMode = false;
            const drawingCanvas = document.getElementById('drawing-canvas');
            const notesContainer = document.querySelector('.notes-container');
            if (drawingCanvas) {
                drawingCanvas.classList.add('disabled');
                drawingCanvas.classList.remove('view-mode');
            }
            if (notesContainer) notesContainer.classList.remove('view-mode');
            document.querySelector('.canvas-container').style.cursor = '';
            if (drawModeBtn) drawModeBtn.classList.remove('active');
            selectModeBtn.classList.add('active');
            if (viewModeBtn) viewModeBtn.classList.remove('active');
        });
    }

    if (viewModeBtn) {
        viewModeBtn.addEventListener('click', () => {
            isDrawMode = false;
            isViewMode = true;
            const drawingCanvas = document.getElementById('drawing-canvas');
            const notesContainer = document.querySelector('.notes-container');
            if (drawingCanvas) {
                drawingCanvas.classList.remove('disabled');
                drawingCanvas.classList.add('view-mode');
            }
            if (notesContainer) notesContainer.classList.add('view-mode');
            document.querySelector('.canvas-container').style.cursor = 'grab';
            if (drawModeBtn) drawModeBtn.classList.remove('active');
            if (selectModeBtn) selectModeBtn.classList.remove('active');
            viewModeBtn.classList.add('active');
        });
    }

    if (drawColorInput) {
        drawColorInput.addEventListener('change', (e) => {
            drawColor = e.target.value;
        });
    }

    if (drawSizeInput) {
        drawSizeInput.addEventListener('change', (e) => {
            drawSize = parseInt(e.target.value);
        });
    }

    if (clearCanvasBtn) {
        clearCanvasBtn.addEventListener('click', () => {
            if (confirm('Clear all drawings? This cannot be undone.')) {
                strokes = [];
                currentStroke = null;
                renderStrokes();
                saveToStorage();
            }
        });
    }
}

// Collapse or reveal the entire header. The canvas-container is flex:1 so it
// automatically expands to fill the freed space. Canvas pixel buffers are
// resized after the CSS transition completes so the coordinate system stays correct.
function setupToolbarToggle() {
    const header = document.querySelector('header');
    const toggleBtn = document.getElementById('header-toggle-btn');
    if (!header || !toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        const hidden = header.classList.toggle('header-hidden');
        toggleBtn.classList.toggle('header-hidden', hidden);
        toggleBtn.setAttribute('aria-expanded', String(!hidden));
        toggleBtn.title = hidden ? 'Show header' : 'Hide header';

        // Resize canvas pixel buffers once the transition settles (0.28s + buffer)
        setTimeout(() => {
            resizeCanvas();
            resizeDrawingCanvas();
        }, 300);
    });
}

// ==================== INITIALIZATION ====================

function init() {
    resizeCanvas();
    renderNotes();
    updateEmptyState();
    updateBoardTransform();
    initializeDrawing();
    setupToolbarToggle();
    setupBoardsSidebar();

    // Set view mode as default
    const viewModeBtn = document.getElementById('view-mode-btn');
    if (viewModeBtn) {
        viewModeBtn.click();
    }
    
    window.addEventListener('resize', resizeCanvas);
    document.getElementById('notes-container').addEventListener('mousedown', startDragging);
    document.getElementById('add-note-btn').addEventListener('click', showAddNoteModal);
    document.getElementById('save-layout-btn').addEventListener('click', saveLayout);
    document.getElementById('reset-layout-btn').addEventListener('click', resetLayout);
    document.getElementById('cancel-note').addEventListener('click', hideNoteModal);
    document.getElementById('save-note').addEventListener('click', saveNote);
    setupColorPicker();
    
    const canvasContainer = document.querySelector('.canvas-container');

    // Left-click pan and middle-click pan — on the container so the full area
    // is always covered, even when the board has been panned away from an edge.
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            _startBoardPan(e.clientX, e.clientY);
        } else if (e.button === 0) {
            startBoardDrag(e);
        }
    });

    // Space + left-click pans in any mode (capture phase overrides draw canvas)
    document.addEventListener('mousedown', (e) => {
        if (e.button === 0 && isSpacePanning && canvasContainer.contains(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            _startBoardPan(e.clientX, e.clientY);
        }
    }, true);

    // Space key: hold to pan in any mode
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.target.matches('input, textarea, [contenteditable]')) {
            isSpacePanning = true;
            e.preventDefault();
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            isSpacePanning = false;
        }
    });

    // Scroll/wheel: pan by default, ctrl+scroll to zoom (matches Figma/Miro)
    canvasContainer.addEventListener('wheel', handleZoom, { passive: false });

    drawConnections();
}

// Resize canvas to fit container
function resizeCanvas() {
    const canvas = document.getElementById('connection-canvas');
    const container = canvas.parentElement;
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        drawConnections();
    }
}

// Get a non-overlapping position for new notes
function getNonOverlappingPosition() {
    const padding = 20;
    const noteWidth = 250;
    const noteHeight = 200;
    
    if (notes.length === 0) {
        return { x: 50, y: 50 };
    }
    
    for (let attempt = 0; attempt < 50; attempt++) {
        const x = Math.random() * 1000;
        const y = Math.random() * 800;
        
        let overlapping = false;
        
        for (const note of notes) {
            const distance = Math.sqrt(Math.pow(note.x - x, 2) + Math.pow(note.y - y, 2));
            if (distance < noteWidth + padding) {
                overlapping = true;
                break;
            }
        }
        
        if (!overlapping) {
            return { x, y };
        }
    }
    
    const gridSize = Math.ceil(Math.sqrt(notes.length + 1));
    const gridX = (notes.length % gridSize) * (noteWidth + padding);
    const gridY = Math.floor(notes.length / gridSize) * (noteHeight + padding);
    
    return { x: gridX, y: gridY };
}

// Render all notes
function renderNotes() {
    const notesContainer = document.getElementById('notes-container');
    if (!notesContainer) return;
    
    notesContainer.innerHTML = '';

    const fragment = document.createDocumentFragment();
    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'highlight-card' + (_isColorDark(note.color) ? ' dark-bg' : '');
        card.style.left = `${note.x}px`;
        card.style.top = `${note.y}px`;
        card.style.background = note.color || '#ffffff';
        card.setAttribute('data-id', String(note.id));

        card.innerHTML = `
            <div class="highlight-text">"${escapeHtml(note.text)}"</div>
            ${note.note ? `<div class="highlight-note">${escapeHtml(note.note)}</div>` : ''}
            ${note.tags && note.tags.length ? `
                <div class="highlight-tags">
                    ${note.tags.map(t => `<span class="tag">#${t}</span>`).join('')}
                </div>
            ` : ''}
            ${_renderAiTagsHtml(note, _taggingInProgress.has(String(note.id)))}
            <div class="highlight-meta">
                ${note.url ? `<div>From: ${new URL(note.url).hostname}</div>` : ''}
                ${note.timestamp ? `<div>Saved: ${new Date(note.timestamp).toLocaleString()}</div>` : ''}
            </div>
            <div class="card-actions">
                <button class="card-btn edit-btn" data-id="${String(note.id)}">Edit</button>
                <button class="card-btn move-btn" data-id="${String(note.id)}" title="Move to another board">Move</button>
                <button class="card-btn copy-btn" data-id="${String(note.id)}" title="Copy to another board">Copy</button>
                <button class="card-btn delete-btn" data-id="${String(note.id)}">Delete</button>
            </div>
        `;

        fragment.appendChild(card);
    });
    notesContainer.appendChild(fragment);

    drawConnections();
}

// Start dragging a note
function startDragging(e) {
    if (e.button !== 0) return;
    if (e.target.classList.contains('card-btn')) return;
    if (isDrawMode || isViewMode) return;

    activeCard = e.target.closest('.highlight-card');
    if (!activeCard) return;
    isDragging = true;
    activeCard.classList.add('dragging');
    
    const rect = activeCard.getBoundingClientRect();
    
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    e.stopPropagation();
}

// Handle dragging
function onDrag(e) {
    if (!isDragging || !activeCard) return;
    
    const container = document.querySelector('.canvas-container');
    const containerRect = container.getBoundingClientRect();
    
    let mouseX = e.clientX - containerRect.left;
    let mouseY = e.clientY - containerRect.top;
    
    let boardX = (mouseX - boardOffset.x) / scale;
    let boardY = (mouseY - boardOffset.y) / scale;
    
    let x = boardX - dragOffset.x;
    let y = boardY - dragOffset.y;
    
    activeCard.style.left = `${x}px`;
    activeCard.style.top = `${y}px`;
    
    const noteId = activeCard.getAttribute('data-id');
    const note = notes.find(n => String(n.id) === String(noteId));
    if (note) {
        note.x = x;
        note.y = y;
    }
    
    drawConnections();
}

// Stop dragging
function stopDragging() {
    if (activeCard) {
        activeCard.classList.remove('dragging');
    }
    isDragging = false;
    activeCard = null;
    
    saveToStorage();
}

function _startBoardPan(clientX, clientY) {
    isDraggingBoard = true;
    boardDragStart.x = clientX - boardOffset.x;
    boardDragStart.y = clientY - boardOffset.y;
    document.getElementById('board').style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
}

// Start board dragging
function startBoardDrag(e) {
    // Middle mouse button pans in any mode
    if (e.button === 1) {
        e.preventDefault();
    } else {
        // Left click: only pan on empty space (unless space key is held)
        if (isDrawMode && !isSpacePanning) return;
        if (e.target.closest('.highlight-card') && !isSpacePanning) return;
    }

    _startBoardPan(e.clientX, e.clientY);
}

// Handle board dragging
function onBoardDrag(e) {
    if (!isDraggingBoard) return;
    boardOffset.x = e.clientX - boardDragStart.x;
    boardOffset.y = e.clientY - boardDragStart.y;
    updateBoardTransform();
}

// Stop board dragging
function stopBoardDrag() {
    if (isDraggingBoard) {
        isDraggingBoard = false;
        document.getElementById('board').style.cursor = '';
        document.body.style.cursor = '';
        saveToStorage();
    }
}

// Physical mouse wheels produce large, discrete deltaY steps (typically ≥40px
// after browser normalization) with no horizontal component. Touchpads produce
// small, continuous values and may include deltaX for two-finger panning.
function _isMouseWheelEvent(e) {
    if (e.deltaMode !== 0) return true;       // line/page mode = physical scroll wheel
    if (Math.abs(e.deltaX) > 2) return false; // horizontal delta = touchpad pan
    return Math.abs(e.deltaY) >= 40;          // large discrete step = scroll wheel click
}

// Handle scroll: mouse wheel zooms, touchpad pans, ctrl/cmd always zooms
function handleZoom(e) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey || _isMouseWheelEvent(e)) {
        const zoomIntensity = 0.1;
        const wheel = e.deltaY < 0 ? 1 : -1;
        const newScale = scale * (1 + wheel * zoomIntensity);
        scale = Math.max(0.3, Math.min(3, newScale));
        updateBoardTransform();
    } else {
        boardOffset.x -= e.deltaX;
        boardOffset.y -= e.deltaY;
        updateBoardTransform();
    }

    saveBoardSettingsDebounced();
}

function saveBoardSettingsDebounced() {
    clearTimeout(_saveSettingsTimer);
    _saveSettingsTimer = setTimeout(saveToStorage, 400);
}

// Update board transform based on offset and scale
function updateBoardTransform() {
    const board = document.getElementById('board');
    board.style.transformOrigin = '0 0';
    board.style.transform = `translate(${boardOffset.x}px, ${boardOffset.y}px) scale(${scale})`;
    renderStrokes();
    drawConnections();
}

// Draw all connections
function drawConnections() {
    const canvas = document.getElementById('connection-canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    connections.forEach(conn => {
        const fromCard = document.querySelector(`.highlight-card[data-id="${conn.from}"]`);
        const toCard = document.querySelector(`.highlight-card[data-id="${conn.to}"]`);
        
        if (!fromCard || !toCard) return;
        
        const fromRect = fromCard.getBoundingClientRect();
        const toRect = toCard.getBoundingClientRect();
        const containerRect = canvas.getBoundingClientRect();
        
        const fromX = fromRect.left + fromRect.width / 2 - containerRect.left;
        const fromY = fromRect.top + fromRect.height / 2 - containerRect.top;
        const toX = toRect.left + toRect.width / 2 - containerRect.left;
        const toY = toRect.top + toRect.height / 2 - containerRect.top;
        
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const headLength = 10;
        
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
            toX - headLength * Math.cos(angle - Math.PI / 6),
            toY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            toX - headLength * Math.cos(angle + Math.PI / 6),
            toY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fill();
    });
}

function _isColorDark(hex) {
    if (!hex || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

function _applyModalPreviewColor(color) {
    const modal = document.querySelector('#note-modal .modal');
    if (!modal) return;
    modal.style.background = color || '#ffffff';
    modal.classList.toggle('dark-bg', _isColorDark(color));
}

// Set up color swatch click handlers (called once from init)
function setupColorPicker() {
    const swatches = document.querySelectorAll('.color-swatch[data-color]');
    const customInput = document.getElementById('note-color-custom');
    const customSwatch = customInput ? customInput.closest('.color-swatch-custom') : null;
    const hiddenColor = document.getElementById('note-color');

    swatches.forEach(swatch => {
        swatch.addEventListener('click', () => {
            swatches.forEach(s => s.classList.remove('active'));
            if (customSwatch) customSwatch.classList.remove('active');
            swatch.classList.add('active');
            if (hiddenColor) hiddenColor.value = swatch.dataset.color;
            _applyModalPreviewColor(swatch.dataset.color);
        });
    });

    if (customInput) {
        customInput.addEventListener('input', () => {
            swatches.forEach(s => s.classList.remove('active'));
            if (customSwatch) customSwatch.classList.add('active');
            if (hiddenColor) hiddenColor.value = customInput.value;
            _applyModalPreviewColor(customInput.value);
        });
    }
}

// Set the color picker to a specific color, activating the matching swatch
function setModalColor(color) {
    const colorValue = color || '#ffffff';
    const swatches = document.querySelectorAll('.color-swatch[data-color]');
    const customInput = document.getElementById('note-color-custom');
    const customSwatch = customInput ? customInput.closest('.color-swatch-custom') : null;
    const hiddenColor = document.getElementById('note-color');

    if (hiddenColor) hiddenColor.value = colorValue;
    _applyModalPreviewColor(colorValue);

    let matched = false;
    swatches.forEach(s => {
        s.classList.remove('active');
        if (s.dataset.color === colorValue) {
            s.classList.add('active');
            matched = true;
        }
    });

    if (!matched && customSwatch) {
        customSwatch.classList.add('active');
        if (customInput) customInput.value = colorValue;
    }
}

// Show add note modal
function showAddNoteModal() {
    document.getElementById('modal-title').textContent = 'Add New Note';
    document.getElementById('note-text').value = '';
    document.getElementById('note-comment').value = '';
    document.getElementById('note-tags').value = '';
    setModalColor('#ffffff');
    currentEditId = null;
    document.getElementById('note-modal').style.display = 'flex';
}

// Hide note modal
function hideNoteModal() {
    document.getElementById('note-modal').style.display = 'none';
}

// Edit note
function editNote(noteId) {
    noteId = String(noteId);
    console.log('Looking for note with ID:', noteId);

    const note = notes.find(n => String(n.id) === noteId);
    if (!note) {
        console.error('Note not found! ID:', noteId);
        return;
    }

    document.getElementById('modal-title').textContent = 'Edit Note';
    document.getElementById('note-text').value = note.text;
    document.getElementById('note-comment').value = note.note || '';
    document.getElementById('note-tags').value = note.tags ? note.tags.join(', ') : '';
    setModalColor(note.color || '#ffffff');
    currentEditId = noteId;
    document.getElementById('note-modal').style.display = 'flex';
}

// Save note
function saveNote() {
    console.log('[Jot] saveNote called');
    const text = document.getElementById('note-text').value.trim();
    const note = document.getElementById('note-comment').value.trim();
    const tags = document.getElementById('note-tags').value
        .split(',')
        .map(t => t.trim())
        .filter(t => t);
    const color = document.getElementById('note-color').value || '#ffffff';

    if (!text) {
        alert('Please enter some text for your note.');
        return;
    }

    let noteToTag = null;

    if (currentEditId) {
        const noteId = String(currentEditId);
        const existingNote = notes.find(n => String(n.id) === noteId);
        if (existingNote) {
            const textChanged = existingNote.text !== text;
            existingNote.text = text;
            existingNote.note = note;
            existingNote.tags = tags;
            existingNote.color = color;
            if (textChanged) {
                existingNote.aiCategory = null;
                existingNote.aiTags = null;
                noteToTag = existingNote;
            }
            console.log('Updated note:', noteId);
        }
        currentEditId = null;
    } else {
        const position = getNonOverlappingPosition();
        const newNote = {
            id: `note_${String(Date.now())}_${Math.random().toString(36).substring(2, 8)}`,
            text,
            note,
            tags,
            color,
            timestamp: new Date().toISOString(),
            aiCategory: null,
            aiTags: null,
            x: position.x,
            y: position.y
        };
        notes.push(newNote);
        noteToTag = newNote;
        console.log('Created new note:', newNote.id);
    }

    renderNotes();
    updateEmptyState();
    hideNoteModal();
    saveToStorage();

    if (noteToTag) _tagNote(noteToTag);
}

// Delete note
function deleteNote(noteId) {
    noteId = String(noteId);
    
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    console.log('Deleting note:', noteId);
    
    notes = notes.filter(n => String(n.id) !== noteId);
    connections = connections.filter(conn => 
        String(conn.from) !== noteId && String(conn.to) !== noteId
    );
    
    renderNotes();
    updateEmptyState();
    saveToStorage();
}

// Save layout
function saveLayout() {
    saveToStorage();
    alert('Layout saved successfully! Your note positions and view settings have been preserved.');
}

// Reset layout
function resetLayout() {
    if (!confirm('Are you sure you want to reset the layout? This will rearrange all notes.')) return;

    boardOffset = { x: 0, y: 0 };
    scale = 1;
    updateBoardTransform();
    
    const noteWidth = 250;
    const noteHeight = 200;
    const padding = 20;
    
    notes.forEach((note, index) => {
        const gridSize = Math.ceil(Math.sqrt(notes.length));
        note.x = 50 + (index % gridSize) * (noteWidth + padding);
        note.y = 50 + Math.floor(index / gridSize) * (noteHeight + padding);
    });
    
    renderNotes();
    saveToStorage();
}

// Update empty state visibility
function updateEmptyState() {
    const emptyState = document.getElementById('empty-state');
    if (emptyState) {
        emptyState.style.display = notes.length === 0 ? 'block' : 'none';
    }
}

// HTML escape utility
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== AI TAGGING ====================

// Returns the HTML string for a note's AI tag row, or '' if nothing to show.
// isLoading: true while the Gemini request is in flight.
function _renderAiTagsHtml(note, isLoading) {
    if (isLoading) {
        return '<div class="ai-tags-row"><span class="ai-tags-loading"></span></div>';
    }
    if (!note.aiCategory && (!note.aiTags || !note.aiTags.length)) return '';
    var parts = [];
    if (note.aiCategory) {
        parts.push('<span class="tag">#' + escapeHtml(note.aiCategory) + '</span>');
    }
    if (note.aiTags && note.aiTags.length) {
        note.aiTags.forEach(function (t) {
            parts.push('<span class="tag">#' + escapeHtml(t) + '</span>');
        });
    }
    return parts.length ? '<div class="ai-tags-row">' + parts.join('') + '</div>' : '';
}

// Update only the AI tag row on an already-rendered card, avoiding a full renderNotes() pass.
function _updateCardTagsDOM(noteId) {
    var card = document.querySelector('.highlight-card[data-id="' + noteId + '"]');
    if (!card) return;
    var note = notes.find(function (n) { return String(n.id) === String(noteId); });
    if (!note) return;

    var existing = card.querySelector('.ai-tags-row');
    var html = _renderAiTagsHtml(note, _taggingInProgress.has(noteId));

    if (!html) {
        if (existing) existing.remove();
        return;
    }

    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var newEl = tmp.firstChild;

    if (existing) {
        existing.replaceWith(newEl);
    } else {
        var meta = card.querySelector('.highlight-meta');
        if (meta) {
            card.insertBefore(newEl, meta);
        } else {
            var actions = card.querySelector('.card-actions');
            if (actions) card.insertBefore(newEl, actions);
        }
    }
}

// Call the Gemini API for a note and update the card when the response arrives.
// Saves the note immediately with null tags, then updates storage when tags arrive.
// Fails silently — never blocks or delays the user.
function _tagNote(note) {
    console.log('[Jot] _tagNote called, JotTagger:', !!window.JotTagger);
    if (!window.JotTagger) return;
    var noteId = String(note.id);

    _taggingInProgress.add(noteId);
    _updateCardTagsDOM(noteId);

    window.JotTagger.generateNoteTags(note.text).then(function (result) {
        console.log('[Jot] Gemini result:', result);
        _taggingInProgress.delete(noteId);
        var noteObj = notes.find(function (n) { return String(n.id) === noteId; });
        if (result && noteObj) {
            noteObj.aiCategory = result.category;
            noteObj.aiTags = result.tags;
            // Merge just this note's tags into storage — a full saveToStorage()
            // snapshot could clobber highlights captured concurrently in other tabs.
            JotBoardStorage.updateHighlightInBoard(
                currentBoardId,
                currentBoardIsLegacy,
                noteId,
                { aiCategory: result.category, aiTags: result.tags }
            );
        }
        _updateCardTagsDOM(noteId);
    });
}

// ==================== MULTI-BOARD SIDEBAR ====================

// Switch to a different board.
// Saves the outgoing board first unless options.saveCurrent === false (used after deletion).
// Calls callback (if provided) once the sidebar list has re-rendered.
function switchToBoard(boardId, options, callback) {
    options = options || {};
    if (boardId === currentBoardId) return;

    clearTimeout(_saveSettingsTimer);
    if (options.saveCurrent !== false) saveToStorage();

    JotBoardStorage.setActiveBoardId(boardId);

    loadBoardIntoCanvas(boardId, function () {
        activeCard = null;
        isDragging = false;
        isDraggingBoard = false;
        isDrawing = false;
        connectingFrom = null;
        currentEditId = null;

        renderNotes();
        updateEmptyState();
        updateBoardTransform();

        JotBoardStorage.getBoards(function (boards) {
            renderSidebarBoardList(boards, callback);
        });
    });
}

// Wire up the sidebar toggle button and new-board button. Renders initial list.
function setupBoardsSidebar() {
    const sidebar = document.getElementById('boards-sidebar');
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const newBoardBtn = document.getElementById('new-board-btn');
    if (!sidebar || !toggleBtn) return;

    toggleBtn.addEventListener('click', function () {
        const open = sidebar.classList.toggle('open');
        toggleBtn.classList.toggle('sidebar-open', open);
        toggleBtn.setAttribute('aria-expanded', String(open));
        toggleBtn.title = open ? 'Hide boards' : 'Show boards';
    });

    if (newBoardBtn) {
        newBoardBtn.addEventListener('click', createNewBoard);
    }

    renderSidebarBoardList();
}

// Build or rebuild the board list DOM.
// Pass boards array directly to skip a storage read, or omit to fetch fresh.
// onRendered is called synchronously after the DOM is updated.
function renderSidebarBoardList(boards, onRendered) {
    if (!boards) {
        JotBoardStorage.getBoards(function (b) { renderSidebarBoardList(b, onRendered); });
        return;
    }

    const listEl = document.getElementById('board-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    boards.forEach(function (board) {
        const item = document.createElement('div');
        item.className = 'board-item' + (board.id === currentBoardId ? ' active' : '');
        item.setAttribute('data-board-id', board.id);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'board-item-name';
        nameSpan.textContent = board.name;

        const isBrainDump = board.id === JotBoardStorage.BRAIN_DUMP_ID;

        const actions = document.createElement('div');
        actions.className = 'board-item-actions';

        if (!isBrainDump) {
            const renameBtn = document.createElement('button');
            renameBtn.className = 'board-item-btn';
            renameBtn.title = 'Rename board';
            renameBtn.setAttribute('aria-label', 'Rename board');
            renameBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'board-item-btn';
            deleteBtn.title = 'Delete board';
            deleteBtn.setAttribute('aria-label', 'Delete board');
            deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);

            renameBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                startRenamingBoard(board.id);
            });

            deleteBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                requestDeleteBoard(board.id);
            });
        }

        item.appendChild(nameSpan);
        item.appendChild(actions);
        listEl.appendChild(item);

        item.addEventListener('click', function (e) {
            if (e.target.closest('.board-item-btn')) return;
            if (item.classList.contains('renaming')) return;
            switchToBoard(board.id);
        });
    });

    if (typeof onRendered === 'function') onRendered();
}

// Replace the board item's name with an inline text input for renaming.
function startRenamingBoard(boardId) {
    if (boardId === JotBoardStorage.BRAIN_DUMP_ID) return;
    const item = document.querySelector(`.board-item[data-board-id="${boardId}"]`);
    if (!item) return;

    const nameEl = item.querySelector('.board-item-name');
    if (!nameEl) return;

    item.classList.add('renaming');
    const currentName = nameEl.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'board-item-rename-input';
    input.value = currentName;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    function commit() {
        if (committed) return;
        committed = true;
        const newName = input.value.trim() || currentName;
        JotBoardStorage.renameBoard(boardId, newName, function (boards) {
            renderSidebarBoardList(boards);
        });
    }

    function cancel() {
        if (committed) return;
        committed = true;
        renderSidebarBoardList();
    }

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
}

// Confirm, then delete the board. If it was active, switch to the next available
// board (or auto-create one if the list is now empty).
function requestDeleteBoard(boardId) {
    if (boardId === JotBoardStorage.BRAIN_DUMP_ID) return;
    JotBoardStorage.getBoards(function (boards) {
        const board = boards.find(function (b) { return b.id === boardId; });
        if (!board) return;

        if (!confirm('Delete board "' + board.name + '"? This cannot be undone.')) return;

        const wasActive = boardId === currentBoardId;

        JotBoardStorage.deleteBoard(boardId, function (remaining) {
            if (!wasActive) {
                renderSidebarBoardList(remaining);
                return;
            }

            if (remaining.length > 0) {
                switchToBoard(remaining[0].id, { saveCurrent: false });
            } else {
                // No boards left — create a fresh one and enter rename mode.
                JotBoardStorage.createBoard('My Board', function (newBoard, allBoards) {
                    switchToBoard(newBoard.id, { saveCurrent: false }, function () {
                        startRenamingBoard(newBoard.id);
                    });
                });
            }
        });
    });
}

// Create a new board, switch to it, and immediately enter rename mode.
function createNewBoard() {
    JotBoardStorage.createBoard('New Board', function (newBoard) {
        switchToBoard(newBoard.id, {}, function () {
            startRenamingBoard(newBoard.id);
        });
    });
}

// ==================== BOARD PICKER (MOVE / COPY) ====================

// Show a compact picker panel anchored to anchorEl.
// mode: 'move' (write to dest, delete from source) or 'copy' (duplicate only).
function showBoardPickerForNote(noteId, mode, anchorEl) {
    _closeBoardPicker();

    JotBoardStorage.getBoards(function (boards) {
        var targets = boards.filter(function (b) { return b.id !== currentBoardId; });
        if (targets.length === 0) return;

        var picker = document.createElement('div');
        picker.className = 'board-picker-panel';
        picker.id = 'board-picker-panel';

        var header = document.createElement('div');
        header.className = 'board-picker-header';
        header.textContent = mode === 'move' ? 'Move to board' : 'Copy to board';
        picker.appendChild(header);

        var list = document.createElement('div');
        list.className = 'board-picker-list';

        targets.forEach(function (board) {
            var btn = document.createElement('button');
            btn.className = 'board-picker-item';
            btn.textContent = board.name;
            btn.setAttribute('data-board-id', board.id);

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (mode === 'copy') {
                    _executeCopyNote(noteId, board);
                    _closeBoardPicker();
                } else {
                    _showMoveConfirm(picker, noteId, board);
                }
            });

            list.appendChild(btn);
        });

        picker.appendChild(list);
        document.body.appendChild(picker);

        // Position the picker below the anchor, clamped to the viewport.
        var rect = anchorEl.getBoundingClientRect();
        var pickerW = 200;
        var left = rect.left;
        var top = rect.bottom + 6;
        if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
        if (top + 220 > window.innerHeight - 8) top = Math.max(8, rect.top - 220 - 6);
        picker.style.left = Math.max(8, left) + 'px';
        picker.style.top = top + 'px';

        // Dismiss on any outside click (use timeout so this click doesn't immediately close it)
        setTimeout(function () {
            document.addEventListener('click', _boardPickerOutsideClick);
        }, 0);
    });
}

// Replace the board list with an inline confirm step for move operations.
function _showMoveConfirm(pickerEl, noteId, targetBoard) {
    var list = pickerEl.querySelector('.board-picker-list');
    if (list) list.remove();

    var row = document.createElement('div');
    row.className = 'board-picker-confirm';

    var label = document.createElement('span');
    label.className = 'board-picker-confirm-text';
    label.textContent = 'Move to “' + targetBoard.name + '”?';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'board-picker-confirm-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _closeBoardPicker();
    });

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'board-picker-confirm-btn primary';
    confirmBtn.textContent = 'Move';
    confirmBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        _executeMoveNote(noteId, targetBoard);
        _closeBoardPicker();
    });

    row.appendChild(label);
    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    pickerEl.appendChild(row);
}

function _closeBoardPicker() {
    var el = document.getElementById('board-picker-panel');
    if (el) el.remove();
    document.removeEventListener('click', _boardPickerOutsideClick);
}

function _boardPickerOutsideClick(e) {
    var picker = document.getElementById('board-picker-panel');
    if (!picker) { document.removeEventListener('click', _boardPickerOutsideClick); return; }
    if (!picker.contains(e.target)) {
        _closeBoardPicker();
    }
}

// Write note to destination first; on success remove from source and re-render.
// This satisfies the "write dest, confirm, delete source" atomicity requirement.
function _executeMoveNote(noteId, targetBoard) {
    var note = notes.find(function (n) { return String(n.id) === String(noteId); });
    if (!note) return;

    var toIsLegacy = !!targetBoard.legacy;

    // Clear any pending debounced save to prevent a stale write racing the move.
    clearTimeout(_saveSettingsTimer);

    JotBoardStorage.appendHighlightToBoard(targetBoard.id, toIsLegacy, note, function () {
        // Destination confirmed written — now remove from source (in-memory + storage).
        notes = notes.filter(function (n) { return String(n.id) !== String(noteId); });
        connections = connections.filter(function (c) {
            return String(c.from) !== String(noteId) && String(c.to) !== String(noteId);
        });
        renderNotes();
        saveToStorage();
        updateEmptyState();
    });
}

function _executeCopyNote(noteId, targetBoard) {
    var note = notes.find(function (n) { return String(n.id) === String(noteId); });
    if (!note) return;

    var toIsLegacy = !!targetBoard.legacy;

    JotBoardStorage.copyNoteToBoard(note, targetBoard.id, toIsLegacy, function () {
        // Show a brief "Copied!" label on the card.
        var card = document.querySelector('.highlight-card[data-id="' + noteId + '"]');
        if (!card) return;
        var existing = card.querySelector('.card-copy-toast');
        if (existing) existing.remove();
        var toast = document.createElement('div');
        toast.className = 'card-copy-toast';
        toast.textContent = 'Copied!';
        card.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 1600);
    });
}

// Start loading data when the page is ready
document.addEventListener('DOMContentLoaded', function() {
    const board = document.getElementById('board');
    board.addEventListener('click', function(e) {
        if (e.target.classList.contains('edit-btn')) {
            e.stopPropagation();
            const noteId = String(e.target.getAttribute('data-id'));
            editNote(noteId);
        } else if (e.target.classList.contains('delete-btn')) {
            e.stopPropagation();
            const noteId = String(e.target.getAttribute('data-id'));
            deleteNote(noteId);
        } else if (e.target.classList.contains('move-btn')) {
            e.stopPropagation();
            showBoardPickerForNote(String(e.target.getAttribute('data-id')), 'move', e.target);
        } else if (e.target.classList.contains('copy-btn')) {
            e.stopPropagation();
            showBoardPickerForNote(String(e.target.getAttribute('data-id')), 'copy', e.target);
        }
    });
    
    loadData();
});

// Add global event listeners for mouse movements
document.addEventListener('mousemove', function(e) {
    if (isDraggingBoard) {
        onBoardDrag(e);
    } else if (isDragging) {
        onDrag(e);
    }
});

document.addEventListener('mouseup', function() {
    stopBoardDrag();
    stopDragging();
});