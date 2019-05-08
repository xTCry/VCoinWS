const WebSocket = require('ws'),
	SocksProxyAgent = require('socks-proxy-agent'),
	safeEval = require('safe-eval'),
	randomUseragent = require('random-useragent');

const _Window = require('window'),
	window = new _Window({
		url: 'https://vk.com/app6915965',
		userAgent: randomUseragent.getRandom(),
		host: 'coin-without-bugs.vkforms.ru',
	});

function OmyEval(pow) {
	let res = safeEval(pow, {
		window: {
			...window,
			WebSocket: true,
			Math, parseInt,
		}
	});

	return res;
}

class VCoinWS {

	constructor() {
		this.ws = null;
		this.ttl = null;
		this.retryTime = 1e3;
		this.onOnlineCallback = null;
		this.clickCount = 0;
		this.clickTimer = null;
		this.clickPacks = [];
		this.sendedPacks = 0;
		this.allowReconnect = true;
		this.randomId = null;
		this.oldPlace = null;
		this.oldScore = null;
		this.confirmScore = null;
		this.tick = 0;
		this.tickTtl = null;
		this.callbackForPackId = {};
		this.ccp = 10;
		this.connected = false;
		this.connecting = false;
		this.onConnectSend = [];
		this.tickCount = 0;
		this.wsServer = "";
		this.group_id = null;
		this.digits = [];
		this.tx = [];
	}

	run(wsServer, cb, options={ proxy: false }) {
		this.wsServer = wsServer || this.wsServer;
		this.selfClose();

		if(cb)
			this.onOnlineCallback = cb;

		try {

			if(options.proxy) {
				let agent = new SocksProxyAgent("socks5://127.0.0.1:9050");
				this.ws = new WebSocket(this.wsServer, { agent });
			}
			else
				this.ws = new WebSocket(this.wsServer);

			this.ws.onopen = _=> {
				this.connected = true;
				this.connecting = false;

				this.onConnectSend.forEach(e=> {
					if(this.ws)
						this.ws.send(e);
				});
				this.onConnectSend = [];

				for (let pid in this.callbackForPackId) {
					if(this.callbackForPackId.hasOwnProperty(pid) && this.ws) {
						this.ws.send(this.callbackForPackId[pid].str)
						clearTimeout(this.callbackForPackId[pid].ttl)

						this.callbackForPackId[pid].ttl = setTimeout(function() {
							this.callbackForPackId[pid].reject(new Error("TIMEOUT"))
							this.dropCallback(pid)
						}, 1e4)
					}
				};

				this.onOpen();
			};

			this.ws.onerror = e=> {
				console.error("Проблемы с подключением: ", e);
				this.reconnect(wsServer, true);
			}

			this.ws.onclose = _=> {
				this.connected = false;
				this.connecting = false;

				clearInterval(this.tickTtl);
				this.tickTtl = null;

				if(this.onOfflineCallback)
					this.onOfflineCallback();

				this.ws = null;

				this.reconnect(wsServer);
			};

			this.ws.onmessage = ({ data: msg })=> {
				
				if ("{" === msg[0]) {
					let data = JSON.parse(msg);

					if ("INIT" === data.type) {

						let score = data.score,
							place = data.place,
							randomId = data.randomId,
							items = data.items,
							top = data.top,
							tick = data.tick,
							ccp = data.ccp,
							firstTime = data.firstTime,
							pow = data.pow,
							tx = data.tx,
							digits = data.digits;

						this.randomId = randomId;
						this.confirmScore = score;
						this.oldScore = score;
						this.oldPlace = place;
						this.digits = digits;
						this.tx = tx || [];

						if(this.onMyDataCallback)
							this.onMyDataCallback(place, score);
						if(this.onUserLoadedCallback)
							this.onUserLoadedCallback(place, score, items, top, firstTime, tick, digits, tx);
						
						this.tick = parseInt(tick, 10);
						this.tickTtl = setInterval(_=> {
							this.onTickEvent();
						}, 1e3);

						this.ccp = ccp || this.ccp;

						if (pow) {
							try {
								let x = OmyEval(pow),
									str = "C1 ".concat(this.randomId, " ") + x;

								if(this.connected) this.ws.send(str);
								else this.onConnectSend.push(str);

							} catch (e) { console.error(e); }
						}

					}
				}

				if ("R" === msg[0]) {
					let p = msg.replace("R", "").split(" "),
						d = p.shift();

					this.rejectAndDropCallback(d, new Error(p.join(" ")))
				}
				if ("C" === msg[0]) {
					let h = msg.replace("C", "").split(" "),
						y = h.shift();

					this.resoveAndDropCallback(y, h.join(" "));
				}

				if ("ALREADY_CONNECTED" === msg) {
					this.retryTime = 18e5;
					if(this.onAlredyConnectedCallback)
						this.onAlredyConnectedCallback();
				}
				else {
					if(0 === msg.indexOf("WAIT_FOR_LOAD")) {
						if(this.onWaitLoadCallback)
							this.onWaitLoadCallback(parseInt(msg.replace("WAIT_FOR_LOAD ", ""), 10));
						if(this.onChangeOnlineCallback)
							this.onChangeOnlineCallback(parseInt(msg.replace("WAIT_FOR_LOAD ", ""), 10));
					}
					if(0 === msg.indexOf("MSG")) {
						this.retryTime = 3e5;
						if(this.onMessageEventCallback)
							this.onMessageEventCallback(msg.replace("MSG ", ""));
					}
					if(0 === msg.indexOf("SELF_DATA")) {

						let data = msg.replace("SELF_DATA ", "").split(" ");
						this.randomId = data[2];
						let packId = parseInt(data[3], 10),
							online = parseInt(data[4], 10),
							_place = parseInt(data[0], 10),
							_score = parseInt(data[1], 10);

						this.oldPlace = _place;
						this.oldScore = _score;
						this.confirmScore = _score;

						this.onMyDataCallback && this.onMyDataCallback(_place, _score, true);
						this.onChangeOnlineCallback && this.onChangeOnlineCallback(online);

						this.resoveAndDropCallback(packId);
					}
				}

				if ("BROKEN" === msg && this.onBrokenEventCallback) {
					this.retryTime = 6e4;
					this.onBrokenEventCallback();
				}
				else {
					if(0 === msg.indexOf("MISS")) {
						this.randomId = parseInt(msg.replace("MISS ", ""), 10);

						if(this.onMissClickCallback)
							this.onMissClickCallback(this.randomId);
					}
					if(0 === msg.indexOf("TR")) {

						let data = msg.replace("TR ", "").split(" ");
						let nscore = parseInt(data[0], 10),
							from = parseInt(data[1]);
						this.oldScore += nscore;
						
						if(this.onTransferCallback)
							this.onTransferCallback(from, nscore);
						if(this.onMyDataCallback)
							this.onMyDataCallback(this.oldPlace, this.oldScore, true);
					}
				}

			}

			this.connecting = true;

		} catch (e) {
			console.error("Ошибка при запуске майнера: ", e);
			this.reconnect(wsServer);
		}
	}

	onOpen() {
		if(this.onOnlineCallback)
			this.onOnlineCallback();

		this.retryTime = 1e3;
	}

	close() {
		this.allowReconnect = false;
		clearTimeout(this.ttl);
		clearInterval(this.tickTtl);
		this.selfClose();
	}
	selfClose() {
		if (this.ws)
			try { this.ws.close(); }
			catch (e) { this.connected = false; }
	}
	reconnect(e, force) {
		if(this.allowReconnect || force) {
			clearTimeout(this.ttl);
			this.ttl = setTimeout(_=> {
				this.run(e || this.wsServer);
			}, this.retryTime + Math.round(7e3 * Math.random()) );
			this.retryTime *= 1.3
		}
	}


	onTransfer(e) {
		this.onTransferCallback = e
	}
	onChangeOnline(e) {
		this.onChangeOnlineCallback = e
	}
	onUserLoaded(e) {
		this.onUserLoadedCallback = e
	}
	onReceiveDataEvent(e) {
		this.onMyDataCallback = e
	}
	onMissClickEvent(e) {
		this.onMissClickCallback = e
	}
	onOffline(e) {
		this.onOfflineCallback = e
	}
	onOnline(e) {
		this.onOnlineCallback = e
	}
	onWaitEvent(e) {
		this.onWaitLoadCallback = e
	}
	onMessageEvent(e) {
		this.onMessageEventCallback = e
	}
	onAlreadyConnected(e) {
		this.onAlredyConnectedCallback = e
	}
	onBrokenEvent(e) {
		this.onBrokenEventCallback = e
	}



	resoveAndDropCallback(e, t) {
		if(this.callbackForPackId[e]) {
			this.callbackForPackId[e].resolve(t);
			this.dropCallback(e);
		}
	}

	rejectAndDropCallback(e, t) {
		if(this.callbackForPackId[e]) {
			this.callbackForPackId[e].reject(t);
			this.dropCallback(e);
		}
	}

	dropCallback(e) {
		if(this.callbackForPackId[e]) {
			clearTimeout(this.callbackForPackId[e].ttl);
			delete this.callbackForPackId[e]
		}
	}


	async onTickEvent() {
		if (null !== this.oldScore && this.onMyDataCallback) {
			this.tickCount++;

			if(this.tickCount % 30 === 0) {
				try { await this.getMyPlace(); }
				catch(e) { }
			}
		}
	}



	async sendClicks() {
		this.clickPacks.push({
			count: this.clickCount,
			x: ++this.sendedPacks
		});

		this.clickCount = 0;

		this.clickTimer = null;
		await this.queueTick();
	}

	sendPack(e, t) {
		return new Promise((resolve, reject)=> {
			try {
				let i = "C"
					.concat(e, " ")
					.concat(this.randomId, " 1");

				if(this.connected) this.ws.send(i);
				else this.onConnectSend.push(i);

				resolve(1);
			} catch (e) {
				this.dropCallback(t);
				reject(e);
			}
		})
	}
	async queueTick() {
		let t = this.clickPacks.shift();

		try {
			await this.sendPack(t.count, t.x);
		} catch(e) {
			console.error(e);
			this.clickPacks.push(t);

			setTimeout(async _=> {
				return await this.queueTick();
			}, 1e3 + 5e3 * Math.random());
		}
	}

	click() {
		if(this.clickCount >= this.ccp) {
			return;
		}

		this.clickCount++

		if(null === this.clickTimer) {
			this.clickTimer = setTimeout(async _=> {
				await this.sendClicks();
			}, 1200);
		}
	}

	async getMerchantKey() {
		let res = await this.sendPackMethod(["NM"]);
		res = JSON.parse(res);

		return res;
	}

	async syncTxList() {
		let res = await this.sendPackMethod(["SY"]);
		res = JSON.parse(res);

		return res;
	}

	async getTxList() {
		let res = await this.sendPackMethod(["SX"]);
		res = JSON.parse(res);

		return res;
	}

	async getTxData(tx = []) {
		let res = await this.sendPackMethod(["TX"].concat(tx));
		res = JSON.parse(res);

		return res;
	}

	async getGroup(id) {
		let res = await this.sendPackMethod(["G", id]);
		res = JSON.parse(res);

		return res;
	}
	
	async buyItemById(id) {

		let res;
		res = await this.sendPackMethod(["B", id]);

		res = JSON.parse(res);

		let n = res.tick,
			r = res.score,
			o = res.place;

		this.tick = parseInt(n, 10);
		this.oldScore = r;
		this.oldPlace = o;

		this.onMyDataCallback && setTimeout(_=> {
			this.onMyDataCallback(this.oldPlace, this.oldScore);
		}, 1);

		return res;
	}
	async transferToUser(id, sum, tx, payload) {
		sum = Math.round(parseFloat(sum)*1e3);
		let packet = ["T", id, sum];
		if(tx && payload){
			packet = ["T", id, sum, tx, payload];
		}
		let res = await this.sendPackMethod(packet);
		res = JSON.parse(res);
		let t = res.score,
			a = res.place,
			r = res.reload,
			kek = res.kek;
		
		this.oldScore = t;
		this.oldPlace = a;
		this.onMyDataCallback && setTimeout(_=> {
			this.onMyDataCallback(this.oldPlace, this.oldScore);
		}, 1);
		
		if(kek) throw kek;
		return res;
	}

	async getMyPlace() {
		let res = await this.sendPackMethod(["X"]);
		res = parseInt(res, 10);

		this.oldPlace = res;

		return res;
	}
	async getUserScores(e) {
		let res = await this.sendPackMethod(["GS"].concat(e));
		return JSON.parse(res);
	}

	sendPackMethod(e) {
		let t = this,
			n = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : 0;

		return new Promise(function(n, r) {
				let o = ++t.sendedPacks;
				try {
					let i = "P" + o + " " + e.join(" ");

					if(t.connected)
						t.ws.send(i);
					else
						t.onConnectSend.push(i);

					t.setCallback(o, n, r);

				} catch (e) {
					t.dropCallback(o);
					r(e);
				}
			})
			.catch (function(r) {
				if (r && "TIMEOUT" === r.message && n < 3)
					return t.sendPackMethod(e, n + 1);
				throw r;
			});
	}
	setCallback(e, t, n) {
		this.dropCallback(e);
		this.callbackForPackId[e] = {
			resolve: t,
			reject: n,
			ttl: setTimeout(_=> {
				n(new Error("TIMEOUT"));
				this.dropCallback(e);
			}, 1e4 + Math.round(500 * Math.random()))
		}
	}


}



module.exports = VCoinWS;
