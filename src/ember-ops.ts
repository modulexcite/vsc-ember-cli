"use strict";

import { window, commands, workspace, OutputChannel } from "vscode";
import * as cp from "child_process";
import * as os from "os";
import * as path from "path";

import { capitalizeFirstLetter, semver } from "./helpers";

export interface EmberOperationResult {
    code: Number;
    stdout: Array<string>;
    stderr: Array<string>;
}

export class EmberOperation {
    private _spawn = cp.spawn;
    private _oc: OutputChannel;
    private _process: cp.ChildProcess;
    private _isOutputChannelVisible: boolean;
    private _stdout: Array<string> = [];
    private _stderr: Array<string> = [];

    public cmd: Array<string>;
    public created: boolean;

    public getStdout() {
        return this._stdout;
    }

    public getStderr() {
        return this._stderr;
    }

    public showOutputChannel() {
        if (this._oc) {
            this._oc.show();
            this._isOutputChannelVisible = true;
        }
    }

    public hideOutputChannel() {
        if (this._oc) {
            this._oc.dispose();
            this._oc.hide();
            this._isOutputChannelVisible = false;
        }
    }

    public kill() {
        if (this._process) {
            this._process.kill();
        }
    }

    public run() {
        return new Promise((resolve, reject) => {
            if (!workspace || !workspace.rootPath) {
                return reject();
            }

            let lastOut = "";
            let debugEnabled = process.env.VSC_EMBER_CLI_DEBUG || process.env["VSC EMBER CLI DEBUG"];

            this._oc = window.createOutputChannel(`Ember: ${capitalizeFirstLetter(this.cmd[0])}`);

            // On Windows, we'll have to call Ember with PowerShell
            // https://github.com/nodejs/node-v0.x-archive/issues/2318
            if (os.platform() === "win32") {
                let joinedArgs = this.cmd;
                joinedArgs.unshift("ember");

                this._process = this._spawn("powershell.exe", joinedArgs, {
                    cwd: workspace.rootPath,
                    stdio: ["ignore", "pipe", "pipe" ]
                });
            } else {
                this._process = this._spawn("ember", this.cmd, {
                    cwd: workspace.rootPath
                });
            }
            this._oc.appendLine("Building...");

            if (this._isOutputChannelVisible || debugEnabled) {
                this._isOutputChannelVisible = true;
                this._oc.show();
            }

            this._process.stdout.on("data", (data) => {
                let out = data.toString();

                if (lastOut && out && (lastOut + "." === out)
                    || (lastOut.slice(0, lastOut.length - 1)) === out
                    || (lastOut.slice(0, lastOut.length - 2)) === out
                    || (lastOut.slice(0, lastOut.length - 3)) === out) {
                    lastOut = out;
                    return this._oc.append(".");
                }

                this._oc.appendLine(data);
                this._stdout.push(data);
                lastOut = out;
            });

            this._process.stderr.on("data", (data) => {
                this._oc.appendLine(data);
                this._stderr.push(data);
            });

            this._process.on("close", (code) => {
                this._oc.appendLine(`Ember ${this.cmd[0]} process exited with code ${code}`);

                resolve(<EmberOperationResult>{
                    code: parseInt(code),
                    stderr: this._stderr,
                    stdout: this._stdout
                });
            });
        });
    }

    constructor (cmd: string | Array<string>, options = { isOutputChannelVisible: true }) {
        this._isOutputChannelVisible = options.isOutputChannelVisible;
        this.cmd = (Array.isArray(cmd)) ? cmd : [cmd];
        this.created = true;
    }

    dispose() {
        if (this._oc) {
            this._oc.dispose();
        }
        if (this._process) {
            this._process.kill();
        }
    }
}

export function isEmberCliInstalled(): boolean {
    try {
        let exec = cp.execSync("ember -v");

        console.log("Ember is apparently installed");
        console.log(exec.toString());

        return true;
    } catch (e) {
        return false;
    }
}

export function getEmberVersion(): Promise<string> {
    return new Promise((resolve, reject) => {
        let bower;

        if (!workspace || !workspace.rootPath) {
            return reject(new Error("Could not determine Ember version: Workspace not available."));
        }

        // Try go require the bower.json
        try {
            bower = require(path.join(workspace.rootPath, "bower.json"));
        } catch (error) {
            return reject(new Error("Could not determine Ember version: Bower.json not found."));
        }

        // Attempt to get to the ember version
        if (bower && bower.dependencies && bower.dependencies.ember) {
            let version = semver().exec(bower.dependencies.ember);

            if (version && version[0]) {
                resolve(version[0]);
            } else {
                return reject(new Error("Could not determine Ember version: Ember version not recognized."));
            }
        } else {
            return reject(new Error("Could not determine Ember version: Ember not a bower dependency."));
        }
    });
}

export function getHelp(cmd: string): any {
    return new Promise((resolve, reject) => {
        try {
            let exec = cp.execSync(`ember --help --json`);
            let execOutput = exec.toString();
            let result = parseHelp(cmd, execOutput);

            resolve(result);
        } catch (e) {
            if (cmd === "generate") {
                // For generate, let"s use our fallback
                let generateFallback = require("../../resources/json/generate.json");
                return resolve(generateFallback);
            }

            reject(e);
        }
    });
}

function parseHelp(cmd: string, output: any): any {
    if (!output || !cmd) {
        return null;
    }

    // Clean input
    let jsonIndex: number = output.indexOf("{");
    let cleanedOutput: string = (jsonIndex > 0) ? output.slice(jsonIndex) : output;
    let help = JSON.parse(cleanedOutput);
    let cmdHelp: Object = null;

    if (help && help.commands) {
        cmdHelp = help.commands.find((item) => {
           return (item && item.name && item.name === cmd);
        });
    }

    return cmdHelp;
}