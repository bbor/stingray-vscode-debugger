import _ = require('lodash');
import WebSocket = require('ws');
import {guid, Utf8ArrayToStr} from './helpers';

export class ConsoleConnection {

    _ws: WebSocket = null;
    _onErrorCallbacks: any[];
    _onCloseCallbacks: any[];
    _onOpenCallbacks: any[];
    _onMessageCallbacks: any[];
    _engineMessageHandlers: object;

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
        this._engineMessageHandlers = [];
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

    addMessageHandler(messageType, callback){
        if (!this._engineMessageHandlers.hasOwnProperty(messageType))
            this._engineMessageHandlers[messageType] = [];
        return this._addCallback(callback, this._engineMessageHandlers[messageType]);
    }

    /**
     * Evaluate a lua snippet for the specified engine and resolves its return value.
     * @param {string} script - Script to be evaluated
     * @param {Engine} engine - Engine instance for which to run the evaluation.
     * @param {number} timeoutMs - Maximum amount of time to wait if the result does not come back.
     */
    evaluateScript (script, timeoutMs = 3000) {
        if (!_.isString(script)) throw new TypeError('Script to evaluate must be a script');

        return new Promise((resolve, reject) => {
            let evaluationId = guid();
            let timeoutId = setTimeout(() => reject(new Error('Evaluation timeout')), timeoutMs);

            let off = this.addMessageHandler('script_output', (msg) => {
                if (msg.id !== evaluationId)
                    return;
                clearTimeout(timeoutId);
                off();
                resolve(msg.result);
            });

            let scriptLines = script.replace(/^\s+|\s+$/g, '').split('\n');
            let lastLineStatement = "return " + _.last(scriptLines);
            scriptLines.splice(-1, 1);
            script = scriptLines.join('\n') + (scriptLines.length ? '\n' : '') + lastLineStatement;
            let evaluationScript =  `
                local _eval_ = function ()
                    ${script}
                end
                stingray.Application.console_send({type = 'script_output', result = _eval_(), id = "${evaluationId}"})
            `;
            this.sendScript(evaluationScript);
        });
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

        if (this._engineMessageHandlers.hasOwnProperty(message.type))
            for (let cb of this._engineMessageHandlers[message.type])
                cb(message, binaryData, this);

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
