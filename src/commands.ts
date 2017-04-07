
import * as vscode from 'vscode';
import {ConsoleConnection} from './console-connection';

let ConnectionPort = 0;
let ConnectionIp = "";

const commands = {
    'extension-stingray-debug.start-debug-session': config => {
        ConnectionPort = config.port || 14000;
        ConnectionIp = config.ip || "127.0.0.1";
        vscode.commands.executeCommand('vscode.startDebug', config);
    },
    'extension.stingray-debug.run-command': () => {
        if (ConnectionPort === 0)
            return vscode.window.showWarningMessage('No connection to engine.');

        vscode.window.showInputBox({
            placeHolder: 'help',
            prompt: 'Enter the command to send to the engine. i.e. perfhud artist',
        }).then(expression => {

            let command = expression.split(' ');

            let engineConnection = new ConsoleConnection(ConnectionIp, ConnectionPort);
            engineConnection.onOpen(() => {
                engineConnection.sendCommand(command[0], ...command.slice(1));
                setTimeout(() => {
                    engineConnection.close();
                    engineConnection = undefined;
                }, 5000);
            });
            engineConnection.onError(() => {
                ConnectionPort = 0;
                return vscode.window.showWarningMessage('No connection to engine.');
            });
        });

    }
};

export function initialize(context: vscode.ExtensionContext) {
    for (let commandName in commands) {
        if (!commands.hasOwnProperty(commandName))
            continue;
        context.subscriptions.push(vscode.commands.registerCommand(commandName, commands[commandName]));
    }
}
