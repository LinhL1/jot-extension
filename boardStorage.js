// Single source of truth for all chrome.storage.local access related to boards.
// All other files must call these functions instead of touching chrome.storage directly.
(function () {
    'use strict';

    var KEYS = {
        BOARDS: 'jotBoards',
        ACTIVE_ID: 'jotActiveBoardId',
        BOARD_DATA: 'jotBoardData'
    };

    function _newId() {
        return 'board_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }

    // Ensure the multi-board schema exists. If not, migrates the legacy single-board
    // data (readmarks/* keys) into a "My Board" entry marked legacy:true so that
    // content.js / popup.js continue reading/writing the same keys unchanged.
    // Safe to call multiple times — only writes on first run.
    function ensureBoardsInitialized(callback) {
        chrome.storage.local.get([KEYS.BOARDS, KEYS.ACTIVE_ID], function (result) {
            var boards = result[KEYS.BOARDS];
            if (boards && boards.length > 0) {
                callback(boards, result[KEYS.ACTIVE_ID] || boards[0].id);
                return;
            }
            var defaultBoard = {
                id: _newId(),
                name: 'My Board',
                createdAt: Date.now(),
                legacy: true
            };
            chrome.storage.local.set({
                jotBoards: [defaultBoard],
                jotActiveBoardId: defaultBoard.id
            }, function () {
                callback([defaultBoard], defaultBoard.id);
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

    window.JotBoardStorage = {
        ensureBoardsInitialized: ensureBoardsInitialized,
        getBoards: getBoards,
        setActiveBoardId: setActiveBoardId,
        createBoard: createBoard,
        renameBoard: renameBoard,
        deleteBoard: deleteBoard,
        loadBoardData: loadBoardData,
        saveBoardData: saveBoardData
    };
}());
