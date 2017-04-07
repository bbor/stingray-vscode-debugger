
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
        return StingrayEngineProcess.run(this.exePath, args.concat(["--port", port]));
    }
}

export class StingrayLauncher {
    private dataDir: string;
    private sourceDir: string;
    private coreRootDir: string;
    private srpPath: any;
    private tcPath: string;

    constructor (tcPath: string, srpPath: string) {

        if (!fileExists(tcPath))
            throw new Error(`Invalid ${tcPath} toolchain folder path`);

        if (!fileExists(srpPath))
            throw new Error(`Invalid ${srpPath} project path`);

        this.tcPath = tcPath;
        this.srpPath = srpPath;
        this.coreRootDir = tcPath;

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

        if (srp.source_directory) {
            this.sourceDir = path.join(srpDir, srp.source_directory);
        } else
            this.sourceDir = srpDir;

        // Add platform to data dir, default to `win32` for now.
        this.dataDir = path.join(this.dataDir, 'win32');

        this.sourceDir = this.sourceDir.replace(/^[\/\\]|[\/\\]$/g, '');
        this.dataDir = this.dataDir.replace(/^[\/\\]|[\/\\]$/g, '');
        this.coreRootDir = this.coreRootDir.replace(/^[\/\\]|[\/\\]$/g, '');
    }

    public start (compile: boolean): Promise<StingrayEngineProcess> {
        let engineExe = path.join(this.tcPath, 'engine', 'win64', 'dev', 'stingray_win64_dev.exe');
        let engineProcess = new StingrayEngineProcess(engineExe);
        let compilePromise = Promise.resolve();
        if (compile) {
            let engineArgs = [
                "--compile",
                "--source-dir", `"${this.sourceDir}"`,
                "--map-source-dir", "core", `"${this.coreRootDir}"`,
                "--data-dir", `"${this.dataDir}"`,
                "--port 14999"
            ];
            compilePromise = StingrayEngineProcess.run(engineExe, engineArgs);
        }

        return compilePromise.then(() => {
            let engineArgs = [
                "--source-dir", `"${this.sourceDir}"`,
                "--map-source-dir", "core", `"${this.coreRootDir}"`,
                "--data-dir", `"${this.dataDir}"`,
                "--wait-for-debugger"
            ];
            engineProcess.start(engineArgs, DEFAULT_ENGINE_CONSOLE_PORT);
            return engineProcess;
        });
    }
}
