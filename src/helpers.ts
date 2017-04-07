import * as fs from 'fs';
import * as path from 'path';

export function findFiles (startPath, filter, recurse = false, items = []) {

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

export function isPotentialIdentifier (str: string) {
    const format = /[&*()+\-=\[\]{}':"\\|,\/]/;
    return !format.test(str);
}

export function stringToTypedValue(luaType: string, strValue: string) : any {
    if (luaType === 'string') {
        return strValue;
    }

    if (luaType === 'boolean') {
        return strValue === 'true';
    }

    if (luaType === 'number') {
        return Number(strValue);
    }

    if (luaType === 'table') {
        return [];
    }

    throw new Error('unsupported type');
}
