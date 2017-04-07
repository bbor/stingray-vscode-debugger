import _ = require('lodash');
import * as vscode from 'vscode';
import * as SharedConnection from './shared-connection';
import * as helpers from './helpers';
import {readFileSync, existsSync as fileExists} from 'fs';
import {EngineLauncher} from './launcher';

let _compiler:EngineLauncher = null;

const commands = {
    'extension-stingray-debug.start-debug-session': config => {
        if (config.toolchain) {
            let projectFilePath = _.first(helpers.findFiles(vscode.workspace.rootPath, '.stingray_project'));
            if (fileExists(projectFilePath))
                _compiler = new EngineLauncher(config.toolchain, projectFilePath);
        }
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
    },
    'extension.stingray-debug.run-compile': () => {
        if (!_compiler)
            return vscode.window.showWarningMessage('No compiler was configure. Make sure your toolchain settings are defined.');
        return _compiler.compile().then(() => vscode.window.showInformationMessage('Compilation Successful.'));
    },
    'extension.stingray-debug.refresh-engine': () => {
        if (!SharedConnection.isValid())
            return vscode.window.showWarningMessage('No connection to engine.');
        let compilePromise = Promise.resolve();
        if (!_compiler) {
             vscode.window.showWarningMessage('No compiler was configure. Make sure your toolchain settings are defined.');
        } else {
            compilePromise = _compiler.compile().then(() => vscode.window.showInformationMessage('Compilation Successful.'));
        }
        compilePromise.then(() => SharedConnection.get().then(engineConnection => engineConnection.sendCommand('refresh')).catch(err => {
            return vscode.window.showWarningMessage('No connection to engine. ' + err);
        }));
    }
};

export function initialize(context: vscode.ExtensionContext) {
    for (let commandName in commands) {
        if (!commands.hasOwnProperty(commandName))
            continue;
        context.subscriptions.push(vscode.commands.registerCommand(commandName, commands[commandName]));
    }
}
