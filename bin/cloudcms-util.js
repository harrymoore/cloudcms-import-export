#!/usr/bin/env node
'use strict';
var chalk = require('chalk');
var path = require("path").posix;
var wrench = require("wrench");
var writeJsonFile = require('write-json-file');
var cliArgs = require('command-line-args');
var option_prompt = require('prompt-sync')({
    sigint: true
});
var changeCase = require('change-case');
var randomString = require('random-string-simple');
var SC_SEPARATOR = "__";

var [,, ... args] = process.argv;
var script = args[0] || "";
process.argv.shift();

if (script === "import") {
    require('../cloudcms-import');
    return;
} else if (script === "export") {
    require('../cloudcms-export');
    return;
} else if (script === "export-users") {
    require('../cloudcms-user-export');
    return;
} else if (script === "import-users") {
    require('../cloudcms-user-import');
    return;
} else if (script === "init") {
    init(handleOptions(script));
    return;
} else if (script === "create-definition") {
    createDefinition(handleOptions(script));
    return;
} else if (script === "create-form-fields") {
    createFormFields(handleOptions(script));
    return;
} else if (script === "create-instance-node") {
    createNode(handleOptions(script), true);
    return;
} else if (script === "create-node") {
    createNode(handleOptions(script));
    return;
} else if (script === "-h" || script === "--help") {
    printHelp(handleOptions(script));
    return;
} else {
    console.log(chalk.red("Unknown command " + script));
    printHelp();
    return;
}

function printHelp() {
    console.log(chalk.blue("Supported commands are: ") + chalk.green("\n\tinit\n\timport\n\texport\n\texport-users\n\timport-users\n\tcreate-definition\n\tcreate-form-fields\n\tcreate-node\n\tcreate-instance-node"));
}

function init(options) {
    var dataPath = options['data-path'];
    if (!dataPath) {
        dataPath = option_prompt('Enter data path (ex. ./data): ');
    }

    var normalizedDataPath = path.resolve(process.cwd(), path.normalize(dataPath));
    if (dataPath) {
        wrench.mkdirSyncRecursive(path.resolve(normalizedDataPath, 'nodes'));
        wrench.mkdirSyncRecursive(path.resolve(normalizedDataPath, 'instances'));
        wrench.mkdirSyncRecursive(path.resolve(normalizedDataPath, 'definitions'));
        wrench.mkdirSyncRecursive(path.resolve(normalizedDataPath, 'related'));
    } else {
        console.log(chalk.red("bad path: " + dataPath));
    }

    return {
        data: normalizedDataPath,
        nodes: path.resolve(normalizedDataPath, 'nodes'),
        instances: path.resolve(normalizedDataPath, 'instances'),
        definitions: path.resolve(normalizedDataPath, 'definitions'),
        related: path.resolve(normalizedDataPath, 'related')
    };
}

function createDefinition(options) {
    var defPath = init(options).definitions;

    var node = emptyDefinitionNode();
    node._qname = option_prompt('Enter qname: ');
    node.title = option_prompt('Enter title: ');
    node.description = option_prompt('Enter description: ');

    defPath = path.resolve(defPath, node._qname.replace(':', SC_SEPARATOR));

    wrench.mkdirSyncRecursive(defPath);
    writeJsonFile.sync(path.resolve(defPath, "node.json"), node);

    var formNode = emptyFormNode();
    formNode.title = node.title;
    formNode.description = node.description;

    wrench.mkdirSyncRecursive(path.resolve(defPath, "forms"));
    writeJsonFile.sync(path.resolve(defPath, "forms", "master.json"), formNode);
}

function createFormFields(options) {
    var defPath = init(options).definitions;
    var definitionQName = options["definition-qname"];
    var overwrite = options["overwrite"];

    if (!definitionQName) {
        console.log(chalk.red("Bad or missing type qname: " + definitionQName));
    }

    var defPath = path.resolve(dataPath, 'definitions', definitionQName.replace(':', SC_SEPARATOR));
    var definition = require(path.resolve(defPath, "node.json"));
    var formPath = path.resolve(defPath, "forms", "master.json");
    var form = require(formPath);

    if (overwrite) {
        form.fields = {};
    }
    writeFields(definition.properties, form.fields, overwrite);

    writeJsonFile.sync(formPath, form);
    console.log(chalk.green("Completed form: ") + formPath);
}

function writeFields(properties, fields, overwrite) {
    Object.keys(properties).forEach(function(propertyName) {

        var property = properties[propertyName];

        if (fields[propertyName] && !overwrite) {
            // should we overwrite the existing form field?
            console.log(chalk.red("field exists. skipping: " + propertyName));
            return;
        }

        var field = fields[propertyName] = {
            'type': 'text',
            'label': changeCase.title(property.title || property.name),
            'required': !!property.required
        };

        if (property.type === 'object') {
            field.type = 'object';
            if (property._relator) {
                field.type = "node-picker";
                pickerConfig(propertyName, property, field);
            } else if (property.properties) {
                field.fields = {};
                writeFields(property.properties, field.fields, overwrite);
            }
        } else if (property.type === 'array') {
            field.type = 'array';
            if (property._relator) {
                field.type = "node-picker";
                pickerConfig(propertyName, property, field);
            } else {
                field.items = {
                    type: "text",
                    label: property.title
                };

                if (property.items.type === "object") {
                    field.items.type = "object";
                    field.items.fields = {};
                    writeFields(property.items.properties, field.items.fields, overwrite);
                } else if (property.items.type === "array") {
                    field.items.type = "array";
                } else if (property.items.type === "string") {
                    field.items.type = "text";
                } else {
                    field.items.type = property.items.type;
                }
            }
        } else if (property.type === 'string') {
            field.required = true;
            field.default = "";
            if (property.enum) {
                field.optionLabels = [];
                property.enum.forEach(function(value) {
                    field.optionLabels.push(value);
                });
            } else if (propertyName.toLowerCase().includes("body") || propertyName.toLowerCase().includes("copy")) {
                field.type = "ckeditor";
            }
        } else {
            field.required = true;
            field.type = property.type;
        }
    });
}

function pickerConfig(propertyName, property, field) {
    if (propertyName.toLowerCase().includes("file") 
    || propertyName.toLowerCase().includes("upload") 
    || propertyName.toLowerCase().includes("image") 
    || propertyName.toLowerCase().includes("attachment") 
    || propertyName.toLowerCase().includes("pdf") 
    || propertyName.toLowerCase().includes("document")) {
        field.type = "related-content";
        field.uploadPath = "/images";
        if (property.type === "array") {
            field.maxNumberOfFiles = 5;
        } else {
            field.maxNumberOfFiles = 1;
        }
        field.fileTypes = "(\\.|/)(gif|jpe?g|png|svg)$";
    } else {
        field.picker = {
            typeQName: property.nodeType || "n:node",
            associationType: property.associationType || "a:linked",
            includeChildTypes: true
        };    
    }
}

function createNode(options, instanceNode) {
    var paths = init(options);
    var defPath;

    var node = emptyNode();
    node._type = options.qname || option_prompt('Enter type qname: ');
    node.title = options.title || option_prompt('Enter title: ');
    node.description = options.description || option_prompt('Enter description: ');
    var id = options.id || option_prompt('Enter (optional) id: ');

    if (instanceNode) {
        defPath = path.resolve(paths.instances, node._type.replace(':', SC_SEPARATOR), id || randomString(10, 'abcdefghijklmnopqrstuv0123456789'));
    } else {
        defPath = path.resolve(paths.nodes, node._type.replace(':', SC_SEPARATOR), id || randomString(10, 'abcdefghijklmnopqrstuv0123456789'));
    }

    wrench.mkdirSyncRecursive(defPath);
    writeJsonFile.sync(path.resolve(defPath, "node.json"), node);

    wrench.mkdirSyncRecursive(path.resolve(defPath, "attachments"));
}

function emptyNode() {
    return {
        "title": "",
        "description": "",
        "_type": "",
        "type": "object",
        "_parent": "n:node",
        "properties": {
        }
    };
}

function emptyDefinitionNode() {
    return {
        "title": "",
        "description": "",
        "_qname": "",
        "_type": "d:type",
        "type": "object",
        "_parent": "n:node",
        "properties": {
        },
        "mandatoryFeatures": {
        }
    };
}

function emptyFormNode() {
    return {
        "title": "",
        "engineId": "alpaca1",
        "fields": {
        },
        "_type": "n:form"
    };
}

function handleOptions(command) {
    var options = [
        {name: 'help', alias: 'h', type: Boolean},
        {name: 'data-path', alias: 'f', type: String, defaultValue: './data', description: 'data folder path. defaults to ./data'},
        {name: 'qname', alias: 'q', type: String, description: 'qname'},
        {name: 'title', alias: 't', type: String, defaultValue: '', description: 'title'},
        {name: 'description', alias: 'd', type: String, defaultValue: '', description: 'description'},
        {name: 'id', alias: 'i', type: String, description: 'identifier for a node. must be unique from other nodes in the data/nodes or data/instances folder'}
    ];

    if (command === 'create-form-fields') {
        options.push(
            {name: 'definition-qname', alias: 'q', type: String, description: '_qname of the type definition'},
            {name: 'overwrite', alias: 'o', type: Boolean, description: 'Overwrite any existing fields in the form'}
        );
    }

    return cliArgs(options);
}