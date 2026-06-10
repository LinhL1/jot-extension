// Single source of truth for all chrome.storage.local access related to boards.
// All other files must call these functions instead of touching chrome.storage directly.
(function () {
    'use strict';

    // Stable, permanent ID for the Brain Dump board. Never changes, even across migrations.
    var BRAIN_DUMP_ID = 'brain-dump-default';

    var KEYS = {
        BOARDS: 'jotBoards',
        ACTIVE_ID: 'jotActiveBoardId',
        BOARD_DATA: 'jotBoardData'
    };

    function _newId() {
        return 'board_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    // Ensure the multi-board schema and the permanent Brain Dump board exist.
    // Handles three cases transparently:
    //   1. Fresh install — creates Brain Dump (legacy:true, id:BRAIN_DUMP_ID) as sole board.
    //   2. Already migrated — no-op, just calls back with existing state.
    //   3. Existing install with old random-ID legacy board — renames + re-IDs it as Brain Dump
    //      so legacy data (readmarks/*) stays untouched while the ID becomes stable.
    function ensureBoardsInitialized(callback) {
        chrome.storage.local.get([KEYS.BOARDS, KEYS.ACTIVE_ID], function (result) {
            var boards = result[KEYS.BOARDS];
            var activeId = result[KEYS.ACTIVE_ID];

            // Fresh install — no boards at all
            if (!boards || boards.length === 0) {
                var brainDump = {
                    id: BRAIN_DUMP_ID,
                    name: 'Brain Dump',
                    createdAt: Date.now(),
                    legacy: true
                };
                chrome.storage.local.set({
                    jotBoards: [brainDump],
                    jotActiveBoardId: BRAIN_DUMP_ID
                }, function () {
                    callback([brainDump], BRAIN_DUMP_ID);
                });
                return;
            }

            // Already has Brain Dump — nothing to migrate
            var hasBrainDump = boards.some(function (b) { return b.id === BRAIN_DUMP_ID; });
            if (hasBrainDump) {
                callback(boards, activeId || boards[0].id);
                return;
            }

            // Migration: find the legacy board and rebrand it as Brain Dump.
            // The underlying data (readmarks, jotStrokes, …) is untouched because
            // legacy boards are always loaded by key name, not by board ID.
            var legacyIdx = -1;
            for (var i = 0; i < boards.length; i++) {
                if (boards[i].legacy) { legacyIdx = i; break; }
            }

            if (legacyIdx < 0) {
                // No legacy board found — unusual but non-fatal; proceed as-is
                callback(boards, activeId || boards[0].id);
                return;
            }

            var oldId = boards[legacyIdx].id;
            var migrated = boards.map(function (b, idx) {
                if (idx !== legacyIdx) return b;
                return { id: BRAIN_DUMP_ID, name: 'Brain Dump', createdAt: b.createdAt, legacy: true };
            });
            var newActiveId = (activeId === oldId) ? BRAIN_DUMP_ID : (activeId || BRAIN_DUMP_ID);

            chrome.storage.local.set({
                jotBoards: migrated,
                jotActiveBoardId: newActiveId
            }, function () {
                callback(migrated, newActiveId);
            });
        });
    }

    function getBoards(callback) {
        chrome.storage.local.get([KEYS.BOARDS], function (result) {
            callback(result[KEYS.BOARDS] || []);
        });
    }

    function setActiveBoardId(boardId, callback) {
        chrome.storage.local.set({ jotActiveBoardId: boardId }, callback || function () {});
    }

    function createBoard(name, callback) {
        getBoards(function (boards) {
            var board = {
                id: _newId(),
                name: name || 'New Board',
                createdAt: Date.now(),
                legacy: false
            };
            var updated = boards.concat([board]);
            chrome.storage.local.set({ jotBoards: updated }, function () {
                callback(board, updated);
            });
        });
    }

    function renameBoard(boardId, newName, callback) {
        getBoards(function (boards) {
            var updated = boards.map(function (b) {
                return b.id === boardId
                    ? { id: b.id, name: newName, createdAt: b.createdAt, legacy: b.legacy }
                    : b;
            });
            chrome.storage.local.set({ jotBoards: updated }, function () {
                callback(updated);
            });
        });
    }

    function deleteBoard(boardId, callback) {
        getBoards(function (boards) {
            var board = boards.find(function (b) { return b.id === boardId; });
            var remaining = boards.filter(function (b) { return b.id !== boardId; });

            function finish() {
                chrome.storage.local.set({ jotBoards: remaining }, function () {
                    callback(remaining);
                });
            }

            if (!board) { finish(); return; }

            if (board.legacy) {
                chrome.storage.local.remove(
                    ['readmarks', 'readmarkConnections', 'brainViewSettings', 'jotStrokes'],
                    finish
                );
            } else {
                chrome.storage.local.get([KEYS.BOARD_DATA], function (res) {
                    var all = res[KEYS.BOARD_DATA] || {};
                    delete all[boardId];
                    chrome.storage.local.set({ jotBoardData: all }, finish);
                });
            }
        });
    }

    // callback receives { highlights, connections, viewSettings, strokes, legacy }
    function loadBoardData(boardId, callback) {
        getBoards(function (boards) {
            var board = boards.find(function (b) { return b.id === boardId; });
            var legacy = !!(board && board.legacy);

            if (legacy) {
                chrome.storage.local.get(
                    ['readmarks', 'readmarkConnections', 'brainViewSettings', 'jotStrokes'],
                    function (res) {
                        callback({
                            highlights: res.readmarks || [],
                            connections: res.readmarkConnections || [],
                            viewSettings: res.brainViewSettings || null,
                            strokes: res.jotStrokes || [],
                            legacy: true
                        });
                    }
                );
                return;
            }

            chrome.storage.local.get([KEYS.BOARD_DATA], function (res) {
                var all = res[KEYS.BOARD_DATA] || {};
                var data = all[boardId] || { highlights: [], connections: [], viewSettings: null, strokes: [] };
                callback({
                    highlights: data.highlights || [],
                    connections: data.connections || [],
                    viewSettings: data.viewSettings || null,
                    strokes: data.strokes || [],
                    legacy: false
                });
            });
        });
    }

    // isLegacy is passed explicitly so this hot path skips a getBoards round-trip.
    function saveBoardData(boardId, data, isLegacy, callback) {
        var done = callback || function () {};
        if (isLegacy) {
            chrome.storage.local.set({
                readmarks: data.highlights || [],
                readmarkConnections: data.connections || [],
                brainViewSettings: data.viewSettings || null,
                jotStrokes: data.strokes || []
            }, done);
            return;
        }
        chrome.storage.local.get([KEYS.BOARD_DATA], function (res) {
            var all = res[KEYS.BOARD_DATA] || {};
            all[boardId] = {
                highlights: data.highlights || [],
                connections: data.connections || [],
                viewSettings: data.viewSettings || null,
                strokes: data.strokes || []
            };
            chrome.storage.local.set({ jotBoardData: all }, done);
        });
    }

    // Append a single highlight to a board without overwriting other board data.
    // Used by the content-script capture flow and brain.js move/copy operations.
    function appendHighlightToBoard(boardId, isLegacy, highlight, callback) {
        var done = callback || function () {};
        if (isLegacy) {
            chrome.storage.local.get(['readmarks'], function (res) {
                var arr = (res.readmarks || []).slice();
                arr.push(highlight);
                chrome.storage.local.set({ readmarks: arr }, done);
            });
            return;
        }
        chrome.storage.local.get([KEYS.BOARD_DATA], function (res) {
            var all = res[KEYS.BOARD_DATA] || {};
            var bd = all[boardId] || { highlights: [], connections: [], viewSettings: null, strokes: [] };
            bd.highlights = (bd.highlights || []).slice();
            bd.highlights.push(highlight);
            all[boardId] = bd;
            chrome.storage.local.set({ jotBoardData: all }, done);
        });
    }

    // Duplicate a note into a target board, assigning a new unique ID to the copy.
    function copyNoteToBoard(note, toBoardId, toIsLegacy, callback) {
        var copy = {};
        for (var k in note) {
            if (Object.prototype.hasOwnProperty.call(note, k)) copy[k] = note[k];
        }
        copy.id = 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        appendHighlightToBoard(toBoardId, toIsLegacy, copy, callback || function () {});
    }

    window.JotBoardStorage = {
        BRAIN_DUMP_ID: BRAIN_DUMP_ID,
        ensureBoardsInitialized: ensureBoardsInitialized,
        getBoards: getBoards,
        setActiveBoardId: setActiveBoardId,
        createBoard: createBoard,
        renameBoard: renameBoard,
        deleteBoard: deleteBoard,
        loadBoardData: loadBoardData,
        saveBoardData: saveBoardData,
        appendHighlightToBoard: appendHighlightToBoard,
        copyNoteToBoard: copyNoteToBoard
    };
}());
