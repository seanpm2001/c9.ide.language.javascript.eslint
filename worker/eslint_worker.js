/**
 * Cloud9 Language Foundation
 *
 * @copyright 2013, Ajax.org B.V.
 */
define(function(require, exports, module) {

var baseLanguageHandler = require('plugins/c9.ide.language/base_handler');
var workerUtil = require('plugins/c9.ide.language/worker_util');
// var acorn = require("acorn/dist/acorn");
var linter = require("./eslint_browserified");
var handler = module.exports = Object.create(baseLanguageHandler);
var util = require("plugins/c9.ide.language/worker_util");
var yaml = require("./js-yaml");
var stripJsonComments = require("./strip-json-comments");

var defaultRules;
var defaultEnv = {
    "browser": false,
    "amd": true,
    "builtin": true,
    "node": true,
    "jasmine": false,
    "mocha": false,
    "es6": true,
    "jquery": false,
    "meteor": false,
};
var defaultEcmaFeatures = {
    arrowFunctions: true, // enable arrow functions
    binaryLiterals: true, // enable binary literals
    blockBindings: true, // enable let and const (aka block bindings)
    classes: true, // enable classes
    defaultParams: true, // enable default function parameters
    destructuring: true, // enable destructuring
    forOf: true, // enable for-of loops
    generators: true, // enable generators
    modules: true, // enable modules and global strict mode
    objectLiteralComputedProperties: true, // enable computed object literal property names
    objectLiteralDuplicateProperties: true, // enable duplicate object literal properties in strict mode
    objectLiteralShorthandMethods: true, // enable object literal shorthand methods
    objectLiteralShorthandProperties: true, // enable object literal shorthand properties
    octalLiterals: true, // enable octal literals
    regexUFlag: true, // enable the regular expression u flag
    regexYFlag: true, // enable the regular expression y flag
    spread: true, // enable the spread operator
    superInFunctions: true, // enable super references inside of functions
    templateStrings: true, // enable template strings
    unicodeCodePointEscapes: true, // enable code point escapes
    globalReturn: true, // allow return statements in the global scope
    jsx: true, // enable JSX
};
var defaultGlobals = require("plugins/c9.ide.language.javascript/scope_analyzer").GLOBALS;
var userConfig;
var userConfigRaw;

handler.init = function(callback) {
    var rules = defaultRules = {};
    
    rules["handle-callback-err"] = 1;
    rules["no-debugger"] = 1;
    rules["no-undef"] = 1;
    // too buggy:
    // rules["no-use-before-define"] = [3, "nofunc"];
    // to annoying:
    // rules["no-shadow"] = 3;
    rules["no-inner-declarations"] = [1, "functions"];
    rules["no-native-reassign"] = 1;
    rules["no-new-func"] = 1;
    rules["no-new-wrappers"] = 1;
    rules["no-cond-assign"] = [1, "except-parens"];
    rules["no-debugger"] = 3;
    rules["no-dupe-keys"] = 3;
    rules["no-eval"] = 1;
    rules["no-func-assign"] = 1;
    rules["no-invalid-regexp"] = 1;
    rules["no-irregular-whitespace"] = 3;
    rules["no-negated-in-lhs"] = 1;
    rules["no-regex-spaces"] = 3;
    rules["quote-props"] = 3;
    rules["no-unreachable"] = 1;
    rules["use-isnan"] = 2;
    rules["valid-typeof"] = 1;
    rules["no-redeclare"] = 3;
    rules["no-with"] = 1;
    rules["radix"] = 3;
    rules["no-delete-var"] = 2;
    rules["no-label-var"] = 3;
    rules["no-shadow-restricted-names"] = 2;
    rules["handle-callback-err"] = 1;
    rules["no-new-require"] = 2;

    for (var r in rules) {
        if (!(r in linter.defaults().rules))
            throw new Error("Unknown rule: ", r);
    }
    
    loadConfigFile(true, function(err) {
        if (err) console.error(err);
        util.$watchDir("/", handler);
        util.$onWatchDirChange(onWorkspaceDirChange);
    });
    
    callback();
};

function onWorkspaceDirChange(e) {
    e.data.files.forEach(function(f) {
        if (f.name === ".eslintrc")
            loadConfigFile();
    });
}

function loadConfigFile(initialLoad, callback) {
    util.readFile("/.eslintrc", "utf-8", function onResult(err, data) {
        if (err) return loadConfig(err);
        
        if (data === userConfigRaw)
            return callback && callback();

        userConfigRaw = data;
        var result;
        try {
            result = yaml.safeLoad(stripJsonComments(data));
        }
        catch (e) {
            // TODO: show error marker in .eslintrc file?
            return loadConfig(e);
        }
        loadConfig(null, result);
    });
    
    function loadConfig(err, result) {
        if (err && !callback)
            util.showError(err);
        userConfig = result;
        if (!initialLoad)
            util.refreshAllMarkers();
        callback && callback();
    }
}

handler.handlesLanguage = function(language) {
    return language === "javascript" || language == "jsx";
};

handler.analyze = function(value, ast, options, callback) {
    if (options.minimalAnalysis)
        return callback();
    callback(handler.analyzeSync(value, ast));
};

handler.getMaxFileSizeSupported = function() {
    // .5 of current base_handler default
    return .5 * 10 * 1000 * 80;
};

handler.analyzeSync = function(value, ast) {
    var doc = this.doc;
    var markers = [];
    if (!workerUtil.isFeatureEnabled("hints"))
        return markers;

    var config = this.isFeatureEnabled("eslintrc") && userConfig || {};

    config.rules = config.rules || defaultRules;
    config.env = config.env || defaultEnv;
    config.globals = config.globals || defaultGlobals;
    config.ecmaFeatures = config.ecmaFeatures || defaultEcmaFeatures;

    config.rules["no-unused-vars"] = [
        3,
        {
            vars: "all",
            args: handler.isFeatureEnabled("unusedFunctionArgs") ? "all" : "none"
        }
    ];
    config.rules["no-undef"] =
        handler.isFeatureEnabled("undeclaredVars") ? 1 : 0;
    config.rules["semi"] =
        handler.isFeatureEnabled("semi") ? 3 : 0;
    if (config.rules === defaultRules)
        config.rules["no-extra-semi"] =
            handler.isFeatureEnabled("semi") ? 3 : 0;

    var isJson = this.path.match(/\.(json|run|settings|build)$/);
    if (isJson)
        value = "!" + value;

    try {
        var messages = linter.verify(value, config);
    }
    catch (e) {
        console.error(e.stack);
        if (e.message && e.message.match(/rule .* was not found/))
            workerUtil.showError("eslint: " + e.message);
        return [];
    }
    
    messages.forEach(function(m) {
        var level;
        if (m.severity === 2)
            level = "error";
        else if (m.severity === 1)
            level = "warning";
        else
            level = "info";
        
        if (isJson && level !== "error")
            return;

        if (m.message.match(/(.*) is defined but never used/)) {
            if (RegExp.$1.toUpperCase() === RegExp.$1 && RegExp.$1.toLowerCase() !== RegExp.$1)
                return; // ignore unused constants
        }

        var ec;
        if (m.message.match(/is not defined|was used before it was defined|is already declared|is already defined|unexpected identifier|defined but never used/i)) {
            var line = doc.getLine(m.line);
            var id = workerUtil.getFollowingIdentifier(line, m.column);
            if (m.message.match(/is already defined/) && line.match("for \\(var " + id))
                return;
            ec = m.column + id.length;
        }
        if (m.message.match(/"?(.*?)"? is not defined/)) {
            // TODO: quickfix :)
            m.message = RegExp.$1 + " is not defined; please fix or add /*global " + RegExp.$1 + "*/";
        }
        if (m.message.match(/"?(describe|it|(before|after)(Each)?|suite|test|setup|teardown)"? is not defined/)) {
            // HACK: ignore mocha globals, seeing those in too many places
            return;
        }
        if (m.message.match(/missing semicolon/i)) {
            var line = doc.getLine(m.line);
            if (line.substr(m.column).match(/\s*}/))
                return; // allow missing semi at end of block
            // HACK: allow missing semi at end of aura definitions
            if ((m.line === doc.getLength() || m.line === doc.getLength() - 1)
                && line.match(/^\s*\}\)\s*$/))
                return;
        }
        if (m.message.match(/unexpected identifier/i))
            m.column--; // work around column offset bug
            
        markers.push({
            pos: {
                sl: m.line,
                sc: m.column,
                ec: ec
            },
            type: level,
            level: level !== "info" && level,
            message: m.message
        });
    });
    return markers;
};
    
});
