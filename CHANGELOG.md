## 1.2.0
* Engine commands are now evaluated with `--` prefix instead of `#`.
* Callstack still get evaluated even if the source file cannot be found.
* Mapping toolchain core folder if available.
* You can now send engine commands using the `Stingray Command` in the command palette.

## 1.1.0
* Add better support for variable expansion.
  ![image](https://cloud.githubusercontent.com/assets/4054655/24433504/30b184b4-13f7-11e7-98cd-e97c0eece92e.png)

## 1.0.0
* First version

## TODO

### Variables
- setVariables bugs:
	- need to prevent modfying up_values
- global as a scope?

### Auto complete in console
- use generated auto complete file
- use _global variables

### Auto complete in code
- use generated auto complete file

### Goto
- Need better introspection from Lua?

### Stingray workflow
- Auto compilation on lua file save

### Command palette:
- Compile and refresh engine