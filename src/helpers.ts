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

/**
 * Returns a GUID
 * RFC 4122 Version 4 Compliant solution:
 * http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 * @memberOf stingray
 * @return {string}
 */
export function guid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8);
        return v.toString(16);
    });
};
