// Global variables
let notes = [];
let connections = [];
let activeCard = null;
let isDragging = false;
let isDraggingBoard = false;
let dragOffset = { x: 0, y: 0 };
let connectingFrom = null;
let currentEditId = null;
let boardOffset = { x: 0, y: 0 };
let scale = 1;

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
        notes = highlights.map(h => ({
            id: typeof h.id === 'number' ? h.id : parseInt(h.id) || Date.now(),
            text: h.text,
            note: h.note,
            tags: h.tags || [],
            url: h.url,
            timestamp: h.timestamp,
            x: typeof h.x === 'number' ? h.x : Math.random() * 300,
            y: typeof h.y === 'number' ? h.y : Math.random() * 200
        }));
        
        console.log('Notes with positions:', notes.map(n => ({ x: n.x, y: n.y })));
        
        // Load drawing if it exists
        if (result.jotDrawing) {
            loadDrawing(result.jotDrawing);
        }
        
        // Initialize the app
        init();
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
        x: note.x, // Save the actual positions
        y: note.y  // Save the actual positions
    }));
    
    // Log positions being saved
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
        const rect = drawingCanvas.getBoundingClientRect();
        lastX = e.clientX - rect.left;
        lastY = e.clientY - rect.top;
    });

    drawingCanvas.addEventListener('mousemove', (e) => {
        if (!isDrawing || !isDrawMode) return;
        const rect = drawingCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

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

    // Set up drawing controls
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

// Initialize the app
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
    
    // Event listeners
    window.addEventListener('resize', resizeCanvas);
    document.getElementById('add-note-btn').addEventListener('click', showAddNoteModal);
    document.getElementById('save-layout-btn').addEventListener('click', saveLayout);
    document.getElementById('reset-layout-btn').addEventListener('click', resetLayout);
    document.getElementById('cancel-note').addEventListener('click', hideNoteModal);
    document.getElementById('save-note').addEventListener('click', saveNote);
    
    // Board dragging
    const board = document.getElementById('board');
    board.addEventListener('mousedown', startBoardDrag);
    
    // Zoom functionality
    board.addEventListener('wheel', handleZoom, { passive: false });
    
    // Draw initial connections
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
    
    // If there are no notes yet, start in a reasonable position
    if (notes.length === 0) {
        return { x: 50, y: 50 };
    }
    
    // Try multiple positions to find a non-overlapping one
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
    
    // If we can't find a non-overlapping position, use a grid position
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
                <button class="card-btn edit-btn" data-id="${note.id}">Edit</button>
                <button class="card-btn delete-btn" data-id="${note.id}">Delete</button>
            </div>
        `;
        
        // Add drag functionality
        card.addEventListener('mousedown', startDragging);
        
        // Add button functionality
        const editBtn = card.querySelector('.edit-btn');
        const deleteBtn = card.querySelector('.delete-btn');
        
        editBtn.addEventListener('click', (e) =>{
            e.stopPropagation();
            editNote(note.id);
        });
        
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteNote(note.id);
        });
        
        notesContainer.appendChild(card);
    });
    
    // Save positions after rendering
    saveToStorage();
    drawConnections();
}

// Start dragging a note
function startDragging(e) {
    if (e.target.classList.contains('card-btn')) return;
    if (isDrawMode || isViewMode) return; // Don't drag notes in draw or view mode
    
    activeCard = e.currentTarget;
    isDragging = true;
    activeCard.classList.add('dragging');
    
    // Get position relative to the card itself
    const rect = activeCard.getBoundingClientRect();
    const container = document.querySelector('.canvas-container');
    const containerRect = container.getBoundingClientRect();
    
    // Calculate click offset within the card
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    
    e.stopPropagation(); // Prevent triggering board drag
}

// Handle dragging
function onDrag(e) {
    if (!isDragging || !activeCard) return;
    
    // Get the container (canvas) position
    const container = document.querySelector('.canvas-container');
    const containerRect = container.getBoundingClientRect();
    
    // Calculate position relative to viewport
    let mouseX = e.clientX - containerRect.left;
    let mouseY = e.clientY - containerRect.top;
    
    // Account for board transform (scale and offset)
    // Reverse the board transformation to get coordinates in board space
    let boardX = (mouseX - boardOffset.x) / scale;
    let boardY = (mouseY - boardOffset.y) / scale;
    
    // Apply drag offset
    let x = boardX - dragOffset.x;
    let y = boardY - dragOffset.y;
    
    // Optional: Constrain to board bounds (comment out for infinite)
    // x = Math.max(0, Math.min(5000 - activeCard.offsetWidth, x));
    // y = Math.max(0, Math.min(5000 - activeCard.offsetHeight, y));
    
    activeCard.style.left = `${x}px`;
    activeCard.style.top = `${y}px`;
    
    // Update the note's position in our data
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
    
    // Save the new positions
    saveToStorage();
}

// Start board dragging
function startBoardDrag(e) {
    if (isDrawMode) return; // Don't drag board in draw mode only
    if (e.target.closest('.highlight-card')) return; // Don't drag board if clicking on a card
    
    isDraggingBoard = true;
    
    // Store the current board offset when starting drag
    dragOffset.x = e.clientX - boardOffset.x;
    dragOffset.y = e.clientY - boardOffset.y;
    
    document.body.style.cursor = 'grabbing';
}

// Handle board dragging
function onBoardDrag(e) {
    if (!isDraggingBoard) return;
    
    // Simple, direct calculation for smooth panning
    boardOffset.x = e.clientX - dragOffset.x;
    boardOffset.y = e.clientY - dragOffset.y;
    
    updateBoardTransform();
}

// Stop board dragging
function stopBoardDrag() {
    if (isDraggingBoard) {
        isDraggingBoard = false;
        document.body.style.cursor = '';
        saveToStorage(); // Save board position
    }
}

// Handle zoom
function handleZoom(e) {
    e.preventDefault();
    
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const newScale = scale * (1 + wheel * zoomIntensity);
    
    // Limit zoom between 0.3 and 3
    scale = Math.max(0.3, Math.min(3, newScale));
    
    updateBoardTransform();
    saveToStorage(); // Save zoom level
}

// Update board transform based on offset and scale
function updateBoardTransform() {
    const board = document.getElementById('board');
    board.style.transform = `translate(${boardOffset.x}px, ${boardOffset.y}px) scale(${scale})`;
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
        
        // Draw arrowhead
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
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    
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
        // Update existing note
        const noteId = currentEditId;
        const existingNote = notes.find(n => n.id === noteId);
        if (existingNote) {
            existingNote.text = text;
            existingNote.note = note;
            existingNote.tags = tags;
        }
        currentEditId = null;
    } else {
        // Create new note at a non-overlapping position
        const position = getNonOverlappingPosition();
        const newNote = {
            id: Date.now(),
            text,
            note,
            tags,
            x: position.x,
            y: position.y
        };
        notes.push(newNote);
    }
    
    renderNotes();
    updateEmptyState();
    hideNoteModal();
    saveToStorage(); // Save the changes
}

// Delete note
function deleteNote(noteId) {
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    notes = notes.filter(n => n.id !== noteId);
    connections = connections.filter(conn => 
        conn.from !== noteId && conn.to !== noteId
    );
    
    renderNotes();
    updateEmptyState();
    saveToStorage(); // Save the changes
}

// Save layout
function saveLayout() {
    saveToStorage();
    alert('Layout saved successfully! Your note positions and view settings have been preserved.');
}

// Reset layout
function resetLayout() {
    if (!confirm('Are you sure you want to reset the layout? This will rearrange all notes.')) return;
    
    // Reset board position and zoom
    boardOffset = { x: 0, y: 0 };
    scale = 1;
    updateBoardTransform();
    
    // Spread out notes in a grid
    const noteWidth = 250;
    const noteHeight = 200;
    const padding = 20;
    
    notes.forEach((note, index) => {
        const gridSize = Math.ceil(Math.sqrt(notes.length));
        note.x = 50 + (index % gridSize) * (noteWidth + padding);
        note.y = 50 + Math.floor(index / gridSize) * (noteHeight + padding);
    });
    
    renderNotes();
    saveToStorage(); // Save the new layout
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