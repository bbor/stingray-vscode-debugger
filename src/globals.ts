
import {ConsoleConnection} from './console-connection';

interface StingrayDebuggerGlobals {
    engineConnection: ConsoleConnection;
}

const Globals: StingrayDebuggerGlobals = {
    engineConnection: null
};

export function hasDebuggerConnection() {
    return !!Globals.engineConnection;
}

export function getDebuggerConnection() {
    return Globals.engineConnection;
}

export function setDebuggerConnection(engineConnection: ConsoleConnection) {
    Globals.engineConnection = engineConnection;
}