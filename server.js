"use strict";

const runTests = process.argv.includes("--tests");
const outputTestCase = process.argv.includes("--generateTests");
console.log("Testing : ", runTests);

const http = require("http");
const ws = require("ws");

const fs = require("fs");
const gameModule = require("./game.js");
const testModule = require("./tests.js");

const {renderFile} = require('node-html-templates')(__dirname)

const hostname = "127.0.0.1";
const port = 3000;

const errors = {
	400 : "Bad Request",
	404 : "File Not Found",
	405 : "Method Not Allowed",
	500 : "Internal Server Error",
	501 : "Not Implemented"
};

const contentTypes = {
	html : {contentType : "text/html", plain : true},
	css :{contentType : "text/css", plain : true},
	js : {contentType : "text/javascript", plain : true},
	icon : {contentType : "image/x-icon", plain : false},
	svg : {contentType : "image/svg+xml", plain : true},
	png: {contentType : "image/png", plain : false}
}


let folderContent = {
	"/index.html" : contentTypes.html,
	"/main.css" : contentTypes.css,
	"/index.js" : contentTypes.js,
	"/favicon.ico" : contentTypes.icon,
	"/lobby.html" : contentTypes.html,
	"/lobby.js" : contentTypes.js,
	"/T8.mjs" : contentTypes.js,
	"/cards/S.svg" : contentTypes.svg,
	"/cards/D.svg" : contentTypes.svg,
	"/cards/C.svg" : contentTypes.svg,
	"/cards/H.svg" : contentTypes.svg,
	"/cards/Card_back.svg" : contentTypes.svg
};


for (const number of "A23456789JQK") {
	for (const color of "SCDH") {
		folderContent[`/cards/${number}${color}.svg`] = contentTypes.svg;
	}
}

const findFile = (url) => {
	url = url.split("?")[0];
	if (url == '/') {
		return {status : 200, url : "/index.html", contentType : "text/html", plain : true};
	}
	if (url.endsWith('/')) {
		return {status : 301, url : url.slice(0, -1)};
	}
	for (const key in folderContent) {
		if (key == url) {
			return {status : 200, url : key, ...folderContent[key]};
		}
	}
	return {status : 404};
};

const sendError = (res, code, msg = errors[code]) => {
	res.writeHead(code);
	res.write(msg);
	res.end();
};

const handleGet = (req, res) => {
	const gameId = new URLSearchParams(req.url.split('?')[1]).get('game');
	const resObj = findFile(req.url);
	if (resObj.status == 200) {
		if (resObj.plain) {
			if(gameId) {
				res.writeHead(200, {'Content-Type' : resObj.contentType});
				res.write(renderFile("./content" + resObj.url.split('.')[0] + ".ejs", {gameId: gameId}));
				res.end();
			}
			else {
				fs.readFile("./content" + resObj.url, "utf8", (err, data) => {
					if (err) {
						sendError(res, 500);
					} else {
						res.writeHead(200, {'Content-Type' : resObj.contentType});
						res.write(data);
						res.end();
					}
				});
			}
		} else {
			fs.createReadStream("./content" + resObj.url).pipe(res);
		}
	} else if (resObj.status == 301) {
		res.writeHead(301, {location : resObj.url});
		res.end();
	} else if (resObj.status == 404) {
		sendError(res, 404);
	} else {
		sendError(res, 500, "Unreachable");
	}
};

const isValidMsg = (msg, requiredKeys) => {
	for (const key of requiredKeys) {
		if (msg[key] == undefined) return false;
	}
	return true;
};

const server = http.createServer((req, res) => {
	console.log(req.url);
	if (req.method == "GET") {
		handleGet(req, res);
	} else {
		sendError(res, 501);
	}
});

/*
	//lobby object -- one per game type
	game[game] = {
		minPlayers : minimum number of players
		maxPlayers : maximum number of players
		players : list of sockets
	}

    socket.game = {
		status : UNIDENTIFIED or IN_LOBBY or IN_GAME
		id : index in lobby.players
		name : name string,
		lobby : lobby object for relevant game, undefined while IN_GAME
		
	//game object -- many per game (in theory)
	{
		players : list of sockets,
		handleMessage : function(data, socket), 
		handleClose : function(socket),
		..game data unique to each game
	}
 }
 */
server.listen(port, () => {
	console.log(`Server running at http://${hostname}:${port}/`);
});

const socketServer = new ws.WebSocketServer({server : server});

const games = {
	"T8" : {
		gameName : "T8",
		minPlayers : 2,
		maxPlayers : 5,
		id : 0,
		players : []
	}
};

const UNIDENTIFIED = 0, IN_LOBBY = 1, IN_GAME = 2;

let connectedCount = 0;


const messageInLobby = (data, socket) => {
	if (!isValidMsg(data, ["action"])) {
		socket.close(1000, "Invalid message");
		return;
	}
	if (data.action == "Leave") {
		socket.close(1000, "Left game");
		return;
	}
	if (data.action == "Start") {
		if (socket.player.lobby.players.length >= socket.player.lobby.minPlayers) {
			gameModule.createGame(socket.player.lobby);
			if (runTests) {
				testModule.handleInit(socket.game);
			} else {
				socket.game.handleInit(socket.game);
			}
		}
		return;
	}
	socket.close(1000, "Invalid message");
};

const messageUnidentified = (data, socket) => {
	if (!isValidMsg(data, ["gameId", "name"])) {
		socket.close(1000, "Invalid message");
		return;
	}
	if (data.gameId.length != 2 || data.name.length > 20) {
		socket.close(1000, "TMI");
		return;
	}

	let lobby = undefined;
	for (let gameName in games) {
		if (gameName == data.gameId) {
			lobby = games[gameName];
			break;
		}
	}
	if (lobby == undefined) {
		socket.close(1000, "Invalid game");
		return;
	}
	if (lobby.players.length == lobby.maxPlayers) {
		socket.close(1000, "Lobby is full");
		return;
	}

	socket.player.id = lobby.players.length;
	socket.player.name = data.name;
	socket.player.status = IN_LOBBY;
	socket.player.lobby = lobby;
	socket.game = {id : lobby.gameName + '_' + lobby.id};

	const names = lobby.players.map(s => `"${s.player.name}"`);
	for (let i = 0; i < lobby.players.length; i++) {
		lobby.players[i].send(`{"event" : "join", "name" : "${socket.player.name}", "id" : ${socket.player.id}}`);
	}
	socket.send(`{"event" : "joined", "players" : [${names}]}`);
	lobby.players.push(socket);
}


socketServer.on("connection", (socket, req) => {
	socket.player = {
		status : UNIDENTIFIED, 
		send : (str) => {
			if (outputTestCase && socket.player.status != UNIDENTIFIED) {
				const fileName = `logs/${socket.game.id}_${socket.player.id}.log`;
				fs.writeFile(fileName, str + '\n', { flag: 'a+' }, err => {});
			}
			socket.send(str)
		}, 
		close : (n, r) => socket.close(n, r)
	};
	connectedCount++;
	socket.on("message", (msg) => {
		let data;
		try {
			data = JSON.parse(msg);
		} catch (err) {
			socket.close(1000, "Bad message");
			return;
		}
		console.log(data);
		switch (socket.player.status) {
			case UNIDENTIFIED:
				messageUnidentified(data, socket);
				break;
			case IN_LOBBY:
				messageInLobby(data, socket);
				break;
			case IN_GAME:
				if (!isValidMsg(data, ["action"])) {
					socket.close(1000, "Invalid message");
				}
				socket.game.handleMessage(data, socket.game, socket.player);
				break;
		}
		if (outputTestCase && socket.player.status != UNIDENTIFIED) {
			const fileName = `logs/${socket.game.id}_server.log`;
			fs.writeFile(fileName, `{id : ${socket.player.id}, toSend: ${JSON.stringify(data)}}\n`, { flag: 'a+' }, err => {});
		}
	});
	socket.on("close", (code, reason) => {
		connectedCount--;
		if (socket.player.status == IN_LOBBY) {
			socket.player.lobby.players.splice(socket.player.id, 1);
			for (let i = 0; i < socket.player.lobby.players.length; i++) {
				socket.player.lobby.players[i].send(`{"event" : "leave", "id" : ${socket.player.id}}`);
				if (socket.player.lobby.players[i].player.id != i) {
					socket.player.lobby.players[i].player.id = i;
				}
			}
		} else if (socket.player.status == IN_GAME) {
			socket.game.handleClose(socket.game, socket.player);
		}
		console.log(`${socket.player.name ? socket.player.name : "Someone"} left, ${connectedCount} remaining`);
	});
});

if (runTests) {
	(async () => {
		await testModule.general();
		process.exit(0);
	})();
}