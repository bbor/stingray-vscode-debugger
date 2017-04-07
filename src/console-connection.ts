import WebSocket = require('ws');
import _ = require('lodash');

function Utf8ArrayToStr(array) {
    var out, i, len, c;
    var char2, char3;

    out = "";
    len = array.length;
    i = 0;
    while(i < len) {
        c = array[i++];
        switch(c >> 4) {
        case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
            // 0xxxxxxx
            out += String.fromCharCode(c);
            break;
        case 12: case 13:
            // 110x xxxx   10xx xxxx
            char2 = array[i++];
            out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
            break;
        case 14:
            // 1110 xxxx  10xx xxxx  10xx xxxx
            char2 = array[i++];
            char3 = array[i++];
            out += String.fromCharCode(((c & 0x0F) << 12) |
                        ((char2 & 0x3F) << 6) |
                        ((char3 & 0x3F) << 0));
            break;
        }
    }

    return out;
}

export class ConsoleConnection {

    _ws: WebSocket = null;
    _onErrorCallbacks: any[];
    _onCloseCallbacks: any[];
    _onOpenCallbacks: any[];
    _onMessageCallbacks: any[];

    constructor (ip, port) {
        this._ws = new WebSocket("ws://" + (ip || "127.0.0.1") + ":" + port);
        this._ws.binaryType = "arraybuffer";

        this._ws.onmessage = this._onMessage.bind(this);
        this._ws.onopen = this._onOpen.bind(this);
        this._ws.onclose = this._onClose.bind(this);
        this._ws.onerror = this._onError.bind(this);

        this._onMessageCallbacks = [];
        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
    }

    close () {
        this._onMessageCallbacks = [];
        this._onOpenCallbacks = [];
        this._onCloseCallbacks = [];
        this._onErrorCallbacks = [];
        this._ws.close();
        this._ws = undefined;
    }

    onOpen (callback) {
        if (!this.isReady())
            return this._addCallback(callback, this._onOpenCallbacks);
        callback();
        return _.noop;
    }

    onMessage (callback) {
        return this._addCallback(callback, this._onMessageCallbacks);
    }

    onClose (callback) {
        return this._addCallback(callback, this._onCloseCallbacks);
    }

    onError (callback) {
        return this._addCallback(callback, this._onErrorCallbacks);
    }

    isReady () {
        return this._ws.readyState === 1;
    }

    isClosed () {
        return this._ws.readyState === 3;
    }

    sendScript (script) {
        this._send({type: "script", script: script});
    }

    sendCommand (command, ...args) {
        this._send({
            type: "command",
            command: command,
            arg: [...args]
        });
    }

    sendDebuggerCommand (command: string, data = null) {
        this._send(_.assign({
            type: "lua_debugger",
            command: command
        }, data));
    }

    _addCallback (cb, callbacks) {
        callbacks.push(cb);
        return () => {
            for (var i = callbacks.length; i--;) {
                if (callbacks[i] === cb)
                    callbacks.splice(i, 1);
            }
        }
    }

    _onOpen () {
        var that = this;
        _.each(this._onOpenCallbacks, function (cb) {
            cb();
        });
    }

    _onMessage (evt) {
        if (this._onMessageCallbacks.length === 0)
            return;

        let message = null;
        let binaryData = null;
        if (_.isString(evt.data)) {
            message = JSON.parse(evt.data);
        } else if (evt.data instanceof ArrayBuffer) {
            let bytes = new Uint8Array(evt.data);
            let jsonLen = 0;
            while (bytes[jsonLen++] !== 0)
                ;
            let jsonBytes = bytes.subarray(0, jsonLen - 1);
            message = JSON.parse(Utf8ArrayToStr(jsonBytes));
            binaryData = bytes.subarray(jsonLen);
        }

        for (let cb of this._onMessageCallbacks)
            cb(message, binaryData);
    }

    _onClose (...args) {
        for (let cb of this._onCloseCallbacks)
            cb(...args);
    }

    _onError (...args) {
        for (let cb of this._onErrorCallbacks)
            cb(...args);
    }

    _send (data) {
        if (this._ws === null || this._ws.readyState !== 1)
            return console.warn('Connection not ready');
        this._ws.send(JSON.stringify(data));
    }
}
