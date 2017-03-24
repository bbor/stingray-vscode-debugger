
import _ = require('lodash');
import * as path from 'path';
import * as fs from 'fs';
import {readFileSync as readFile, existsSync as fileExists} from 'fs';
import child_process = require('child_process');
import SJSON = require('simplified-json');

var exec = child_process.exec;

export const DEFAULT_ENGINE_CONSOLE_PORT = 14000;

export class StingrayEngineProcess {
    public ip: string;
    public port: number;
    public cmdline: string;

    public exePath: string;

    constructor (exePath: string) {
        this.ip = '127.0.0.1';
        this.port = DEFAULT_ENGINE_CONSOLE_PORT;
        this.exePath = exePath;
        if (!fileExists(this.exePath))
            throw new Error(`Invalid engine executable path ${this.exePath}`);
    }

    start (args:Array<string|number> = [], port: number = DEFAULT_ENGINE_CONSOLE_PORT) {
        args = args.concat([
            "--port", port
        ]);
        this.port = port;
        this.cmdline = `"${this.exePath}" ${args.join(' ')}`;
        exec(this.cmdline, (error, stdout, stderr) => {
            // result
        });
    }
}

export class StingrayLauncher {
    private dataDir: string;
    private srpPath: any;
    private tcPath: string;

    constructor (tcPath: string, srpPath: string) {

        if (!fileExists(tcPath))
            throw new Error(`Invalid ${tcPath} toolchain folder path`);

        if (!fileExists(srpPath))
            throw new Error(`Invalid ${srpPath} project path`);

        this.tcPath = tcPath;
        this.srpPath = srpPath;

        // Read project settings to get data dir
        let srpSJSON = readFile(this.srpPath, 'utf8');
        let srp = SJSON.parse(srpSJSON);

        // Get project data dir.
        let srpDir = path.dirname(srpPath);
        let srpDirName = path.basename(srpDir);
        if (srp.data_directory) {
            if (fileExists(srp.data_directory))
                this.dataDir = path.resolve(srp.data_directory);
            else
                this.dataDir = path.join(srpDir, srp.data_directory);
        } else
            this.dataDir = path.join(srpDir, "..", srpDirName + "_data");

        // Add platform to data dir, default to `win32` for now.
        this.dataDir = path.join(this.dataDir, 'win32');
    }

    public start (): StingrayEngineProcess {
        let engineExe = path.join(this.tcPath, 'engine', 'win64', 'dev', 'stingray_win64_dev.exe');
        let engineProcess = new StingrayEngineProcess(engineExe);
        engineProcess.start([
            "--data-dir", `"${this.dataDir}"`,
            "--wait-for-debugger",
        ], DEFAULT_ENGINE_CONSOLE_PORT);

        return engineProcess;
    }
}
