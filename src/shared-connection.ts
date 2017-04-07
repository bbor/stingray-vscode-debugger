import * as vscode from 'vscode';
import {ConsoleConnection} from './console-connection';

let _connectionPort = 0;
let _connectionIp = "";
let _sharedConnection: ConsoleConnection = null;
let _currentConnectionPromise: Promise<ConsoleConnection> = null;
let _connectionOutputChannel:vscode.OutputChannel = vscode.window.createOutputChannel("Engine Connection");

/**
 * Configure the shared engine connection settings.
 *
 * @export
 * @param {*} config
 */
export function configure(config:any) {
	_connectionPort = config.port || 14000;
	_connectionIp = config.ip || "127.0.0.1";
}

/**
 * Checks if a shared connection can be established.
 *
 * @export
 * @returns
 */
export function isValid() {
	return _connectionPort > 0 && _connectionIp;
}

/**
 * Close the shared connection and reset its state.
 */
export function close () {
	if (_sharedConnection && _sharedConnection.isReady())
		_sharedConnection.close();
	_sharedConnection = null;
	_currentConnectionPromise = null;
}

/**
 * Get or connect the shared connection.
 */
export function get () {
	if (_currentConnectionPromise)
		return _currentConnectionPromise;
	if (_sharedConnection && _sharedConnection.isReady())
		return Promise.resolve(_sharedConnection);

	_currentConnectionPromise = new Promise((resolve, reject) => {
		_sharedConnection = new ConsoleConnection(_connectionIp, _connectionPort);
		let errorInitOff = _sharedConnection.onError(err => {
			close();
			reject(err);
		});
		_sharedConnection.onOpen(() => {
			errorInitOff();
			resolve(_sharedConnection);
			_sharedConnection.onMessage(onSharedConnectionMessages);
			_sharedConnection.onClose(close);
			_sharedConnection.onError(close);
		});
	});
	return _currentConnectionPromise;
}

function onSharedConnectionMessages(e) {
	if (e.type !== 'message')
		return;

	if (e.system) {
		let engineMessage = `[${e.level.toUpperCase()}] ${e.system} / ${e.message}\r\n`;
		_connectionOutputChannel.appendLine(engineMessage);
	}
}
