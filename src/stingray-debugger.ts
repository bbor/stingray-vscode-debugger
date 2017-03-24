/**
 * Stingray Visual Studio Code Debugger
 * NOTE: Debugging protocal interfaces: https://github.com/Microsoft/vscode-debugadapter-node/blob/master/protocol/src/debugProtocol.ts
 *
 * FIXME: Close debug session when engine is killed or closed.
 * FIXME: Kill the launched instance when shutting down the debug session.
 */
import {
    Logger,
    DebugSession, LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, ContinuedEvent, Event,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import _ = require('lodash');
import {readFileSync, existsSync as fileExists} from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import {ConsoleConnection} from './console-connection';
import {StingrayLauncher} from './stingray-launcher';

function findFiles (startPath, filter, recurse = false, items = []) {

    items = items || [];

    if (!fs.existsSync(startPath)){
        return items;
    }

    var files=fs.readdirSync(startPath);
    for(var i=0;i<files.length;i++) {
        var filename=path.join(startPath,files[i]);
        var stat = fs.lstatSync(filename);
        if (stat.isDirectory()) {
            if (recurse) {
                findFiles(filename, filter, recurse, items);
            }
        } else if (filename.indexOf(filter)>=0)
            items.push(filename);
    };

    return items;
};

/**
 * This interface should always match the schema found in the stingray-debug extension manifest.
 */
export interface AttachRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** IP of the Stingray engine process to debug */
    ip?: string;
    /** Port of the Stingray engine process to debug, usually 14030-14039 */
    port?: number;
}

/**
 * This interface should always match the schema found in the stingray-debug extension manifest.
 */
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** Stingray binary folder */
    toolchain?: string;
    /** Project settings file path */
    project_file?: string;
    /** Additional argument fields to be used for debugging */
    command_line_args?: Array<string>;
}

/**
 * Engine debug message.
 * These are usually sent from the engine debugger.
 */
interface EngineMessage {
    type: string,
    message: string,

    // halted
    line?: number,
    source?: string,
    stack?: object
}

class StingrayDebugSession extends DebugSession {

    // we don't support multiple threads, so we can use a hardcoded ID for the default thread
    private static THREAD_ID = 1;

    // since we want to send breakpoint events, we will assign an id to every event
    // so that the frontend can match events with breakpoints.
    private _breakpointId = 1000;

    // Maps from sourceFile to array of Breakpoints
    private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();

    // Last call stack when the engine breaks.
    private _callstack: any = null;

    // Cached source roots.
    private _roots = {};

    // Engine web socket connection.
    private _conn: ConsoleConnection = null;

    // Indicates the if the debug adapter is still initializing.
    private _initializing: boolean = false;

    // Deferred response to indicate we are now successfully attached.
    private _attachResponse: DebugProtocol.Response;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor() {
        super();

        // This debugger uses one-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

        // Set supported features
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsConfigurationDoneRequest = true;
        this.sendResponse(response);
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        this.sendResponse(response);
    }

    /**
     * Establish a connection with the engine.
     */
    protected connectToEngine(ip: string, port: number, response: DebugProtocol.Response): ConsoleConnection {
        this._conn = new ConsoleConnection(ip, port);

        // Bind connection callbacks
        this._conn.onOpen(this.onEngineConnectionOpened.bind(this, response));
        this._conn.onError(this.onEngineConnectionError.bind(this, response));

        return this._conn;
    }

    /**
     * Launch the engine and then attach to it.
     */
    protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {
        let toolchainPath = args.toolchain;
        let projectFilePath = args.project_file;
        try {
            // Launch engine
            let launcher = new StingrayLauncher(toolchainPath, projectFilePath)
            let engineProcess = launcher.start();

            // Tell the user what we are launching.
            this.sendEvent(new OutputEvent(`Launching ${engineProcess.cmdline}`));

            // Wait for engine to start successfully, hopefully one second should be enough.
            // TODO: Try connection multiple time until timeout.
            setTimeout(() => this.connectToEngine(engineProcess.ip, engineProcess.port, response), 1000);
        } catch (err) {
            return this.sendErrorResponse(response, 3001, err.message);
        }
    }

    /**
     * Attach to the engine console server using web sockets.
     */
    protected attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments): void {
        var ip = args.ip;
        var port = args.port;

        // Establish web socket connection with engine.
        this.connectToEngine(ip, port, response);
    }

    /**
     * Client stopped the debugging session.
     * Lets close engine connection and finish session.
     */
    protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
        // Close the engine connection
        this._conn.close();
        this._conn = null;

        // Proceed with disconnection
        this.sendResponse(response);
    }

    /**
     * Client broke the debug session.
     */
    protected pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments): void {
        this._conn.sendDebuggerCommand('break');
        this.sendResponse(response);
    }

    protected sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments): void {
        this.sendResponse(response);
    }

    /**
     * Handle client breakpoints.
     */
    protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

        let filePath = args.source.path;
        let clientLines = args.lines;
        let validScript = true;

        // Find resource root looking for settings.ini or .stingray-asset-server-directory
        let resourcePath = filePath;
        let dirPath = path.dirname(filePath);
        while (true) {

            // Check that we have a valid script folder or that we did not reach the drive root.
            if (!dirPath || dirPath === filePath || dirPath === '.') {
                validScript = false;
                break;
            }

            let projectFilePath = _.first(findFiles(dirPath, '.stingray_project'));
            if (projectFilePath && fileExists(projectFilePath)) {
                resourcePath = path.relative(dirPath, filePath);
                this._roots["<project>"] = dirPath;
                break;
            }

            let stingrayDirTokenFilePath = path.join(dirPath, '.stingray-asset-server-directory');
            if (fileExists(stingrayDirTokenFilePath)) {
                let mapName = path.basename(dirPath);
                resourcePath = path.join(mapName, path.relative(dirPath, filePath));
                this._roots[mapName] = path.dirname(dirPath);
                break;
            }

            dirPath = path.dirname(dirPath);
        }

        // Normalize path
        let resourceName = resourcePath.replace(/\\/g, '/');

        // Verify breakpoint locations
        var breakpoints = new Array<Breakpoint>();
        for (var i = 0; i < clientLines.length; i++) {
            let l = clientLines[i];
            let breakpointId = this._breakpointId++;
            const bp = <DebugProtocol.Breakpoint> new Breakpoint(validScript, l, 0, new Source(resourceName, filePath));
            bp.id = breakpointId;
            breakpoints.push(bp);
        }

        // Store session breakpoints
        this._breakpoints.set(resourceName, validScript ? breakpoints : []);

        // Set engine breakpoints
        /**
         * @typedef {object.<string, number[]>}
         * i.e.
         * {
         *   "resource/name.lua": [24, 42, 5542] <-- lines
         * }
         */
        let engineBreakpoints = {};
        this._breakpoints.forEach((v, k) => {
            if (!_.isEmpty(v))
                engineBreakpoints[k] = v.map(bp => bp.line);
        });
        this._conn.sendDebuggerCommand('set_breakpoints', {breakpoints: engineBreakpoints});

        // Response with actual breakpoints
        response.body = { breakpoints: breakpoints };
        this.sendResponse(response);
    }

    /**
     * Returns the current engine callstack.
     */
    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

        if (this._initializing)
            return this.sendResponse(response);

        if (!this._callstack)
            return this.sendErrorResponse(response, 1000, "No callstack available");

        let i = 0;
        let stack = this._callstack;
        const frames = new Array<StackFrame>();
        for (let frame of stack) {
            let isMapped = frame.source[0] === '@';
            let resourcePath = isMapped ? frame.source.slice(1) : frame.source;
            // TODO: read and parse lua at line of function start.
            let name = frame.function ? `${frame.function} @ ${resourcePath}:${frame.line}` :
                                        `${resourcePath}:${frame.line}`;
            let filePath = this.getResourceFilePath(frame.source);
            if (!fileExists(filePath))
                return this.sendResponse(response);

            frames.push(new StackFrame(i++, `${name}(${i})`,
                new Source(frame.source, filePath),
                frame.line, 0
            ));
        }
        response.body = {
            stackFrames: frames,
            totalFrames: frames.length
        };
        this.sendResponse(response);
    }

    /**
     * Return the local callstack values.
     * TODO: Add global scope support
     */
    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

        if (!this._callstack)
            return this.sendErrorResponse(response, 1000, "No callstack available");

        const frameReference = args.frameId;
        const scopes = new Array<Scope>();
        scopes.push(new Scope("Local", frameReference + 1, false));

        response.body = { scopes: scopes };
        this.sendResponse(response);
    }

    /**
     * Resolve request client stack values.
     */
    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {
        if (!this._callstack)
            return this.sendErrorResponse(response, 1000, "No callstack available");

        const scopeRef = args.variablesReference;
        let frameIndex = scopeRef - 1;
        const frameValues = this._callstack[frameIndex]["local"].concat(this._callstack[frameIndex]["up_values"]);
        const variables = [];
        for (let fv of frameValues) {
            if (fv.var_name === "(*temporary)")
                continue;
            if (fv.value === "C function")
                continue;
            let varName = `${fv.var_name} (${fv.type})`;
            let value = fv.value;
            let type = fv.type;
            if (fv.type === 'table') {
                //type = 'object';
                //value = value.split('\n');
            }
            variables.push({
                name: varName,
                type: type,
                value: value,
                variablesReference: 0
            });
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }

    /**
     * Client request to continue debugging session.
     * Tell the engine that it can now continue since we are attached.
     */
    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this._conn.sendDebuggerCommand('continue');
        this.sendResponse(response);
    }

    /**
     * Step over to the next statement.
     */
    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this._conn.sendDebuggerCommand('step_over');
        this.sendResponse(response);
    }

    /**
     * Step into the current call.
     */
    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this._conn.sendDebuggerCommand('step_into');
        this.sendResponse(response);
    }

    /**
     * Request the engine to step out of the current function.
     */
    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        this._conn.sendDebuggerCommand('step_out');
        this.sendResponse(response);
    }

    /**
     * TODO
     */
    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        response.body = {
            result: `evaluate(context: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }

    /**
     * Not used, always reporting first same thread.
     */
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [ new Thread(StingrayDebugSession.THREAD_ID, "thread 1") ] };
        this.sendResponse(response);
    }

    //---- Events

    /**
     * Called when the engine debugger session is established.
     */
    private onEngineConnectionOpened(response: DebugProtocol.LaunchResponse) {
        // Bind additional connection messages.
        this._conn.onMessage(this.onEngineMessageReceived.bind(this));
        this._conn.onClose(this.onEngineConnectionClosed.bind(this));

        // Request engine status
        this._initializing = true;
        this._attachResponse = response;
        this._conn.sendDebuggerCommand('report_status');
    }

    /**
     * Called when an engine message is received.
     * @param {EngineMessage} dm - Engine debugging message
     * @param {ArrayBuffer} data - Message binary data
     */
    private onEngineMessageReceived(e: EngineMessage, data: ArrayBuffer = null) {
        if (e.type !== 'lua_debugger')
            return;

        if (!e.message)
            return;

        this.sendEvent(new OutputEvent(`Debugger status: ${e.message}`));

        if (this._initializing) {
            this.sendEvent(new InitializedEvent());
        }

        // Since we now know the state of the engine, lets proceed with the client initialization.
        if (this._attachResponse) {
            this.sendResponse(this._attachResponse);
            this._attachResponse = null;
        }

        if (e.message === 'running') {
            if (this._initializing) {
                // In case the engine is waiting for the debugger, let'S tell him we are ready.
                this._conn.sendDebuggerCommand('continue');
            }
        } else if (e.message === 'halted') {
            let line = e.line;
            let isMapped = e.source[0] === '@';
            let resourcePath = isMapped ? e.source.slice(1) : e.source;
            if (this._breakpoints.has(resourcePath)) {
                let bp = _.first(this._breakpoints.get(resourcePath).filter(bp => bp.line === line));
                if (bp) {
                    bp.verified = true;
                    this.sendEvent(new BreakpointEvent("update", bp));
                }
            } else {
                // Unknown breakpoint, lets reset the engine state and continue.
                this._conn.sendDebuggerCommand('set_breakpoints', {breakpoints: {}});
                this._conn.sendDebuggerCommand('continue');
                return this.sendEvent(new ContinuedEvent(StingrayDebugSession.THREAD_ID));
            }
        } else if (e.message === 'callstack') {
            this._callstack = e.stack;
            this.sendEvent(new StoppedEvent('breakpoint', StingrayDebugSession.THREAD_ID));
        }

        this._initializing = false;
    }

    /**
     * Connection with engine was closed.
     */
    private onEngineConnectionClosed() {
        this._conn = null;
        this.sendEvent(new TerminatedEvent());
    }

    /**
     * Connection with engine was aborted or the connection failed to be established.
     */
    private onEngineConnectionError(response: DebugProtocol.LaunchResponse) {
        if (response)
            this.sendErrorResponse(response, 5656, `Engine connection failure with ${this._conn._ws.url}`);
        this.sendEvent(new TerminatedEvent());
        if (this._conn)
            this._conn.close();
        this._conn = null;
    }

    //---- Implementation

    private getResourceFilePath (source) {
        let isMapped = source[0] === '@';
        let resourcePath = isMapped ? source.slice(1) : source;
        let filePath = this._roots["<project>"] ? path.join(this._roots["<project>"], resourcePath) : resourcePath;
        if (isMapped && !fileExists(filePath)) {
            let mapName = _.first(resourcePath.split('/'));
            if (mapName && this._roots[mapName]) {
                filePath = path.join(this._roots[mapName], resourcePath);
            }
        }

        return filePath;
    }
}

DebugSession.run(StingrayDebugSession);
