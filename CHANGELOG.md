## 1.4
* Add more SJSON file types.
* Auto completion for stingray API from official stingray documentation.

## 1.3
* Add launch options `compile:boolean` in order to compile project before launching it.

## 1.2
* Engine commands are now evaluated with `--` prefix instead of `#`.
* Callstack still get evaluated even if the source file cannot be found.
* Mapping toolchain core folder if available.
* You can now send engine commands using the `Stingray Command` in the command palette.

## 1.1
* Add better support for variable expansion.
  ![image](https://cloud.githubusercontent.com/assets/4054655/24433504/30b184b4-13f7-11e7-98cd-e97c0eece92e.png)

## 1.0
* First version

## TODO

### Variables
- setVariables bugs:
	- need to prevent modifying up_values
- global as a scope?

### Stingray Commands:
- available in a list similar to tasks? (what to do with commands with args?)

### Auto complete in console
- use generated auto complete file
- use _global variables
- use binaries\editor\resources\lua_api_stingray3d.json
- auto complete engine command if -- is used

### Docs:
- Links to official docs

### Auto complete in code
- Auto complete resource names from project resources

### Goto
- Need better introspection from Lua
- Goto resource file (lua or not)

### Stingray workflows
- Auto compilation on lua file save
- Right click on text selected: Evaluate selection

### Commands palette:
- Compile and refresh engine
