"use strict";

const runTests = process.argv.includes("--tests");
const outputTestCase = process.argv.includes("--generateTests");
console.log("Testing : ", runTests);

const http = require("http");
const ws = require("ws");

const fs = require("fs");
const lobbyModule = require("./lobby.js");
const testModule = require("./tests.js");

const {renderFile} = require('node-html-templates')(__dirname)

if (runTests) {
	lobbyModule.handleInit = (game) => testModule.handleInit(game);
}


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
	png: {contentType : "image/png", plain : false},
}

const templateContent = (ct, templateFile, keys) => {
	return {
		contentType : ct.contentType,
		plain : true,
		template : true,
		templateFile : templateFile,
		keys : keys
	}
}


let folderContent = {
	"/index.html" : contentTypes.html,
	"/main.css" : contentTypes.css,
	"/index.js" : contentTypes.js,
	"/favicon.ico" : contentTypes.icon,
	"/lobby.html" : templateContent(contentTypes.html, "/lobby.ejs", {game : '?'}),
	"/T8.html" : templateContent(contentTypes.html, "/lobby2.ejs", {gameId : "T8", jsFile : "T8.mjs"}),
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
	const params = new URLSearchParams(req.url.split('?')[1]);
	const resObj = findFile(req.url);
	if (resObj.status == 200) {
		if (resObj.template) {
			const keys = {};
			Object.entries(resObj.keys).forEach(([key, val]) => {
				keys[key] = val == '?' ? params.get(key) : val;
			});
			console.log(keys);
			res.writeHead(200, {'Content-Type' : resObj.contentType});
			res.write(renderFile("./content" + resObj.templateFile, keys));
			res.end();
		} else if (resObj.plain) {
			fs.readFile("./content" + resObj.url, "utf8", (err, data) => {
				if (err) {
					sendError(res, 500);
				} else {
					res.writeHead(200, {'Content-Type' : resObj.contentType});
					res.write(data);
					res.end();
				}
			});
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

server.listen(port, () => {
	console.log(`Server running at http://${hostname}:${port}/`);
});

const socketServer = new ws.WebSocketServer({server : server});

const UNIDENTIFIED = 0, IN_LOBBY = 1, IN_GAME = 2;

let connectedCount = 0;

socketServer.on("connection", (socket, req) => {
	socket.player = {
		status : UNIDENTIFIED, 
		send : (str) => {
			if (outputTestCase) {
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
		if (socket.player.status == UNIDENTIFIED) {
			if (!isValidMsg(data, ["gameId", "name"])) {
				socket.close(1000, "Invalid message");
				return;
			}
			lobbyModule.joinLobby(data, socket);
		} else {
			if (!isValidMsg(data, ["action"])) {
				socket.close(1000, "Invalid message");
			}
			socket.game.handleMessage(data, socket.game, socket.player);		
		}
		if (outputTestCase && socket.player.status != UNIDENTIFIED) {
			const fileName = `logs/${socket.game.id}_server.log`;
			fs.writeFile(fileName, `{id : ${socket.player.id}, toSend: ${JSON.stringify(data)}}\n`, { flag: 'a+' }, err => {});
		}
	});
	socket.on("close", (code, reason) => {
		connectedCount--;
		if (socket.player.status != UNIDENTIFIED) {
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