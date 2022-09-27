"use strict";

const createDeck = () => {
	let deck = [];
	for (const number of "A23456789JQK") {
		for (const color of "SCDH") {
			deck.push(number + color);
		}
	}
	return deck;
}

const shuffleDeck = (deck) => {
    for (let i = deck.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        let temp = deck[i];
        deck[i] = deck[j];
        deck[j] = temp;
    }
}

const drawCard = (game) => {
	const c = game.deck.pop();
	if (game.deck.length == 0) {
		const topCard = pile.pop();
		game.deck = game.pile;
		game.pile = [topCard];
		shuffleDeck(game.deck);
	}
	return c;
};


const handleT8Message = (data, socket) => {
	switch (data.action) {
		case "Start" :
			break; // If several players start at the same time this event could get here.
		case "Place" : {
			if (socket.gameData.chooseColor) {
				socket.close(1000, "You should choose a color");
				return;
			}
			if (socket.gameData.id != socket.game.turn) {
				socket.close(1000, "Not your turn!");
				return;
			}
			if (!Array.isArray(data.cards)) {
				socket.close(1000, "Bad message");
			}
			

			const cardNr = data.cards[0][0];
			for(let j = 0; j < data.cards.length; j++) {
				if (!data.cards[j] in socket.gameData.hand) {
					socket.close(1000, "Played card not in hand");
					return;
				}
				if (data.cards[j][0] != cardNr) {
					socket.close(1000, "Missmatching cards played");
				}
			}
			const hand = []; // Get remaining hand
			for (let i = 0; i < socket.gameData.hand.length; i++) {
				if (!socket.gameData.hand[i] in data.cards) {
					hand.push(socket.gameData.hand[i]);
				}
			}
			let topCard = socket.game.pile[socket.game.pile.length - 1];
			let color = game.color;		
			if (cardNr == '8') {
				if (data.cards.length > 1) {
					socket.close(1000, "Multiple 8:ths played");
					return;
				}
				if (hand.length == 0) {
					socket.close(1000, "Cannot win on an 8");
					return;
				}
				for (let i = 0; i < hand.length; i++) {
					if (hand[i][0] == '8') continue;
					if (cardNr == topCard[0] || hand[i][1] == socket.game.color) {
						socket.close(1000, "Not a valid 8 play");
					}
				}
				socket.gameData.chooseColor = true;
			} else {
				for (let i = 0; i < data.cards.length; i++) {
					if (cardNr != topCard[0] && data.cards[i][1] != color) {
						socket.close(1000, "Not a valid move");
						return;
					} 
					topCard = data.cards[i];
					color = topCard[1];
				}
			}
			if (hand.length == 0 && cardNr == 'A') {
				socket.close(1000, "Cannot win on an Ace");
				return;
			}

			//Now the move is validated...
			//Now real changes to game can happen
			socket.game.color = color;
			socket.gameData.hand = hand;
			for (let i = 0; i < data.cards.length; i++) {
				socket.game.pile.push(data.cards[i]);
			}

			if (cardNr != 'A' && cardNr != '8') {
				socket.game.turn = (socket.game.turn + 1) % socket.game.players.length;
			}
			const playedCardsStr = `[${data.cards.map(c => '"' + c + '"')}]`;
			socket.game.players.forEach((player, index) => {
				let newCards = [];
				if (cardNr == 'A' && index != socket.game.turn) {
					for(let i = 0; i < data.cards.length; i++) {
						const card = drawCard(game);
						player.gameData.hand.push(card);
						newCards.push(`"${card}"`);
					}
				}
				socket.send(`{"event" : "Place", "Cards" : ${playedCardsStr}, "NewCards" : [${newCards}]}`);
			});
			break;
		}
		case "ChooseColor": {
			if (!socket.gameData.chooseColor) {
				socket.close(1000, "Not a valid message");
				return;
			}
			if (!(data.color == "S" || data.color == "C" || data.color == "D" || data.color == "H")) {
				socket.close(1000, "Not a valid color");
				return;
			} 
			socket.gameData.chooseColor = false;
			socket.game.color = data.color;
			socket.game.turn = (socket.game.turn + 1) % socket.game.players.length;
			socket.game.players.forEach((player) => {
				socket.send(`{"event" : "ChooseColor", "${data.color}"}`);
			});
			break;
		}
		case "Draw" : {
			if (socket.gameData.id != turn) {
				socket.close(1000, "Not your turn");
				return;
			}
			const topCard = socket.game.pile[socket.game.pile.length - 1];
			for (let i = 0; i < socket.gameData.hand.length; i++) {
				const card = socket.gameData.hand[i];
				if (card[0] == '8' || card[0] == topCard[0] || card[1] == socket.game.color) {
					socket.close(1000, "Only draw when no legal move exists");
					return;
				}
			}
			const newCard = drawCard(socket.game);
			socket.gameData.draws++;
			if (socket.gameData.draws == 3 && newCard[0] != topCard[0] && newCard[1] != socket.game.color) {
				socket.game.turn = (socket.game.turn + 1) % socket.game.players.length;
			}
			for (let i = 0; i < socket.game.players.length; i++) {
				if (i == socket.gameData.id) continue;
				socket.game.players[i].send(`{"event" : "DrawOther"}`);
			}
			socket.send(`{"event" : "DrawSelf", "Card" : "${newCard}"}`);
			break;
		}
	}

};

let handleT8Init = (game) => {
	game.deck = createDeck();
	game.turn = 0;
	let index = 0;
	while (game.deck[index][0] == 'A' || game.deck[index][0] == '8') {
		index++;
	}
	shuffleDeck(game.deck);
	game.pile = game.deck.splice(index, 1);
	game.color = game.pile[0][1];
	game.players.forEach((player) => {
		player.gameData.hand = [];
		player.gameData.chooseColor = false;
		player.gameData.draws = 0;
		for (let j =0 ; j < 7; j++) {
			player.gameData.hand.push(game.deck.pop());
		}
		player.send(`{"event" : "start", "topCard" : "${game.pile[0]}", "hand" : [${player.gameData.hand.map(c => '"'+ c + '"')}]}`);
	});
};

const handleT8Close = (socket) => {
	const topCard = socket.game.pile.pop();
	socket.game.pile.push(...socket.gameData.hand, topCard);
	socket.game.players.splice(socket.gameData.id, 1);
	for (let i = 0; i < socket.game.players.length; i++) {
		socket.game.players[i].send(`{"event" : "leave", "id" : ${socket.gameData.id}}`);
		if (socket.game.players[i].gameData.id != i) {
			socket.game.players[i].gameData.id = i;
		}
	}
	socket.game.turn = socket.game.turn % socket.game.players.length;
};





const UNIDENTIFIED = 0, IN_LOBBY = 1, IN_GAME = 2;

const game = {
	createGame : (lobby) => {
		let game = {players : lobby.players};
		lobby.players = [];
		switch (lobby.gameName) {
			case "T8":
				game.handleMessage = handleT8Message;
				game.handleClose = handleT8Close;
				game.handleInit = handleT8Init;
				break;
		}
		game.players.forEach((socket) => {
			socket.gameData.lobby = undefined;
			socket.game = game;
			socket.gameData.status = IN_GAME;
		});
		game.handleInit(game);
	} 
};

module.exports = game;