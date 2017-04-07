
import _ = require('lodash');
import * as path from 'path';
import * as fs from 'fs';
import SJSON = require('simplified-json');
import {readFileSync as readFile, existsSync as fileExists} from 'fs';
import {EngineProcess, DEFAULT_ENGINE_CONSOLE_PORT, DEFAULT_COMPILER_CONSOLE_PORT} from './engine-process';

export class EngineLauncher {
    private dataDir: string;
    private sourceDir: string;
    private coreRootDir: string;
    private srpPath: any;
    private tcPath: string;
    private engineExe: string;

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

        this.engineExe = path.join(this.tcPath, 'engine', 'win64', 'dev', 'stingray_win64_dev.exe');
    }

    public start (compile: boolean): Promise<EngineProcess> {
        let engineProcess = new EngineProcess(this.engineExe);
        let compilePromise = Promise.resolve();
        if (compile)
            compilePromise = this.compile();
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

    public compile() {
        let engineArgs = [
            "--compile",
            "--source-dir", `"${this.sourceDir}"`,
            "--map-source-dir", "core", `"${this.coreRootDir}"`,
            "--data-dir", `"${this.dataDir}"`,
            "--port", DEFAULT_COMPILER_CONSOLE_PORT
        ];
        return EngineProcess.run(this.engineExe, engineArgs);
    }
}
