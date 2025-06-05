class ChessGame {
    constructor() {
        this.board = [];
        this.currentPlayer = 'white';
        this.selectedSquare = null;
        this.gameOver = false;
        this.capturedPieces = { white: [], black: [] };
        this.kingPositions = { white: [7, 4], black: [0, 4] };

        // Configuración online
        this.gameMode = 'local'; // 'local' o 'online'
        this.playerColor = null; // 'white' o 'black' en modo online
        this.roomCode = null;
        this.playerId = this.generatePlayerId();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;

        // Piezas Unicode
        this.pieces = {
            white: {
                king: '♔', queen: '♕', rook: '♖',
                bishop: '♗', knight: '♘', pawn: '♙'
            },
            black: {
                king: '♚', queen: '♛', rook: '♜',
                bishop: '♝', knight: '♞', pawn: '♟'
            }
        };

        this.initializeBoard();
        this.createBoardDisplay();
        this.attachEventListeners();
        this.updateDisplay();
    }

    initializeBoard() {
        // Inicializar tablero vacío
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));

        // Colocar piezas negras
        this.board[0] = [
            {type: 'rook', color: 'black'}, {type: 'knight', color: 'black'},
            {type: 'bishop', color: 'black'}, {type: 'queen', color: 'black'},
            {type: 'king', color: 'black'}, {type: 'bishop', color: 'black'},
            {type: 'knight', color: 'black'}, {type: 'rook', color: 'black'}
        ];

        this.board[1] = Array(8).fill(null).map(() => ({type: 'pawn', color: 'black'}));

        // Colocar piezas blancas
        this.board[6] = Array(8).fill(null).map(() => ({type: 'pawn', color: 'white'}));

        this.board[7] = [
            {type: 'rook', color: 'white'}, {type: 'knight', color: 'white'},
            {type: 'bishop', color: 'white'}, {type: 'queen', color: 'white'},
            {type: 'king', color: 'white'}, {type: 'bishop', color: 'white'},
            {type: 'knight', color: 'white'}, {type: 'rook', color: 'white'}
        ];
    }

    createBoardDisplay() {
        const boardElement = document.getElementById('chess-board');
        boardElement.innerHTML = '';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;

                const piece = this.board[row][col];
                if (piece) {
                    square.textContent = this.pieces[piece.color][piece.type];
                    square.classList.add('piece');
                }

                boardElement.appendChild(square);
            }
        }
    }

    attachEventListeners() {
        const boardElement = document.getElementById('chess-board');
        boardElement.addEventListener('click', (e) => this.handleSquareClick(e));

        const resetButton = document.getElementById('reset-btn');
        resetButton.addEventListener('click', () => this.resetGame());

        // Event listeners para modo online
        const localModeBtn = document.getElementById('local-mode-btn');
        const onlineModeBtn = document.getElementById('online-mode-btn');
        const createRoomBtn = document.getElementById('create-room-btn');
        const joinRoomBtn = document.getElementById('join-room-btn');
        const copyRoomBtn = document.getElementById('copy-room-btn');
        const leaveRoomBtn = document.getElementById('leave-room-btn');

        localModeBtn.addEventListener('click', () => this.switchToLocalMode());
        onlineModeBtn.addEventListener('click', () => this.switchToOnlineMode());
        createRoomBtn.addEventListener('click', () => this.createRoom());
        joinRoomBtn.addEventListener('click', () => this.joinRoom());
        copyRoomBtn.addEventListener('click', () => this.copyRoomCode());
        leaveRoomBtn.addEventListener('click', () => this.leaveRoom());
    }

    handleSquareClick(e) {
        if (this.gameOver) return;

        // En modo online, solo permitir movimientos si es tu turno
        if (this.gameMode === 'online') {
            if (!this.playerColor || this.currentPlayer !== this.playerColor) {
                return;
            }
        }

        const square = e.target.closest('.square');
        if (!square) return;

        const row = parseInt(square.dataset.row);
        const col = parseInt(square.dataset.col);

        if (this.selectedSquare) {
            if (this.selectedSquare.row === row && this.selectedSquare.col === col) {
                // Deseleccionar
                this.selectedSquare = null;
                this.clearHighlights();
            } else {
                // Intentar mover
                this.attemptMove(this.selectedSquare.row, this.selectedSquare.col, row, col);
            }
        } else {
            // Seleccionar pieza
            const piece = this.board[row][col];
            if (piece && piece.color === this.currentPlayer) {
                // En modo online, solo permitir seleccionar piezas de tu color
                if (this.gameMode === 'online' && piece.color !== this.playerColor) {
                    return;
                }
                this.selectedSquare = { row, col };
                this.highlightSquare(row, col);
                this.showValidMoves(row, col);
            }
        }
    }

    attemptMove(fromRow, fromCol, toRow, toCol) {
        if (this.isValidMove(fromRow, fromCol, toRow, toCol)) {
            const moveData = {
                from: { row: fromRow, col: fromCol },
                to: { row: toRow, col: toCol },
                piece: this.board[fromRow][fromCol],
                capturedPiece: this.board[toRow][toCol]
            };

            this.makeMove(fromRow, fromCol, toRow, toCol);
            this.selectedSquare = null;
            this.clearHighlights();
            this.switchPlayer();
            this.updateDisplay();
            this.checkGameStatus();

            // Enviar movimiento en modo online
            if (this.gameMode === 'online' && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.sendMove(moveData);
            }
        } else {
            this.selectedSquare = null;
            this.clearHighlights();
        }
    }

    isValidMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        if (!piece || piece.color !== this.currentPlayer) return false;

        const targetPiece = this.board[toRow][toCol];
        if (targetPiece && targetPiece.color === piece.color) return false;

        if (!this.isValidPieceMove(fromRow, fromCol, toRow, toCol)) return false;

        // Verificar si el movimiento deja al rey en jaque
        return !this.wouldBeInCheck(fromRow, fromCol, toRow, toCol);
    }

    isValidPieceMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;

        switch (piece.type) {
            case 'pawn':
                return this.isValidPawnMove(fromRow, fromCol, toRow, toCol, piece.color);
            case 'rook':
                return this.isValidRookMove(fromRow, fromCol, toRow, toCol);
            case 'bishop':
                return this.isValidBishopMove(fromRow, fromCol, toRow, toCol);
            case 'queen':
                return this.isValidQueenMove(fromRow, fromCol, toRow, toCol);
            case 'king':
                return this.isValidKingMove(fromRow, fromCol, toRow, toCol);
            case 'knight':
                return this.isValidKnightMove(fromRow, fromCol, toRow, toCol);
            default:
                return false;
        }
    }

    isValidPawnMove(fromRow, fromCol, toRow, toCol, color) {
        const direction = color === 'white' ? -1 : 1;
        const startRow = color === 'white' ? 6 : 1;
        const rowDiff = toRow - fromRow;
        const colDiff = Math.abs(toCol - fromCol);

        // Movimiento hacia adelante
        if (colDiff === 0) {
            if (rowDiff === direction && !this.board[toRow][toCol]) {
                return true;
            }
            if (fromRow === startRow && rowDiff === 2 * direction && !this.board[toRow][toCol]) {
                return true;
            }
        }

        // Captura diagonal
        if (colDiff === 1 && rowDiff === direction && this.board[toRow][toCol]) {
            return true;
        }

        return false;
    }

    isValidRookMove(fromRow, fromCol, toRow, toCol) {
        if (fromRow !== toRow && fromCol !== toCol) return false;
        return this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidBishopMove(fromRow, fromCol, toRow, toCol) {
        if (Math.abs(toRow - fromRow) !== Math.abs(toCol - fromCol)) return false;
        return this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidQueenMove(fromRow, fromCol, toRow, toCol) {
        return this.isValidRookMove(fromRow, fromCol, toRow, toCol) ||
               this.isValidBishopMove(fromRow, fromCol, toRow, toCol);
    }

    isValidKingMove(fromRow, fromCol, toRow, toCol) {
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        return rowDiff <= 1 && colDiff <= 1;
    }

    isValidKnightMove(fromRow, fromCol, toRow, toCol) {
        const rowDiff = Math.abs(toRow - fromRow);
        const colDiff = Math.abs(toCol - fromCol);
        return (rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2);
    }

    isPathClear(fromRow, fromCol, toRow, toCol) {
        const rowDir = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
        const colDir = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;

        let row = fromRow + rowDir;
        let col = fromCol + colDir;

        while (row !== toRow || col !== toCol) {
            if (this.board[row][col]) return false;
            row += rowDir;
            col += colDir;
        }

        return true;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const capturedPiece = this.board[toRow][toCol];

        // Capturar pieza si existe
        if (capturedPiece) {
            this.capturedPieces[capturedPiece.color].push(capturedPiece);
        }

        // Actualizar posición del Rey
        if (piece.type === 'king') {
            this.kingPositions[piece.color] = [toRow, toCol];
        }

        // Mover pieza
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        // Actualizar display
        this.createBoardDisplay();
        this.updateCapturedPieces();
    }

    wouldBeInCheck(fromRow, fromCol, toRow, toCol) {
        // Simular el movimiento
        const piece = this.board[fromRow][fromCol];
        const capturedPiece = this.board[toRow][toCol];
        const originalKingPos = [...this.kingPositions[piece.color]];

        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        if (piece.type === 'king') {
            this.kingPositions[piece.color] = [toRow, toCol];
        }

        const inCheck = this.isInCheck(piece.color);

        // Restaurar posición
        this.board[fromRow][fromCol] = piece;
        this.board[toRow][toCol] = capturedPiece;
        this.kingPositions[piece.color] = originalKingPos;

        return inCheck;
    }

    isInCheck(color) {
        const [kingRow, kingCol] = this.kingPositions[color];
        const opponentColor = color === 'white' ? 'black' : 'white';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.color === opponentColor) {
                    if (this.isValidPieceMove(row, col, kingRow, kingCol)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    showValidMoves(row, col) {
        for (let toRow = 0; toRow < 8; toRow++) {
            for (let toCol = 0; toCol < 8; toCol++) {
                if (this.isValidMove(row, col, toRow, toCol)) {
                    const square = document.querySelector(`[data-row="${toRow}"][data-col="${toCol}"]`);
                    if (this.board[toRow][toCol]) {
                        square.classList.add('capture-move');
                    } else {
                        square.classList.add('valid-move');
                    }
                }
            }
        }
    }

    highlightSquare(row, col) {
        const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        square.classList.add('selected');
    }

    clearHighlights() {
        document.querySelectorAll('.square').forEach(square => {
            square.classList.remove('selected', 'valid-move', 'capture-move');
        });
    }

    switchPlayer() {
        this.currentPlayer = this.currentPlayer === 'white' ? 'black' : 'white';
    }

    checkGameStatus() {
        const inCheck = this.isInCheck(this.currentPlayer);
        const hasValidMoves = this.hasValidMoves(this.currentPlayer);

        if (inCheck) {
            this.highlightKingInCheck();
            if (!hasValidMoves) {
                this.gameOver = true;
                const winner = this.currentPlayer === 'white' ? 'Negras' : 'Blancas';
                document.getElementById('game-status').textContent = `¡Jaque Mate! Ganan las ${winner}`;
                return;
            } else {
                document.getElementById('game-status').textContent = '¡Jaque!';
                return;
            }
        } else if (!hasValidMoves) {
            this.gameOver = true;
            document.getElementById('game-status').textContent = '¡Tablas por ahogado!';
            return;
        }

        document.getElementById('game-status').textContent = 'Juego en curso';
        this.clearKingHighlight();
    }

    hasValidMoves(color) {
        for (let fromRow = 0; fromRow < 8; fromRow++) {
            for (let fromCol = 0; fromCol < 8; fromCol++) {
                const piece = this.board[fromRow][fromCol];
                if (piece && piece.color === color) {
                    for (let toRow = 0; toRow < 8; toRow++) {
                        for (let toCol = 0; toCol < 8; toCol++) {
                            if (this.isValidMove(fromRow, fromCol, toRow, toCol)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    highlightKingInCheck() {
        const [kingRow, kingCol] = this.kingPositions[this.currentPlayer];
        const kingSquare = document.querySelector(`[data-row="${kingRow}"][data-col="${kingCol}"]`);
        kingSquare.classList.add('in-check');
    }

    clearKingHighlight() {
        document.querySelectorAll('.in-check').forEach(square => {
            square.classList.remove('in-check');
        });
    }

    updateDisplay() {
        const playerText = this.currentPlayer === 'white' ? 'Blancas' : 'Negras';
        document.getElementById('current-player').textContent = playerText;
    }

    updateCapturedPieces() {
        const whiteContainer = document.getElementById('captured-white');
        const blackContainer = document.getElementById('captured-black');

        whiteContainer.innerHTML = this.capturedPieces.white
            .map(piece => `<span class="captured-piece">${this.pieces[piece.color][piece.type]}</span>`)
            .join('');

        blackContainer.innerHTML = this.capturedPieces.black
            .map(piece => `<span class="captured-piece">${this.pieces[piece.color][piece.type]}</span>`)
            .join('');
    }

    resetGame() {
        this.board = [];
        this.currentPlayer = 'white';
        this.selectedSquare = null;
        this.gameOver = false;
        this.capturedPieces = { white: [], black: [] };
        this.kingPositions = { white: [7, 4], black: [0, 4] };

        this.initializeBoard();
        this.createBoardDisplay();
        this.updateDisplay();
        this.updateCapturedPieces();
        this.clearHighlights();
        this.clearKingHighlight();

        document.getElementById('game-status').textContent = 'Juego en curso';

        // Enviar reset en modo online
        if (this.gameMode === 'online' && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'reset',
                roomCode: this.roomCode,
                playerId: this.playerId
            }));
        }
    }

    // ========== MÉTODOS PARA FUNCIONALIDAD ONLINE ==========

    generatePlayerId() {
        return Math.random().toString(36).substr(2, 9);
    }

    generateRoomCode() {
        return Math.random().toString(36).substr(2, 6).toUpperCase();
    }

    switchToLocalMode() {
        this.gameMode = 'local';
        this.playerColor = null;

        document.getElementById('local-mode-btn').classList.add('active');
        document.getElementById('online-mode-btn').classList.remove('active');
        document.getElementById('online-section').classList.add('hidden');

        if (this.ws) {
            this.ws.close();
        }

        this.resetGame();
    }

    switchToOnlineMode() {
        this.gameMode = 'online';

        document.getElementById('local-mode-btn').classList.remove('active');
        document.getElementById('online-mode-btn').classList.add('active');
        document.getElementById('online-section').classList.remove('hidden');

        this.updateConnectionStatus('Desconectado', false);
    }

    createRoom() {
        const customCode = document.getElementById('room-code').value.trim().toUpperCase();
        this.roomCode = customCode || this.generateRoomCode();

        this.connectToServer();

        document.getElementById('create-room-btn').disabled = true;
        document.getElementById('join-room-btn').disabled = true;
    }

    joinRoom() {
        const roomCode = document.getElementById('join-room-code').value.trim().toUpperCase();
        if (!roomCode) {
            alert('Por favor ingresa un código de sala');
            return;
        }

        this.roomCode = roomCode;
        this.connectToServer();

        document.getElementById('create-room-btn').disabled = true;
        document.getElementById('join-room-btn').disabled = true;
    }

    connectToServer() {
        this.updateConnectionStatus('Conectando...', false, true);

        // Simulación de servidor WebSocket (en producción sería un servidor real)
        // Para demo, usaremos localStorage para simular comunicación
        this.simulateWebSocketConnection();
    }

    simulateWebSocketConnection() {
        // Simulación de conexión WebSocket usando localStorage y eventos
        setTimeout(() => {
            this.updateConnectionStatus('Conectado', true);
            this.playerColor = this.getPlayerColor();
            this.showRoomInfo();

            // Simular eventos de WebSocket
            this.startLocalStorageSync();
        }, 1000);
    }

    getPlayerColor() {
        // Simulación: primer jugador es blanco, segundo es negro
        const roomData = this.getRoomData();
        if (!roomData.players) {
            roomData.players = [this.playerId];
            roomData.colors = { [this.playerId]: 'white' };
            this.saveRoomData(roomData);
            return 'white';
        } else if (roomData.players.length === 1 && !roomData.players.includes(this.playerId)) {
            roomData.players.push(this.playerId);
            roomData.colors[this.playerId] = 'black';
            this.saveRoomData(roomData);
            return 'black';
        } else {
            return roomData.colors[this.playerId];
        }
    }

    getRoomData() {
        const data = localStorage.getItem(`chess_room_${this.roomCode}`);
        return data ? JSON.parse(data) : { players: [], colors: {}, gameState: null };
    }

    saveRoomData(data) {
        localStorage.setItem(`chess_room_${this.roomCode}`, JSON.stringify(data));
        // Disparar evento para otros jugadores
        window.dispatchEvent(new CustomEvent('roomDataChanged', {
            detail: { roomCode: this.roomCode, data }
        }));
    }

    startLocalStorageSync() {
        // Escuchar cambios en el localStorage
        window.addEventListener('storage', (e) => {
            if (e.key === `chess_room_${this.roomCode}`) {
                this.handleRoomDataChange(JSON.parse(e.newValue));
            }
        });

        // Escuchar eventos personalizados para la misma pestaña
        window.addEventListener('roomDataChanged', (e) => {
            if (e.detail.roomCode === this.roomCode) {
                this.handleRoomDataChange(e.detail.data);
            }
        });
    }

    handleRoomDataChange(roomData) {
        if (roomData.gameState && roomData.gameState.lastMove) {
            const lastMove = roomData.gameState.lastMove;
            if (lastMove.playerId !== this.playerId) {
                this.receiveMove(lastMove);
            }
        }

        if (roomData.gameState && roomData.gameState.reset && roomData.gameState.resetBy !== this.playerId) {
            this.resetGame();
        }

        this.updatePlayersCount(roomData.players ? roomData.players.length : 1);
    }

    sendMove(moveData) {
        const roomData = this.getRoomData();
        roomData.gameState = {
            lastMove: {
                ...moveData,
                playerId: this.playerId,
                timestamp: Date.now()
            }
        };
        this.saveRoomData(roomData);
    }

    receiveMove(moveData) {
        const { from, to } = moveData;

        // Aplicar el movimiento recibido
        this.makeMove(from.row, from.col, to.row, to.col);
        this.switchPlayer();
        this.updateDisplay();
        this.checkGameStatus();

        // Highlight del movimiento recibido
        const fromSquare = document.querySelector(`[data-row="${from.row}"][data-col="${from.col}"]`);
        const toSquare = document.querySelector(`[data-row="${to.row}"][data-col="${to.col}"]`);

        fromSquare.classList.add('move-animation');
        toSquare.classList.add('move-animation');

        setTimeout(() => {
            fromSquare.classList.remove('move-animation');
            toSquare.classList.remove('move-animation');
        }, 500);
    }

    showRoomInfo() {
        document.getElementById('room-info').classList.remove('hidden');
        document.getElementById('current-room-code').textContent = this.roomCode;
        document.getElementById('player-color').textContent = this.playerColor === 'white' ? 'Blancas' : 'Negras';

        const roomData = this.getRoomData();
        this.updatePlayersCount(roomData.players ? roomData.players.length : 1);
    }

    updatePlayersCount(count) {
        document.getElementById('players-count').textContent = `${count}/2`;

        if (count === 2) {
            document.getElementById('game-status').textContent = '¡Ambos jugadores conectados! Puedes empezar a jugar.';
        } else {
            document.getElementById('game-status').textContent = 'Esperando al segundo jugador...';
        }
    }

    copyRoomCode() {
        navigator.clipboard.writeText(this.roomCode).then(() => {
            const button = document.getElementById('copy-room-btn');
            const originalText = button.textContent;
            button.textContent = '¡Copiado!';
            setTimeout(() => {
                button.textContent = originalText;
            }, 2000);
        });
    }

    leaveRoom() {
        if (this.ws) {
            this.ws.close();
        }

        // Limpiar datos de la sala
        localStorage.removeItem(`chess_room_${this.roomCode}`);

        this.roomCode = null;
        this.playerColor = null;

        document.getElementById('room-info').classList.add('hidden');
        document.getElementById('create-room-btn').disabled = false;
        document.getElementById('join-room-btn').disabled = false;
        document.getElementById('room-code').value = '';
        document.getElementById('join-room-code').value = '';

        this.updateConnectionStatus('Desconectado', false);
        this.switchToLocalMode();
    }

    updateConnectionStatus(text, connected, connecting = false) {
        document.getElementById('status-text').textContent = text;
        const statusDot = document.querySelector('.status-dot');

        statusDot.classList.remove('connected', 'connecting');

        if (connected) {
            statusDot.classList.add('connected');
        } else if (connecting) {
            statusDot.classList.add('connecting');
        }
    }
}

// Inicializar el juego cuando se carga la página
document.addEventListener('DOMContentLoaded', () => {
    new ChessGame();
});