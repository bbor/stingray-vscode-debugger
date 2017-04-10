import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import _ = require('lodash');

class Adoc {
    private content: any = null;

    constructor(adocFile) {
        if (!fs.existsSync(adocFile)) {
            throw new Error("Adoc file doesn't exist: ");
        }

        let buffer = fs.readFileSync(adocFile);
        this.content = JSON.parse(buffer.toString());
    }

    getPossibleCompletions(tokens): Array<string> {
        let completions = [];
        let currentAdoc = this.content.members;

        let completeTokens = tokens.splice(0, tokens.length - 1);
        let lastToken = tokens[tokens.length - 1];

        // Each completeToken must corresponds to an identifier in our help content:
        for (let token of completeTokens) {
            if (!currentAdoc)
                break;
            if (currentAdoc[token]) {
                currentAdoc = currentAdoc[token].members;
            }
        }

        if (currentAdoc) {
            // Best matching of the last token:
            _.each(currentAdoc, (adocValue, key) => {
                if (key.startsWith(lastToken)) {
                    completions.push(_.merge({label: key}, adocValue));
                }
            });
        }
        return completions;
    }
}

const adocToCompletionKind = {
    namespace: 'Module',
    function: 'Function',
    constant: 'Field',
    object: 'Class',
    enumeration: 'Enum',
    enumerator: 'Value'
}

let adoc = null;
const identifierLegalCharacters = /[a-zA-Z._0-9]/;
class LuaCompletionItemProvider implements vscode.CompletionItemProvider {
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken):Thenable<vscode.CompletionItem[]> {

        let line = document.lineAt(position.line);
        let lineText = line.text;
        let cur = position.character - 1;

        // Start at the aucompletion position, and go back until we find a character
        // that is NOT part of the identifier chains (a word boundary, an operator symbol)
        while (cur > 0) {
            if (!lineText.charAt(cur).match(identifierLegalCharacters)) {
                break;
            }
            --cur;
        }

        let expression = lineText.substr(cur + 1, position.character - cur + 1);

        // All the Stingray API use dot as separator (since it is a C API that doesn't use
        // any fake object oriented programming, we wont use ':' as a separator).
        let tokens = expression.split('.');

        let possibleCompletions = adoc.getPossibleCompletions(tokens);
        if (possibleCompletions.length > 0) {
            return Promise.resolve(possibleCompletions.map(
                completion => {
                    let item = new vscode.CompletionItem(completion.label);
                    if (adocToCompletionKind[completion.type]) {
                        item.kind = adocToCompletionKind[completion.type];
                    }
                    if (completion.desc) {
                        item.documentation = completion.desc;
                    }
                    return item;
                }));
        }

        return Promise.resolve();
    }
}

// NOTE: not used now but could be used to provide in code hovering documentation
// of stingray API.
class LuaHoverProvider implements vscode.HoverProvider {
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken):
        Thenable<vscode.Hover> {
        return Promise.resolve(new vscode.Hover('pow!'));
    }
}


const LUA_MODE: vscode.DocumentFilter = { language: 'lua', scheme: 'file' };
export function initialize(context: vscode.ExtensionContext) {
    let apiDoc = path.join(context.extensionPath, 'res', 'lua_api_stingray3d.json');
    adoc = new Adoc(apiDoc);

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            LUA_MODE, new LuaCompletionItemProvider(), '.', '\"'));

    /*
    vscode.languages.registerHoverProvider(
        LUA_MODE, new LuaHoverProvider());
        */

}