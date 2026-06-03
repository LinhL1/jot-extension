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

// Drawing mode variables
let isDrawing = false;
let isDrawMode = false;
let isViewMode = true;
let drawColor = '#111111';
let drawSize = 2;
let lastX = 0;
let lastY = 0;

// Load data from storage
function loadData() {
    // Run migration first to fix any existing notes with old IDs
    migrateNotesToUniqueIds();
    
    chrome.storage.local.get(['readmarks', 'readmarkConnections', 'brainViewSettings', 'jotDrawing'], function(result) {
        const highlights = result.readmarks || [];
        connections = result.readmarkConnections || [];
        
        console.log('Loaded from storage:', {
            highlightsCount: highlights.length,
            connectionsCount: connections.length,
            hasBrainViewSettings: !!result.brainViewSettings
        });
        
        // Load viewport settings if they exist
        if (result.brainViewSettings) {
            boardOffset = result.brainViewSettings.boardOffset || { x: 0, y: 0 };
            scale = result.brainViewSettings.scale || 1;
            console.log('Loaded board settings:', { boardOffset, scale });
        }
        
        // Transform highlights into notes format - Use saved positions!
        notes = highlights.map((h, index) => {
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
                y: typeof h.y === 'number' ? h.y : Math.random() * 200
            };
        });
        
        console.log('Notes loaded with IDs:', notes.map(n => ({ id: n.id, text: n.text.substring(0, 20) })));
        
        // Load drawing if it exists
        if (result.jotDrawing) {
            loadDrawing(result.jotDrawing);
        }
        
        // Initialize the app
        init();

        // FIX: Listen for storage changes so new highlights saved from any tab
        // appear on the board immediately without needing a page reload.
        chrome.storage.onChanged.addListener(function(changes, area) {
            if (area !== 'local') return;
            if (!changes.readmarks && !changes.readmarkConnections) return;

            chrome.storage.local.get(['readmarks', 'readmarkConnections'], function(result) {
                const highlights = result.readmarks || [];
                connections = result.readmarkConnections || [];

                // Build a set of IDs currently on the board
                const existingIds = new Set(notes.map(n => String(n.id)));

                // Add any new highlights that aren't on the board yet
                highlights.forEach((h, index) => {
                    const hId = String(h.id || '');
                    if (!hId || existingIds.has(hId)) return; // already on board

                    const position = getNonOverlappingPosition();
                    notes.push({
                        id: hId,
                        text: h.text,
                        note: h.note,
                        tags: h.tags || [],
                        url: h.url,
                        timestamp: h.timestamp,
                        x: typeof h.x === 'number' ? h.x : position.x,
                        y: typeof h.y === 'number' ? h.y : position.y
                    });
                });

                // Remove notes that were deleted from storage
                const storageIds = new Set(highlights.map(h => String(h.id || '')));
                notes = notes.filter(n => storageIds.has(String(n.id)));

                renderNotes();
                updateEmptyState();
            });
        });
    });
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

// Save data to storage
function saveToStorage() {
    // Save note positions
    const highlights = notes.map(note => ({
        id: note.id,
        text: note.text,
        note: note.note,
        tags: note.tags,
        url: note.url,
        timestamp: note.timestamp,
        x: note.x,
        y: note.y
    }));
    
    console.log('Saving note positions:', highlights.map(n => ({ id: n.id, x: n.x, y: n.y })));
    
    // Save board settings
    const brainViewSettings = {
        boardOffset,
        scale
    };
    
    // Save drawing
    const drawingCanvas = document.getElementById('drawing-canvas');
    const jotDrawing = drawingCanvas ? drawingCanvas.toDataURL('image/png') : null;
    
    chrome.storage.local.set({ 
        readmarks: highlights,
        readmarkConnections: connections,
        brainViewSettings,
        jotDrawing
    }, function() {
        console.log('Data saved to storage:', {
            notesCount: highlights.length,
            positions: highlights.map(n => ({ id: n.id, x: n.x, y: n.y })),
            boardOffset,
            scale,
            hasDrawing: !!jotDrawing
        });
    });
}

// ==================== DRAWING SYSTEM ====================
function initializeDrawing() {
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (!drawingCanvas) return;
    
    const ctx = drawingCanvas.getContext('2d');
    resizeDrawingCanvas();
    
    // Drawing event listeners
    drawingCanvas.addEventListener('mousedown', (e) => {
        if (!isDrawMode) return;
        isDrawing = true;
        const boardRect = document.getElementById('board').parentElement.getBoundingClientRect();
        
        lastX = (e.clientX - boardRect.left - boardOffset.x) / scale;
        lastY = (e.clientY - boardRect.top - boardOffset.y) / scale;
    });

    drawingCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isDrawMode) return;
        const boardRect = document.getElementById('board').parentElement.getBoundingClientRect();
        
        const x = (e.clientX - boardRect.left - boardOffset.x) / scale;
        const y = (e.clientY - boardRect.top - boardOffset.y) / scale;

        ctx.strokeStyle = drawColor;
        ctx.lineWidth = drawSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();

        lastX = x;
        lastY = y;

        saveToStorage();
    });

    drawingCanvas.addEventListener('mouseup', () => {
        isDrawing = false;
    });

    drawingCanvas.addEventListener('mouseleave', () => {
        isDrawing = false;
    });

    window.addEventListener('resize', resizeDrawingCanvas);

    setupDrawingControls();
}

function resizeDrawingCanvas() {
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (!drawingCanvas) return;
    
    drawingCanvas.width = drawingCanvas.offsetWidth;
    drawingCanvas.height = drawingCanvas.offsetHeight;
}

function loadDrawing(imageData) {
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (!drawingCanvas) return;
    
    const ctx = drawingCanvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0);
    };
    img.src = imageData;
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
                const drawingCanvas = document.getElementById('drawing-canvas');
                if (drawingCanvas) {
                    const ctx = drawingCanvas.getContext('2d');
                    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
                }
                saveToStorage();
            }
        });
    }
}

// ==================== INITIALIZATION ====================

function init() {
    resizeCanvas();
    renderNotes();
    updateEmptyState();
    updateBoardTransform();
    initializeDrawing();
    
    // Set view mode as default
    const viewModeBtn = document.getElementById('view-mode-btn');
    if (viewModeBtn) {
        viewModeBtn.click();
    }
    
    window.addEventListener('resize', resizeCanvas);
    document.getElementById('add-note-btn').addEventListener('click', showAddNoteModal);
    document.getElementById('save-layout-btn').addEventListener('click', saveLayout);
    document.getElementById('reset-layout-btn').addEventListener('click', resetLayout);
    document.getElementById('cancel-note').addEventListener('click', hideNoteModal);
    document.getElementById('save-note').addEventListener('click', saveNote);
    
    // Board dragging (left-click on empty space)
    const board = document.getElementById('board');
    board.addEventListener('mousedown', startBoardDrag);

    const canvasContainer = document.querySelector('.canvas-container');

    // Middle-click pans in any mode
    canvasContainer.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            _startBoardPan(e.clientX, e.clientY);
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
    
    notes.forEach(note => {
        const card = document.createElement('div');
        card.className = 'highlight-card';
        card.style.left = `${note.x}px`;
        card.style.top = `${note.y}px`;
        card.setAttribute('data-id', String(note.id));
        
        card.innerHTML = `
            <div class="highlight-text">"${escapeHtml(note.text)}"</div>
            ${note.note ? `<div class="highlight-note">${escapeHtml(note.note)}</div>` : ''}
            ${note.tags && note.tags.length ? `
                <div class="highlight-tags">
                    ${note.tags.map(t => `<span class="tag">#${t}</span>`).join('')}
                </div>
            ` : ''}
            <div class="highlight-meta">
                ${note.url ? `<div>From: ${new URL(note.url).hostname}</div>` : ''}
                ${note.timestamp ? `<div>Saved: ${new Date(note.timestamp).toLocaleString()}</div>` : ''}
            </div>
            <div class="card-actions">
                <button class="card-btn edit-btn" data-id="${String(note.id)}">Edit</button>
                <button class="card-btn delete-btn" data-id="${String(note.id)}">Delete</button>
            </div>
        `;
        
        card.addEventListener('mousedown', startDragging);
        
        notesContainer.appendChild(card);
    });
    
    saveToStorage();
    drawConnections();
}

// Start dragging a note
function startDragging(e) {
    if (e.button !== 0) return;
    if (e.target.classList.contains('card-btn')) return;
    if (isDrawMode || isViewMode) return;

    activeCard = e.currentTarget;
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

// Handle scroll: pan by default, zoom with ctrl/cmd
function handleZoom(e) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
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
    
    const drawingCanvas = document.getElementById('drawing-canvas');
    if (drawingCanvas) {
        drawingCanvas.style.transformOrigin = '0 0';
        drawingCanvas.style.transform = `translate(${boardOffset.x}px, ${boardOffset.y}px) scale(${scale})`;
    }
    
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

// Show add note modal
function showAddNoteModal() {
    document.getElementById('modal-title').textContent = 'Add New Note';
    document.getElementById('note-text').value = '';
    document.getElementById('note-comment').value = '';
    document.getElementById('note-tags').value = '';
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
    currentEditId = noteId;
    document.getElementById('note-modal').style.display = 'flex';
}

// Save note
function saveNote() {
    const text = document.getElementById('note-text').value.trim();
    const note = document.getElementById('note-comment').value.trim();
    const tags = document.getElementById('note-tags').value
        .split(',')
        .map(t => t.trim())
        .filter(t => t);
    
    if (!text) {
        alert('Please enter some text for your note.');
        return;
    }
    
    if (currentEditId) {
        const noteId = String(currentEditId);
        const existingNote = notes.find(n => String(n.id) === noteId);
        if (existingNote) {
            existingNote.text = text;
            existingNote.note = note;
            existingNote.tags = tags;
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
            x: position.x,
            y: position.y
        };
        notes.push(newNote);
        console.log('Created new note:', newNote.id);
    }
    
    renderNotes();
    updateEmptyState();
    hideNoteModal();
    saveToStorage();
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

// Start loading data when the page is ready
document.addEventListener('DOMContentLoaded', function() {
    const board = document.getElementById('board');
    board.addEventListener('click', function(e) {
        if (e.target.classList.contains('edit-btn')) {
            e.stopPropagation();
            const noteId = String(e.target.getAttribute('data-id'));
            console.log('Edit clicked for note ID:', noteId);
            editNote(noteId);
        } else if (e.target.classList.contains('delete-btn')) {
            e.stopPropagation();
            const noteId = String(e.target.getAttribute('data-id'));
            console.log('Delete clicked for note ID:', noteId);
            deleteNote(noteId);
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