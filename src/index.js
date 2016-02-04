
var Types = require("babel-types");
var _ = require('lodash');
var template = require("babel-template");

const DefaultOptions = {
    pluginManifestDescriberName: 'SketchPlugin',
    handlerFunctionTemplate: '___{{identifier}}_run_handler_',
    globalVarName: '__global',
    scriptFileName: 'plugin.js',
    startingManifestTag: '__$begin_of_manifest_\n',
    endingManifestTag: '__$end_of_manifest_\n'
};

function isPluginObject(node,options) {
    if(Types.isVariableDeclaration(node.declaration) && node.declaration.kind === 'const') {
        var declaration = _.first(node.declaration.declarations);
        if(!declaration) {
            return false;
        }

        return Types.isVariableDeclarator(declaration) && Types.isIdentifier(declaration.id,{ name: options.pluginManifestDescriberName}) && Types.isObjectExpression(declaration.init);
    }

    return false;
}

function findExportDeclaration(path) {
    return _.find(_.get(path,'node.body'),function(declaration) {
        return Types.isExportNamedDeclaration(declaration);
    });
}

function parseKey(key) {
    if(Types.isIdentifier(key)) {
        return key.name;
    }

    if(Types.isStringLiteral(key)) {
        return _.trim(_.trim(key.value,"'"),'"');
    }
}

function parseValue(value) {
    if(Types.isNumericLiteral(value)) {
        return value.value;
    }

    if(Types.isBooleanLiteral(value)) {
        return value.value;
    }

    if(Types.isStringLiteral(value)) {
        return _.trim(_.trim(value.value,"'"),'"');
    }

    if(Types.isObjectExpression(value)) {
        return objectExpressionToDeclarativeObject(value);
    }

    if(Types.isArrayExpression(value)) {
        return arrayExpressionToArray(value);
    }
}

function arrayExpressionToArray(array) {
    return _.map(array.elements,function(element) {
        return parseValue(element);
    });
}

function objectExpressionToDeclarativeObject(obj) {
    if(!Types.isObjectExpression(obj)) {
        return;
    }

    function validatePropType(type) {
        var allowedTypes = ["NumericLiteral","StringLiteral","ArrayExpression","ObjectExpression","BooleanLiteral"];
        return _.some(allowedTypes,function(t) {
            return type === t;
        });
    }

    var output = {};
    _.each(obj.properties,function(prop) {
        var type = _.get(prop,'value.type');
        if(validatePropType(type)) {
            var propName = parseKey(prop.key);
            if(propName) {
                output[propName] = parseValue(prop.value)
            }
        } else {
            // TODO: Should log warning here.
        }
    });

    return output;
}

function main() {
    return {
        visitor: {
            Program: function(path,state) {

                var options = _.defaults(state.opts || {},DefaultOptions);

                var pluginExport = findExportDeclaration(path);
                if(pluginExport && isPluginObject(pluginExport,options)) {
                    var declaration = _.first(_.get(pluginExport,'declaration.declarations'));
                    if(!declaration) {
                        // TODO: Report error here.
                        return;
                    }

                    function handlerKeyFromIdentifier(identifier) {
                        return options.handlerFunctionTemplate.replace(new RegExp('{{identifier}}', 'g'),_.camelCase(identifier))
                    }

                    var obj = objectExpressionToDeclarativeObject(_.get(declaration,'init'));
                    if(obj.commands) {
                        obj.commands = _.map(obj.commands,function(value,key) {
                            return _.assign({
                                identifier: key,
                                handler: handlerKeyFromIdentifier(key),
                                script: options.scriptFileName
                            },value);
                        });
                    }

                    obj = _.assign({},obj,{
                        disableCocoaScriptPreprocessor: true
                    });

                    _.each(obj.commands,function(command) {
                        var result = template(options.globalVarName+"."+handlerKeyFromIdentifier(command.identifier)+" = function(context,params) { "+options.pluginManifestDescriberName+".commands['"+command.identifier+"'].run(context,params);"+" };");
                        path.node.body.push(result());

                    });

                    var manifest = JSON.stringify(obj,null,4);
                    path.addComment("trailing",options.startingManifestTag + manifest + options.endingManifestTag);
                }


            }
        }
    };
}

module.exports = main;