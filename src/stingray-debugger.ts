/**
 * Stingray Visual Studio Code Debugger
 * NOTE: Debugging protocal interfaces: https://github.com/Microsoft/vscode-debugadapter-node/blob/master/protocol/src/debugProtocol.ts
 *
 * FIXME: Close debug session when engine is killed or closed.
 */
import {
    Logger,
    DebugSession, LoggingDebugSession,
    InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent, Event,
    Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import {DebugProtocol} from 'vscode-debugprotocol';
import _ = require('lodash');
import {readFileSync, existsSync as fileExists} from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import {ConsoleConnection} from './console-connection';

function findFiles (startPath, filter, recurse = false, items = []) {

    items = items || [];

    if (!fs.existsSync(startPath)){
        console.log("no dir ",startPath);
        return;
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
export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** IP of the Stingray engine process to debug */
    ip: string;
    /** Port of the Stingray engine process to debug, usually 14030-14039 */
    port: number;
    /** Indicates if we should use the current toolchain to launch the engine and debug the current project.
     *  The value should be the path to the Stingray binary toolchain.
     */
    tool_chain?: string;
    /** Executable of the engine to debug, if the application needs to be launched before */
    engine_exe?: string;
    /** Directory of the project to be launched for debugging. */
    project_source_dir?: string;
    /** Additional argument fields to be used for debugging */
    additional_args?: Array<string>;
    /** Enable logging the Debug Adapter Protocol */
    trace?: boolean;
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

class StingrayDebugSession extends LoggingDebugSession {

    // we don't support multiple threads, so we can use a hardcoded ID for the default thread
    private static THREAD_ID = 1;

    // since we want to send breakpoint events, we will assign an id to every event
    // so that the frontend can match events with breakpoints.
    private _breakpointId = 1000;

    // This is the next line that will be 'executed'
    private __currentLine = 0;
    private get _currentLine() : number {
        return this.__currentLine;
    }
    private set _currentLine(line: number) {
        this.__currentLine = line;
        this.log('line', line);
    }

    // the initial (and one and only) file we are 'debugging'
    private _sourceFile: string;

    // the contents (= lines) of the one and only file
    private _sourceLines = new Array<string>();
    private _variableHandles = new Handles<string>();

    // Indicate if we are in debug mode.
    private _debug: boolean;

    // Maps from sourceFile to array of Breakpoints
    private _breakpoints = new Map<string, DebugProtocol.Breakpoint[]>();

    // Last call stack when the engine breaks.
    private _callstack: any = null;

    // Cached source roots.
    private _roots = {};

    // Engine web socket connection.
    private _conn: ConsoleConnection = null;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor() {
        super("stingray-debug.txt");

        // This debugger uses one-based lines and columns
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

        // This debug adapter implements the configurationDoneRequest.
        response.body.supportsConfigurationDoneRequest = true;

        // Enable 'evaluate' when hovering over source
        response.body.supportsEvaluateForHovers = true;

        // Disable 'step back' button
        response.body.supportsStepBack = false;

        this.sendResponse(response);
    }

    /**
     * Establish and start a debugging session with the engine.
     */
    protected launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments): void {

        if (args.trace) {
            Logger.setup(Logger.LogLevel.Verbose, /*logToFile=*/false);
        }

        this._debug = args.trace;

        // TODO: Launch engine if requested

        // Establish web socket connection with engine.
        var ip = args.ip;
        var port = args.port;
        this._conn = new ConsoleConnection(ip, port);

        // Bind connection callbacks
        this._conn.onOpen(this.onEngineConnectionOpened.bind(this, response));
        this._conn.onError(this.onEngineConnectionError.bind(this, response));
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

        /**
         * @typedef {object.<string, number[]>}
         * i.e.
         * {
         *   "resource/name": [24, 42, 5542] <-- lines
         * }
         */

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
     * Returns the current engine stack.
     *
     *         Engine 'lua_debugger': {
                "type":"lua_debugger",
                "message":"callstack",
                "stack":[
                    {
                        "source":"@core/editor_slave/stingray_editor/boot.lua",
                        "function_start_line":94,
                        "local":[
                            {"value":"0.10011450201272964","type":"number","var_name":"dt"},
                            {"value":"C function","type":"function","var_name":"(*temporary)"},
                            {"value":"[unknown light userdata]","type":"userdata","var_name":"(*temporary)"},
                            {"value":"
                                _event_handlers       table: 000000007ED9C510\n
                                _focused_viewport_id  \"dc78805b-cc3f-45c5-a4e1-c73a4caf6fa1\"\n
                                _get_first_viewport_id  [function]\n
                                _get_viewport_or_nil  [function]\n
                                _is_quitting          false\n
                                unregister_viewport_wwise_listener  [function]\n
                                update                [function]\n
                                update_viewport_camera_display_name  [function]\n
                                viewport              [function]\n
                                viewport_drop         [function]\n",
                            "type":"table",
                            "var_name":"(*temporary)"
                            }
                        ],
                        "up_values":[],
                        "line":95
                    }
                ]
            }
     */
    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

        if (!this._callstack) {
            response.success = false;
            response.message = "No callstack available";
            this.sendResponse(response);
            return;
        }

        let i = 0;
        let stack = this._callstack;
        const frames = new Array<StackFrame>();
        for (let frame of stack) {
            let isMapped = frame.source[0] === '@';
            let resourcePath = isMapped ? frame.source.slice(1) : frame.source;
            let name = `${frame.function} @ ${resourcePath}:${frame.line}`;
            let filePath = this._roots["<project>"] ? path.join(this._roots["<project>"], resourcePath) : resourcePath;
            if (isMapped && !fileExists(filePath)) {
                let mapName = _.first(resourcePath.split('/'));
                if (mapName && this._roots[mapName]) {
                    filePath = path.join(this._roots[mapName], resourcePath);
                }
            }

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

    protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

        const frameReference = args.frameId;
        const scopes = new Array<Scope>();
        scopes.push(new Scope("Local", this._variableHandles.create("local_" + frameReference), false));
        scopes.push(new Scope("Closure", this._variableHandles.create("closure_" + frameReference), false));
        scopes.push(new Scope("Global", this._variableHandles.create("global_" + frameReference), true));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

        const variables = [];
        const id = this._variableHandles.get(args.variablesReference);
        if (id != null) {
            variables.push({
                name: id + "_i",
                type: "integer",
                value: "123",
                variablesReference: 0
            });
            variables.push({
                name: id + "_f",
                type: "float",
                value: "3.14",
                variablesReference: 0
            });
            variables.push({
                name: id + "_s",
                type: "string",
                value: "hello world",
                variablesReference: 0
            });
            variables.push({
                name: id + "_o",
                type: "object",
                value: "Object",
                variablesReference: this._variableHandles.create("object_")
            });
        }

        response.body = {
            variables: variables
        };
        this.sendResponse(response);
    }

    /**
     * Client request to continue debugging session.
     */
    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        // Tell the engine that it can now continue since we are attached.
        this._conn.sendDebuggerCommand('continue');

        // Conitnue client debugging session.
        this.sendResponse(response);
    }

    protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
        this._conn.sendDebuggerCommand('step_over');
        this.sendResponse(response);
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
        this._conn.sendDebuggerCommand('step_into');
        this.sendResponse(response);
    }

    protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
        this._conn.sendDebuggerCommand('step_out');
        this.sendResponse(response);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

        response.body = {
            result: `evaluate(context: '${args.context}', '${args.expression}')`,
            variablesReference: 0
        };
        this.sendResponse(response);
    }

    /**
     * Not used, always reporting first thread.
     */
    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        // Return the default thread
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
        this._conn.sendDebuggerCommand('report_status');

        // Indicate that we are now initialized and that we are ready to set additional debugger states (i.e. breakpoints)
        this.sendEvent(new InitializedEvent());

        // Continue initialization request.
        this.continueRequest(<DebugProtocol.ContinueResponse>response, { threadId: StingrayDebugSession.THREAD_ID });
    }

    /**
     * Called when an engine message is received.
     * @param {EngineMessage} dm - Engine debugging message
     * @param {ArrayBuffer} data - Message binary data
     */
    private onEngineMessageReceived(e: EngineMessage, data: ArrayBuffer = null) {
        if (e.type !== 'lua_debugger')
            return;

        // Print debug message type
        console.log(`Engine '${e.type}'\r\n${JSON.stringify(e, null, 2)}\r\n\r\n`, e, data);

        if (!e.message)
            return;

        this.sendEvent(new OutputEvent(`Debugger status: ${e.message}`));

        if (e.message === 'halted') {
            let line = e.line;
            let isMapped = e.source[0] === '@';
            let resourcePath = isMapped ? e.source.slice(1) : e.source;
            if (!this._breakpoints.has(resourcePath))
                return;
            let bp = _.first(this._breakpoints.get(resourcePath).filter(bp => bp.line === line));
            if (bp) {
                bp.verified = true;
                this.sendEvent(new BreakpointEvent("update", bp));
            }
        } else if (e.message === 'callstack') {
            this._callstack = e.stack;
            this.sendEvent(new StoppedEvent('breakpoint', StingrayDebugSession.THREAD_ID));
        }
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
        if (response) {
            response.success = false;
            response.message = `Engine connection failure with ${this._conn._ws.url}`;
            this.sendResponse(response);
        } else {
            this.sendEvent(new TerminatedEvent());
        }

        this._conn.close();
        this._conn = null;
    }

    //---- Implementation

    /**
     * Fire StoppedEvent if line has a breakpoint or the word 'exception' is found.
     */
    private fireEventsForLine(response: DebugProtocol.Response, ln: number): boolean {

        // find the breakpoints for the current source file
        const breakpoints = this._breakpoints.get(this._sourceFile);
        if (breakpoints) {
            const bps = breakpoints.filter(bp => bp.line === this.convertDebuggerLineToClient(ln));
            if (bps.length > 0) {
                this._currentLine = ln;

                // 'continue' request finished
                this.sendResponse(response);

                // send 'stopped' event
                this.sendEvent(new StoppedEvent("breakpoint", StingrayDebugSession.THREAD_ID));

                // the following shows the use of 'breakpoint' events to update properties of a breakpoint in the UI
                // if breakpoint is not yet verified, verify it now and send a 'breakpoint' update event
                if (!bps[0].verified) {
                    bps[0].verified = true;
                    this.sendEvent(new BreakpointEvent("update", bps[0]));
                }
                return true;
            }
        }

        // if word 'exception' found in source -> throw exception
        if (this._sourceLines[ln].indexOf("exception") >= 0) {
            this._currentLine = ln;
            this.sendResponse(response);
            this.sendEvent(new StoppedEvent("exception", StingrayDebugSession.THREAD_ID));
            this.log('exception in line', ln);
            return true;
        }

        return false;
    }

    private log(msg: string, line: number) {
        const e = new OutputEvent(`${msg}: ${line}\n`);
        (<DebugProtocol.OutputEvent>e).body.variablesReference = this._variableHandles.create("args");
        this.sendEvent(e);	// print current line on debug console
    }
}

DebugSession.run(StingrayDebugSession);
