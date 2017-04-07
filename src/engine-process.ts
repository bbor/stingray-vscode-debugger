
import _ = require('lodash');
import * as path from 'path';
import * as fs from 'fs';
import {readFileSync as readFile, existsSync as fileExists} from 'fs';
import child_process = require('child_process');

var exec = child_process.exec;

export const DEFAULT_ENGINE_CONSOLE_PORT = 14000;

export class EngineProcess {
    public ip: string;
    public port: number;
    public cmdline: string;

    public exePath: string;

    constructor (exePath: string) {
        this.ip = '127.0.0.1';
        this.port = DEFAULT_ENGINE_CONSOLE_PORT;
        this.exePath = exePath;
    }

    static run (exePath:string, args:Array<string|number> = []) {
        if (!fileExists(exePath))
            throw new Error(`Invalid engine executable path ${exePath}`);
        return new Promise((resolve, reject) => {
            let cmdline = `"${exePath}" ${args.join(' ')}`;
            exec(cmdline, (error, stdout, stderr) => {
                if (error)
                    return reject(error);
                resolve();
            });
        });
    }

    start (args:Array<string|number> = [], port: number = DEFAULT_ENGINE_CONSOLE_PORT) {
        this.port = port;
        this.cmdline = `"${this.exePath}" ${args.join(' ')}`;
        return EngineProcess.run(this.exePath, args.concat(["--port", port]));
    }
}
