# Stingray Debugger - VSCode Debugger Extension

This is a Visual Studio Code extension to debug [Stingray](http://www.stingrayengine.com)
application and games written in lua.

This extension allow you to set breakpoints in your Stingray lua applicaiton or in the
Stingray Editor lua editor slaves. When the engine breaks, you'll get all the engine lua
callstack info and local variables previews.

You can find more information about Stingray at the following links:

- Stingray web site: <http://www.stingrayengine.com>
- Stingray Learning Center: <http://help.autodesk.com/view/Stingray/ENU/>
- Stingray SDK <http://help.autodesk.com/view/Stingray/ENU/?guid=__sdk_help_introduction_html>

## Installation

Open VSCode extension manager and search for `Stingray Debugger`.

You should find something like this:

![image](https://cloud.githubusercontent.com/assets/4054655/24268552/7b89627a-0fe4-11e7-83e8-f170e0aebfd9.png)

## Setup

To debug a running Stingray applicaiton that was launched with the console server. You can add the following launch configuration to attach VSCode to it:

```json
{
	"type": "stingray",
	"request": "attach",
	"name": "My Stingray Game",
	"ip": "127.0.0.1",
	"port": 14000
}
```

You can find the application console port either in your `settings.ini` file, defined with `console_port = 14030` or from the `--port 14002` command line argument used to launch the application.

If you want to debug the engine editor slave lua code, you can use the following configuraiton:

```json
{
	"type": "stingray",
	"request": "attach",
	"name": "Stingray Editor",
	"ip": "127.0.0.1",
	"port": 14030
}
```

So when the editor is started, you'll be able to attach to it through port `14030`.

## Features

### Run game and debug.

It is also possible to have a launch configuration that starts the Stingray engine on your specific project, have the engine wait for a debugger to attach to it, then start the debugging session once everything is establish. This workflow allow you to debug those initialization routines.

To do so, you can add the follow launch configuration:

```javascript
{
	"type": "stingray",
	"request": "launch",
	"name": "Pitchcrawl",

	// Folder where Stingray is installed.
	"toolchain": "G:/stingray/build/binaries",

	// Full path to the project you want to launch for debugging.
	"project_file": "D:/pitchcrawl/pitchcrawl.stingray_project"

	// Additional command line arguments you would like to pass to the engine
	"command_line_args": [
		"--compile",  // Compile game before running it
		"--continue", // After initial compile continue with running the game.
		"--dx11",     // Run the game using DirectX 11
		// Specifies the dimensions of the engine main window.
		"--rect", 100, 100, 1280, 720
	]
}
```

Other command line arguments will be set by the debugger extension itself, so you do not need to provide them, such as:

- `--port XYZAB`
- `--data-dir <compile folder>`
- etc.

See <http://help.autodesk.com/view/Stingray/ENU/?guid=__stingray_help_reference_engine_command_line_html> for all the engine command line arguments.

### Attach to running game/editor

Once you have setup your launch configuration, you can go in the debugger side bar and start the debugging session like so:

![image](https://cloud.githubusercontent.com/assets/4054655/24269068/3c2f9192-0fe6-11e7-9d72-da8bc47984ad.png)

If the connection is successful, you should be able to open your project or editor script files and setting breakpoints already.

### Set breakpoints

You can set breakpoints in any core or project lua scripts:

![image](https://cloud.githubusercontent.com/assets/4054655/24269119/65fa0ec6-0fe6-11e7-93bf-ba47f932e74f.png)

Once the engine runs to that point, it will break and give you back control to resume, step in code or evaluate local stacks.

![image](https://cloud.githubusercontent.com/assets/4054655/24269203/be459348-0fe6-11e7-87d0-166d87dae63e.png)

You can inspect local variables and the current broken callstack.

When you step in a function that should open a new file, that file will be opened for you.

### Send engine commands

To be available soon!

### Send engine scripts

To be available soon!

### Print ID strings

To be available soon!

*Happy debugging!*
