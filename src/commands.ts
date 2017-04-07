
import * as vscode from 'vscode';
import * as SharedConnection from './shared-connection';

const commands = {
    'extension-stingray-debug.start-debug-session': config => {
        SharedConnection.configure(config);
        vscode.commands.executeCommand('vscode.startDebug', config);
    },
    'extension.stingray-debug.run-command': () => {
        if (!SharedConnection.isValid())
            return vscode.window.showWarningMessage('No connection to engine.');

        vscode.window.showInputBox({
            placeHolder: 'help',
            prompt: 'Enter the command to send to the engine. i.e. perfhud artist',
        }).then(expression => {
            SharedConnection.get().then(engineConnection => {
                let command = expression.split(' ');
                engineConnection.sendCommand(command[0], ...command.slice(1));
            }).catch(err => {
                return vscode.window.showWarningMessage('No connection to engine. ' + err);
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
