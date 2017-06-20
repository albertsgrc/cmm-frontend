(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var cmm;

cmm = require('./src');

if (typeof self !== "undefined" && self !== null) {
  self.cmm = cmm;
}

module.exports = cmm;


},{"./src":86}],2:[function(require,module,exports){
/*! Copyright (c) 2011, Lloyd Hilaiel, ISC License */
/*
 * This is the JSONSelect reference implementation, in javascript.  This
 * code is designed to run under node.js or in a browser.  In the former
 * case, the "public API" is exposed as properties on the `export` object,
 * in the latter, as properties on `window.JSONSelect`.  That API is thus:
 *
 * Selector formating and parameter escaping:
 *
 * Anywhere where a string selector is selected, it may be followed by an
 * optional array of values.  When provided, they will be escaped and
 * inserted into the selector string properly escaped.  i.e.:
 *
 *   .match(':has(?)', [ 'foo' ], {}) 
 * 
 * would result in the seclector ':has("foo")' being matched against {}.
 *
 * This feature makes dynamically generated selectors more readable.
 *
 * .match(selector, [ values ], object)
 *
 *   Parses and "compiles" the selector, then matches it against the object
 *   argument.  Matches are returned in an array.  Throws an error when
 *   there's a problem parsing the selector.
 *
 * .forEach(selector, [ values ], object, callback)
 *
 *   Like match, but rather than returning an array, invokes the provided
 *   callback once per match as the matches are discovered. 
 * 
 * .compile(selector, [ values ]) 
 *
 *   Parses the selector and compiles it to an internal form, and returns
 *   an object which contains the compiled selector and has two properties:
 *   `match` and `forEach`.  These two functions work identically to the
 *   above, except they do not take a selector as an argument and instead
 *   use the compiled selector.
 *
 *   For cases where a complex selector is repeatedly used, this method
 *   should be faster as it will avoid recompiling the selector each time. 
 */
(function(exports) {

    var // localize references
    toString = Object.prototype.toString;

    function jsonParse(str) {
      try {
          if(JSON && JSON.parse){
              return JSON.parse(str);
          }
          return (new Function("return " + str))();
      } catch(e) {
        te("ijs", e.message);
      }
    }

    // emitted error codes.
    var errorCodes = {
        "bop":  "binary operator expected",
        "ee":   "expression expected",
        "epex": "closing paren expected ')'",
        "ijs":  "invalid json string",
        "mcp":  "missing closing paren",
        "mepf": "malformed expression in pseudo-function",
        "mexp": "multiple expressions not allowed",
        "mpc":  "multiple pseudo classes (:xxx) not allowed",
        "nmi":  "multiple ids not allowed",
        "pex":  "opening paren expected '('",
        "se":   "selector expected",
        "sex":  "string expected",
        "sra":  "string required after '.'",
        "uc":   "unrecognized char",
        "ucp":  "unexpected closing paren",
        "ujs":  "unclosed json string",
        "upc":  "unrecognized pseudo class"
    };

    // throw an error message
    function te(ec, context) {
      throw new Error(errorCodes[ec] + ( context && " in '" + context + "'"));
    }

    // THE LEXER
    var toks = {
        psc: 1, // pseudo class
        psf: 2, // pseudo class function
        typ: 3, // type
        str: 4, // string
        ide: 5  // identifiers (or "classes", stuff after a dot)
    };

    // The primary lexing regular expression in jsonselect
    var pat = new RegExp(
        "^(?:" +
        // (1) whitespace
        "([\\r\\n\\t\\ ]+)|" +
        // (2) one-char ops
        "([~*,>\\)\\(])|" +
        // (3) types names
        "(string|boolean|null|array|object|number)|" +
        // (4) pseudo classes
        "(:(?:root|first-child|last-child|only-child))|" +
        // (5) pseudo functions
        "(:(?:nth-child|nth-last-child|has|expr|val|contains))|" +
        // (6) bogusly named pseudo something or others
        "(:\\w+)|" +
        // (7 & 8) identifiers and JSON strings
        "(?:(\\.)?(\\\"(?:[^\\\\\\\"]|\\\\[^\\\"])*\\\"))|" +
        // (8) bogus JSON strings missing a trailing quote
        "(\\\")|" +
        // (9) identifiers (unquoted)
        "\\.((?:[_a-zA-Z]|[^\\0-\\0177]|\\\\[^\\r\\n\\f0-9a-fA-F])(?:[_a-zA-Z0-9\\-]|[^\\u0000-\\u0177]|(?:\\\\[^\\r\\n\\f0-9a-fA-F]))*)" +
        ")"
    );

    // A regular expression for matching "nth expressions" (see grammar, what :nth-child() eats)
    var nthPat = /^\s*\(\s*(?:([+\-]?)([0-9]*)n\s*(?:([+\-])\s*([0-9]))?|(odd|even)|([+\-]?[0-9]+))\s*\)/;
    function lex(str, off) {
        if (!off) off = 0;
        var m = pat.exec(str.substr(off));
        if (!m) return undefined;
        off+=m[0].length;
        var a;
        if (m[1]) a = [off, " "];
        else if (m[2]) a = [off, m[0]];
        else if (m[3]) a = [off, toks.typ, m[0]];
        else if (m[4]) a = [off, toks.psc, m[0]];
        else if (m[5]) a = [off, toks.psf, m[0]];
        else if (m[6]) te("upc", str);
        else if (m[8]) a = [off, m[7] ? toks.ide : toks.str, jsonParse(m[8])];
        else if (m[9]) te("ujs", str);
        else if (m[10]) a = [off, toks.ide, m[10].replace(/\\([^\r\n\f0-9a-fA-F])/g,"$1")];
        return a;
    }

    // THE EXPRESSION SUBSYSTEM

    var exprPat = new RegExp(
            // skip and don't capture leading whitespace
            "^\\s*(?:" +
            // (1) simple vals
            "(true|false|null)|" + 
            // (2) numbers
            "(-?\\d+(?:\\.\\d*)?(?:[eE][+\\-]?\\d+)?)|" +
            // (3) strings
            "(\"(?:[^\\]|\\[^\"])*\")|" +
            // (4) the 'x' value placeholder
            "(x)|" +
            // (5) binops
            "(&&|\\|\\||[\\$\\^<>!\\*]=|[=+\\-*/%<>])|" +
            // (6) parens
            "([\\(\\)])" +
            ")"
    );

    function is(o, t) { return typeof o === t; }
    var operators = {
        '*':  [ 9, function(lhs, rhs) { return lhs * rhs; } ],
        '/':  [ 9, function(lhs, rhs) { return lhs / rhs; } ],
        '%':  [ 9, function(lhs, rhs) { return lhs % rhs; } ],
        '+':  [ 7, function(lhs, rhs) { return lhs + rhs; } ],
        '-':  [ 7, function(lhs, rhs) { return lhs - rhs; } ],
        '<=': [ 5, function(lhs, rhs) { return is(lhs, 'number') && is(rhs, 'number') && lhs <= rhs; } ],
        '>=': [ 5, function(lhs, rhs) { return is(lhs, 'number') && is(rhs, 'number') && lhs >= rhs; } ],
        '$=': [ 5, function(lhs, rhs) { return is(lhs, 'string') && is(rhs, 'string') && lhs.lastIndexOf(rhs) === lhs.length - rhs.length; } ],
        '^=': [ 5, function(lhs, rhs) { return is(lhs, 'string') && is(rhs, 'string') && lhs.indexOf(rhs) === 0; } ],
        '*=': [ 5, function(lhs, rhs) { return is(lhs, 'string') && is(rhs, 'string') && lhs.indexOf(rhs) !== -1; } ],
        '>':  [ 5, function(lhs, rhs) { return is(lhs, 'number') && is(rhs, 'number') && lhs > rhs; } ],
        '<':  [ 5, function(lhs, rhs) { return is(lhs, 'number') && is(rhs, 'number') && lhs < rhs; } ],
        '=':  [ 3, function(lhs, rhs) { return lhs === rhs; } ],
        '!=': [ 3, function(lhs, rhs) { return lhs !== rhs; } ],
        '&&': [ 2, function(lhs, rhs) { return lhs && rhs; } ],
        '||': [ 1, function(lhs, rhs) { return lhs || rhs; } ]
    };

    function exprLex(str, off) {
        var v, m = exprPat.exec(str.substr(off));
        if (m) {
            off += m[0].length;
            v = m[1] || m[2] || m[3] || m[5] || m[6];
            if (m[1] || m[2] || m[3]) return [off, 0, jsonParse(v)];
            else if (m[4]) return [off, 0, undefined];
            return [off, v];
        }
    }

    function exprParse2(str, off) {
        if (!off) off = 0;
        // first we expect a value or a '('
        var l = exprLex(str, off),
            lhs;
        if (l && l[1] === '(') {
            lhs = exprParse2(str, l[0]);
            var p = exprLex(str, lhs[0]);
            if (!p || p[1] !== ')') te('epex', str);
            off = p[0];
            lhs = [ '(', lhs[1] ];
        } else if (!l || (l[1] && l[1] != 'x')) {
            te("ee", str + " - " + ( l[1] && l[1] ));
        } else {
            lhs = ((l[1] === 'x') ? undefined : l[2]);
            off = l[0];
        }

        // now we expect a binary operator or a ')'
        var op = exprLex(str, off);
        if (!op || op[1] == ')') return [off, lhs];
        else if (op[1] == 'x' || !op[1]) {
            te('bop', str + " - " + ( op[1] && op[1] ));
        }

        // tail recursion to fetch the rhs expression
        var rhs = exprParse2(str, op[0]);
        off = rhs[0];
        rhs = rhs[1];

        // and now precedence!  how shall we put everything together?
        var v;
        if (typeof rhs !== 'object' || rhs[0] === '(' || operators[op[1]][0] < operators[rhs[1]][0] ) {
            v = [lhs, op[1], rhs];
        }
        else {
            v = rhs;
            while (typeof rhs[0] === 'object' && rhs[0][0] != '(' && operators[op[1]][0] >= operators[rhs[0][1]][0]) {
                rhs = rhs[0];
            }
            rhs[0] = [lhs, op[1], rhs[0]];
        }
        return [off, v];
    }

    function exprParse(str, off) {
        function deparen(v) {
            if (typeof v !== 'object' || v === null) return v;
            else if (v[0] === '(') return deparen(v[1]);
            else return [deparen(v[0]), v[1], deparen(v[2])];
        }
        var e = exprParse2(str, off ? off : 0);
        return [e[0], deparen(e[1])];
    }

    function exprEval(expr, x) {
        if (expr === undefined) return x;
        else if (expr === null || typeof expr !== 'object') {
            return expr;
        }
        var lhs = exprEval(expr[0], x),
            rhs = exprEval(expr[2], x);
        return operators[expr[1]][1](lhs, rhs);
    }

    // THE PARSER

    function parse(str, off, nested, hints) {
        if (!nested) hints = {};

        var a = [], am, readParen;
        if (!off) off = 0; 

        while (true) {
            var s = parse_selector(str, off, hints);
            a.push(s[1]);
            s = lex(str, off = s[0]);
            if (s && s[1] === " ") s = lex(str, off = s[0]);
            if (!s) break;
            // now we've parsed a selector, and have something else...
            if (s[1] === ">" || s[1] === "~") {
                if (s[1] === "~") hints.usesSiblingOp = true;
                a.push(s[1]);
                off = s[0];
            } else if (s[1] === ",") {
                if (am === undefined) am = [ ",", a ];
                else am.push(a);
                a = [];
                off = s[0];
            } else if (s[1] === ")") {
                if (!nested) te("ucp", s[1]);
                readParen = 1;
                off = s[0];
                break;
            }
        }
        if (nested && !readParen) te("mcp", str);
        if (am) am.push(a);
        var rv;
        if (!nested && hints.usesSiblingOp) {
            rv = normalize(am ? am : a);
        } else {
            rv = am ? am : a;
        }
        return [off, rv];
    }

    function normalizeOne(sel) {
        var sels = [], s;
        for (var i = 0; i < sel.length; i++) {
            if (sel[i] === '~') {
                // `A ~ B` maps to `:has(:root > A) > B`
                // `Z A ~ B` maps to `Z :has(:root > A) > B, Z:has(:root > A) > B`
                // This first clause, takes care of the first case, and the first half of the latter case.
                if (i < 2 || sel[i-2] != '>') {
                    s = sel.slice(0,i-1);
                    s = s.concat([{has:[[{pc: ":root"}, ">", sel[i-1]]]}, ">"]);
                    s = s.concat(sel.slice(i+1));
                    sels.push(s);
                }
                // here we take care of the second half of above:
                // (`Z A ~ B` maps to `Z :has(:root > A) > B, Z :has(:root > A) > B`)
                // and a new case:
                // Z > A ~ B maps to Z:has(:root > A) > B
                if (i > 1) {
                    var at = sel[i-2] === '>' ? i-3 : i-2;
                    s = sel.slice(0,at);
                    var z = {};
                    for (var k in sel[at]) if (sel[at].hasOwnProperty(k)) z[k] = sel[at][k];
                    if (!z.has) z.has = [];
                    z.has.push([{pc: ":root"}, ">", sel[i-1]]);
                    s = s.concat(z, '>', sel.slice(i+1));
                    sels.push(s);
                }
                break;
            }
        }
        if (i == sel.length) return sel;
        return sels.length > 1 ? [','].concat(sels) : sels[0];
    }

    function normalize(sels) {
        if (sels[0] === ',') {
            var r = [","];
            for (var i = i; i < sels.length; i++) {
                var s = normalizeOne(s[i]);
                r = r.concat(s[0] === "," ? s.slice(1) : s);
            }
            return r;
        } else {
            return normalizeOne(sels);
        }
    }

    function parse_selector(str, off, hints) {
        var soff = off;
        var s = { };
        var l = lex(str, off);
        // skip space
        if (l && l[1] === " ") { soff = off = l[0]; l = lex(str, off); }
        if (l && l[1] === toks.typ) {
            s.type = l[2];
            l = lex(str, (off = l[0]));
        } else if (l && l[1] === "*") {
            // don't bother representing the universal sel, '*' in the
            // parse tree, cause it's the default
            l = lex(str, (off = l[0]));
        }

        // now support either an id or a pc
        while (true) {
            if (l === undefined) {
                break;
            } else if (l[1] === toks.ide) {
                if (s.id) te("nmi", l[1]);
                s.id = l[2];
            } else if (l[1] === toks.psc) {
                if (s.pc || s.pf) te("mpc", l[1]);
                // collapse first-child and last-child into nth-child expressions
                if (l[2] === ":first-child") {
                    s.pf = ":nth-child";
                    s.a = 0;
                    s.b = 1;
                } else if (l[2] === ":last-child") {
                    s.pf = ":nth-last-child";
                    s.a = 0;
                    s.b = 1;
                } else {
                    s.pc = l[2];
                }
            } else if (l[1] === toks.psf) {
                if (l[2] === ":val" || l[2] === ":contains") {
                    s.expr = [ undefined, l[2] === ":val" ? "=" : "*=", undefined];
                    // any amount of whitespace, followed by paren, string, paren
                    l = lex(str, (off = l[0]));
                    if (l && l[1] === " ") l = lex(str, off = l[0]);
                    if (!l || l[1] !== "(") te("pex", str);
                    l = lex(str, (off = l[0]));
                    if (l && l[1] === " ") l = lex(str, off = l[0]);
                    if (!l || l[1] !== toks.str) te("sex", str);
                    s.expr[2] = l[2];
                    l = lex(str, (off = l[0]));
                    if (l && l[1] === " ") l = lex(str, off = l[0]);
                    if (!l || l[1] !== ")") te("epex", str);
                } else if (l[2] === ":has") {
                    // any amount of whitespace, followed by paren
                    l = lex(str, (off = l[0]));
                    if (l && l[1] === " ") l = lex(str, off = l[0]);
                    if (!l || l[1] !== "(") te("pex", str);
                    var h = parse(str, l[0], true);
                    l[0] = h[0];
                    if (!s.has) s.has = [];
                    s.has.push(h[1]);
                } else if (l[2] === ":expr") {
                    if (s.expr) te("mexp", str);
                    var e = exprParse(str, l[0]);
                    l[0] = e[0];
                    s.expr = e[1];
                } else {
                    if (s.pc || s.pf ) te("mpc", str);
                    s.pf = l[2];
                    var m = nthPat.exec(str.substr(l[0]));
                    if (!m) te("mepf", str);
                    if (m[5]) {
                        s.a = 2;
                        s.b = (m[5] === "odd") ? 1 : 0;
                    } else if (m[6]) {
                        s.a = 0;
                        s.b = parseInt(m[6], 10);
                    } else {
                        s.a = parseInt((m[1] ? m[1] : "+") + (m[2] ? m[2] : "1"),10);
                        s.b = m[3] ? parseInt(m[3] + m[4],10) : 0;
                    }
                    l[0] += m[0].length;
                }
            } else {
                break;
            }
            l = lex(str, (off = l[0]));
        }

        // now if we didn't actually parse anything it's an error
        if (soff === off) te("se", str);

        return [off, s];
    }

    // THE EVALUATOR

    function isArray(o) {
        return Array.isArray ? Array.isArray(o) : 
          toString.call(o) === "[object Array]";
    }

    function mytypeof(o) {
        if (o === null) return "null";
        var to = typeof o;
        if (to === "object" && isArray(o)) to = "array";
        return to;
    }

    function mn(node, sel, id, num, tot) {
        var sels = [];
        var cs = (sel[0] === ">") ? sel[1] : sel[0];
        var m = true, mod;
        if (cs.type) m = m && (cs.type === mytypeof(node));
        if (cs.id)   m = m && (cs.id === id);
        if (m && cs.pf) {
            if (cs.pf === ":nth-last-child") num = tot - num;
            else num++;
            if (cs.a === 0) {
                m = cs.b === num;
            } else {
                mod = ((num - cs.b) % cs.a);

                m = (!mod && ((num*cs.a + cs.b) >= 0));
            }
        }
        if (m && cs.has) {
            // perhaps we should augment forEach to handle a return value
            // that indicates "client cancels traversal"?
            var bail = function() { throw 42; };
            for (var i = 0; i < cs.has.length; i++) {
                try {
                    forEach(cs.has[i], node, bail);
                } catch (e) {
                    if (e === 42) continue;
                }
                m = false;
                break;
            }
        }
        if (m && cs.expr) {
            m = exprEval(cs.expr, node);
        }
        // should we repeat this selector for descendants?
        if (sel[0] !== ">" && sel[0].pc !== ":root") sels.push(sel);

        if (m) {
            // is there a fragment that we should pass down?
            if (sel[0] === ">") { if (sel.length > 2) { m = false; sels.push(sel.slice(2)); } }
            else if (sel.length > 1) { m = false; sels.push(sel.slice(1)); }
        }

        return [m, sels];
    }

    function forEach(sel, obj, fun, id, num, tot) {
        var a = (sel[0] === ",") ? sel.slice(1) : [sel],
        a0 = [],
        call = false,
        i = 0, j = 0, k, x;
        for (i = 0; i < a.length; i++) {
            x = mn(obj, a[i], id, num, tot);
            if (x[0]) {
                call = true;
            }
            for (j = 0; j < x[1].length; j++) {
                a0.push(x[1][j]);
            }
        }
        if (a0.length && typeof obj === "object") {
            if (a0.length >= 1) {
                a0.unshift(",");
            }
            if (isArray(obj)) {
                for (i = 0; i < obj.length; i++) {
                    forEach(a0, obj[i], fun, undefined, i, obj.length);
                }
            } else {
                for (k in obj) {
                    if (obj.hasOwnProperty(k)) {
                        forEach(a0, obj[k], fun, k);
                    }
                }
            }
        }
        if (call && fun) {
            fun(obj);
        }
    }

    function match(sel, obj) {
        var a = [];
        forEach(sel, obj, function(x) {
            a.push(x);
        });
        return a;
    }

    function format(sel, arr) {
        sel = sel.replace(/\?/g, function() {
            if (arr.length === 0) throw "too few parameters given";
            var p = arr.shift();
            return ((typeof p === 'string') ? JSON.stringify(p) : p);
        });
        if (arr.length) throw "too many parameters supplied";
        return sel;
    } 

    function compile(sel, arr) {
        if (arr) sel = format(sel, arr);
        return {
            sel: parse(sel)[1],
            match: function(obj){
                return match(this.sel, obj);
            },
            forEach: function(obj, fun) {
                return forEach(this.sel, obj, fun);
            }
        };
    }

    exports._lex = lex;
    exports._parse = parse;
    exports.match = function (sel, arr, obj) {
        if (!obj) { obj = arr; arr = undefined; }
        return compile(sel, arr).match(obj);
    };
    exports.forEach = function(sel, arr, obj, fun) {
        if (!fun) { fun = obj;  obj = arr; arr = undefined }
        return compile(sel, arr).forEach(obj, fun);
    };
    exports.compile = compile;
})(typeof exports === "undefined" ? (window.JSONSelect = {}) : exports);

},{}],3:[function(require,module,exports){
(function (process,__filename){
/** vim: et:ts=4:sw=4:sts=4
 * @license amdefine 1.0.1 Copyright (c) 2011-2016, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/amdefine for details
 */

/*jslint node: true */
/*global module, process */
'use strict';

/**
 * Creates a define for node.
 * @param {Object} module the "module" object that is defined by Node for the
 * current module.
 * @param {Function} [requireFn]. Node's require function for the current module.
 * It only needs to be passed in Node versions before 0.5, when module.require
 * did not exist.
 * @returns {Function} a define function that is usable for the current node
 * module.
 */
function amdefine(module, requireFn) {
    'use strict';
    var defineCache = {},
        loaderCache = {},
        alreadyCalled = false,
        path = require('path'),
        makeRequire, stringRequire;

    /**
     * Trims the . and .. from an array of path segments.
     * It will keep a leading path segment if a .. will become
     * the first path segment, to help with module name lookups,
     * which act like paths, but can be remapped. But the end result,
     * all paths that use this function should look normalized.
     * NOTE: this method MODIFIES the input array.
     * @param {Array} ary the array of path segments.
     */
    function trimDots(ary) {
        var i, part;
        for (i = 0; ary[i]; i+= 1) {
            part = ary[i];
            if (part === '.') {
                ary.splice(i, 1);
                i -= 1;
            } else if (part === '..') {
                if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                    //End of the line. Keep at least one non-dot
                    //path segment at the front so it can be mapped
                    //correctly to disk. Otherwise, there is likely
                    //no path mapping for a path starting with '..'.
                    //This can still fail, but catches the most reasonable
                    //uses of ..
                    break;
                } else if (i > 0) {
                    ary.splice(i - 1, 2);
                    i -= 2;
                }
            }
        }
    }

    function normalize(name, baseName) {
        var baseParts;

        //Adjust any relative paths.
        if (name && name.charAt(0) === '.') {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                baseParts = baseName.split('/');
                baseParts = baseParts.slice(0, baseParts.length - 1);
                baseParts = baseParts.concat(name.split('/'));
                trimDots(baseParts);
                name = baseParts.join('/');
            }
        }

        return name;
    }

    /**
     * Create the normalize() function passed to a loader plugin's
     * normalize method.
     */
    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(id) {
        function load(value) {
            loaderCache[id] = value;
        }

        load.fromText = function (id, text) {
            //This one is difficult because the text can/probably uses
            //define, and any relative paths and requires should be relative
            //to that id was it would be found on disk. But this would require
            //bootstrapping a module/require fairly deeply from node core.
            //Not sure how best to go about that yet.
            throw new Error('amdefine does not implement load.fromText');
        };

        return load;
    }

    makeRequire = function (systemRequire, exports, module, relId) {
        function amdRequire(deps, callback) {
            if (typeof deps === 'string') {
                //Synchronous, single module require('')
                return stringRequire(systemRequire, exports, module, deps, relId);
            } else {
                //Array of dependencies with a callback.

                //Convert the dependencies to modules.
                deps = deps.map(function (depName) {
                    return stringRequire(systemRequire, exports, module, depName, relId);
                });

                //Wait for next tick to call back the require call.
                if (callback) {
                    process.nextTick(function () {
                        callback.apply(null, deps);
                    });
                }
            }
        }

        amdRequire.toUrl = function (filePath) {
            if (filePath.indexOf('.') === 0) {
                return normalize(filePath, path.dirname(module.filename));
            } else {
                return filePath;
            }
        };

        return amdRequire;
    };

    //Favor explicit value, passed in if the module wants to support Node 0.4.
    requireFn = requireFn || function req() {
        return module.require.apply(module, arguments);
    };

    function runFactory(id, deps, factory) {
        var r, e, m, result;

        if (id) {
            e = loaderCache[id] = {};
            m = {
                id: id,
                uri: __filename,
                exports: e
            };
            r = makeRequire(requireFn, e, m, id);
        } else {
            //Only support one define call per file
            if (alreadyCalled) {
                throw new Error('amdefine with no module ID cannot be called more than once per file.');
            }
            alreadyCalled = true;

            //Use the real variables from node
            //Use module.exports for exports, since
            //the exports in here is amdefine exports.
            e = module.exports;
            m = module;
            r = makeRequire(requireFn, e, m, module.id);
        }

        //If there are dependencies, they are strings, so need
        //to convert them to dependency values.
        if (deps) {
            deps = deps.map(function (depName) {
                return r(depName);
            });
        }

        //Call the factory with the right dependencies.
        if (typeof factory === 'function') {
            result = factory.apply(m.exports, deps);
        } else {
            result = factory;
        }

        if (result !== undefined) {
            m.exports = result;
            if (id) {
                loaderCache[id] = m.exports;
            }
        }
    }

    stringRequire = function (systemRequire, exports, module, id, relId) {
        //Split the ID by a ! so that
        var index = id.indexOf('!'),
            originalId = id,
            prefix, plugin;

        if (index === -1) {
            id = normalize(id, relId);

            //Straight module lookup. If it is one of the special dependencies,
            //deal with it, otherwise, delegate to node.
            if (id === 'require') {
                return makeRequire(systemRequire, exports, module, relId);
            } else if (id === 'exports') {
                return exports;
            } else if (id === 'module') {
                return module;
            } else if (loaderCache.hasOwnProperty(id)) {
                return loaderCache[id];
            } else if (defineCache[id]) {
                runFactory.apply(null, defineCache[id]);
                return loaderCache[id];
            } else {
                if(systemRequire) {
                    return systemRequire(originalId);
                } else {
                    throw new Error('No module with ID: ' + id);
                }
            }
        } else {
            //There is a plugin in play.
            prefix = id.substring(0, index);
            id = id.substring(index + 1, id.length);

            plugin = stringRequire(systemRequire, exports, module, prefix, relId);

            if (plugin.normalize) {
                id = plugin.normalize(id, makeNormalize(relId));
            } else {
                //Normalize the ID normally.
                id = normalize(id, relId);
            }

            if (loaderCache[id]) {
                return loaderCache[id];
            } else {
                plugin.load(id, makeRequire(systemRequire, exports, module, relId), makeLoad(id), {});

                return loaderCache[id];
            }
        }
    };

    //Create a define function specific to the module asking for amdefine.
    function define(id, deps, factory) {
        if (Array.isArray(id)) {
            factory = deps;
            deps = id;
            id = undefined;
        } else if (typeof id !== 'string') {
            factory = id;
            id = deps = undefined;
        }

        if (deps && !Array.isArray(deps)) {
            factory = deps;
            deps = undefined;
        }

        if (!deps) {
            deps = ['require', 'exports', 'module'];
        }

        //Set up properties for this module. If an ID, then use
        //internal cache. If no ID, then use the external variables
        //for this node module.
        if (id) {
            //Put the module in deep freeze until there is a
            //require call for it.
            defineCache[id] = [id, deps, factory];
        } else {
            runFactory(id, deps, factory);
        }
    }

    //define.require, which has access to all the values in the
    //cache. Useful for AMD modules that all have IDs in the file,
    //but need to finally export a value to node based on one of those
    //IDs.
    define.require = function (id) {
        if (loaderCache[id]) {
            return loaderCache[id];
        }

        if (defineCache[id]) {
            runFactory.apply(null, defineCache[id]);
            return loaderCache[id];
        }
    };

    define.amd = {};

    return define;
}

module.exports = amdefine;

}).call(this,require('_process'),"/node_modules/amdefine/amdefine.js")
},{"_process":33,"path":32}],4:[function(require,module,exports){
var freetree = require('freetree');
var c0 = String.fromCharCode(9500);
var c1 = String.fromCharCode(9472);
var c2 = String.fromCharCode(9492);
var c3 = String.fromCharCode(9474);

function generate(str) {
    var levels = [];
    var settings = {
        leadingChar: str[0]
    };
    var tree = freetree.parse(str, settings);
    return _generate(tree, true, levels);
}

function compose(tree, end, levels) {
    var i, ret = '\r\n';
    var c = end ? c2 : c0;

    if (tree.level == 0) {
        return tree.value;
    }

    for (i = 1; i < tree.level; ++i) {
        ret += levels[i] ? ' ' : c3
        ret += '  ';
    }

    return ret + c + c1 + ' ' + tree.value;
}

function _generate(tree, end, levels) {
    var last;
    var result = compose(tree, end, levels);

    if (tree.nodes) {
        last = tree.nodes.length - 1;
        tree.nodes.forEach(function(subTree, index) {
            levels[subTree.level] = index == last;
            result += _generate(subTree, index == last, levels);
        });
    }

    return result;
}

exports.generate = generate;
},{"freetree":20}],5:[function(require,module,exports){
'use strict'

exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function placeHoldersCount (b64) {
  var len = b64.length
  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // the number of equal signs (place holders)
  // if there are two placeholders, than the two characters before it
  // represent one byte
  // if there is only one, then the three characters before it represent 2 bytes
  // this is just a cheap hack to not do indexOf twice
  return b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0
}

function byteLength (b64) {
  // base64 is 4/3 + up to two characters of the original data
  return b64.length * 3 / 4 - placeHoldersCount(b64)
}

function toByteArray (b64) {
  var i, j, l, tmp, placeHolders, arr
  var len = b64.length
  placeHolders = placeHoldersCount(b64)

  arr = new Arr(len * 3 / 4 - placeHolders)

  // if there are placeholders, only get up to the last complete 4 chars
  l = placeHolders > 0 ? len - 4 : len

  var L = 0

  for (i = 0, j = 0; i < l; i += 4, j += 3) {
    tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)]
    arr[L++] = (tmp >> 16) & 0xFF
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  if (placeHolders === 2) {
    tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[L++] = tmp & 0xFF
  } else if (placeHolders === 1) {
    tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[L++] = (tmp >> 8) & 0xFF
    arr[L++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var output = ''
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    output += lookup[tmp >> 2]
    output += lookup[(tmp << 4) & 0x3F]
    output += '=='
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + (uint8[len - 1])
    output += lookup[tmp >> 10]
    output += lookup[(tmp >> 4) & 0x3F]
    output += lookup[(tmp << 2) & 0x3F]
    output += '='
  }

  parts.push(output)

  return parts.join('')
}

},{}],6:[function(require,module,exports){
/*
 * boolify-string
 * https://github.com/sanemat/node-boolify-string
 *
 * Copyright (c) 2014 sanemat
 * Licensed under the MIT license.
 */

'use strict';
var type = require('type-detect');

module.exports = function(obj){
  if (type(obj) !== 'string') {
    return !!obj;
  }
  var value = obj.toLowerCase();
  var bool;
  switch (value){
    case 'false':
    case '0':
    case 'undefined':
    case 'null':
    case '':
    case 'n':
    case 'no':
    case 'off':
      bool = false;
      break;
    default:
      bool = true;
      break;
  }
  return bool;
};

},{"type-detect":44}],7:[function(require,module,exports){

},{}],8:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50

var K_MAX_LENGTH = 0x7fffffff
exports.kMaxLength = K_MAX_LENGTH

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Print warning and recommend using `buffer` v4.x which has an Object
 *               implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * We report that the browser does not support typed arrays if the are not subclassable
 * using __proto__. Firefox 4-29 lacks support for adding new properties to `Uint8Array`
 * (See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438). IE 10 lacks support
 * for __proto__ and has a buggy typed array implementation.
 */
Buffer.TYPED_ARRAY_SUPPORT = typedArraySupport()

if (!Buffer.TYPED_ARRAY_SUPPORT && typeof console !== 'undefined' &&
    typeof console.error === 'function') {
  console.error(
    'This browser lacks typed array (Uint8Array) support which is required by ' +
    '`buffer` v5.x. Use `buffer` v4.x if you require old browser support.'
  )
}

function typedArraySupport () {
  // Can typed array instances can be augmented?
  try {
    var arr = new Uint8Array(1)
    arr.__proto__ = {__proto__: Uint8Array.prototype, foo: function () { return 42 }}
    return arr.foo() === 42
  } catch (e) {
    return false
  }
}

function createBuffer (length) {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('Invalid typed array length')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new Uint8Array(length)
  buf.__proto__ = Buffer.prototype
  return buf
}

/**
 * The Buffer constructor returns instances of `Uint8Array` that have their
 * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
 * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
 * and the `Uint8Array` methods. Square bracket notation works as expected -- it
 * returns a single octet.
 *
 * The `Uint8Array` prototype remains unmodified.
 */

function Buffer (arg, encodingOrOffset, length) {
  // Common case.
  if (typeof arg === 'number') {
    if (typeof encodingOrOffset === 'string') {
      throw new Error(
        'If encoding is specified then the first argument must be a string'
      )
    }
    return allocUnsafe(arg)
  }
  return from(arg, encodingOrOffset, length)
}

// Fix subarray() in ES2016. See: https://github.com/feross/buffer/pull/97
if (typeof Symbol !== 'undefined' && Symbol.species &&
    Buffer[Symbol.species] === Buffer) {
  Object.defineProperty(Buffer, Symbol.species, {
    value: null,
    configurable: true,
    enumerable: false,
    writable: false
  })
}

Buffer.poolSize = 8192 // not used by this implementation

function from (value, encodingOrOffset, length) {
  if (typeof value === 'number') {
    throw new TypeError('"value" argument must not be a number')
  }

  if (value instanceof ArrayBuffer) {
    return fromArrayBuffer(value, encodingOrOffset, length)
  }

  if (typeof value === 'string') {
    return fromString(value, encodingOrOffset)
  }

  return fromObject(value)
}

/**
 * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
 * if value is a number.
 * Buffer.from(str[, encoding])
 * Buffer.from(array)
 * Buffer.from(buffer)
 * Buffer.from(arrayBuffer[, byteOffset[, length]])
 **/
Buffer.from = function (value, encodingOrOffset, length) {
  return from(value, encodingOrOffset, length)
}

// Note: Change prototype *after* Buffer.from is defined to workaround Chrome bug:
// https://github.com/feross/buffer/pull/148
Buffer.prototype.__proto__ = Uint8Array.prototype
Buffer.__proto__ = Uint8Array

function assertSize (size) {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be a number')
  } else if (size < 0) {
    throw new RangeError('"size" argument must not be negative')
  }
}

function alloc (size, fill, encoding) {
  assertSize(size)
  if (size <= 0) {
    return createBuffer(size)
  }
  if (fill !== undefined) {
    // Only pay attention to encoding if it's a string. This
    // prevents accidentally sending in a number that would
    // be interpretted as a start offset.
    return typeof encoding === 'string'
      ? createBuffer(size).fill(fill, encoding)
      : createBuffer(size).fill(fill)
  }
  return createBuffer(size)
}

/**
 * Creates a new filled Buffer instance.
 * alloc(size[, fill[, encoding]])
 **/
Buffer.alloc = function (size, fill, encoding) {
  return alloc(size, fill, encoding)
}

function allocUnsafe (size) {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}

/**
 * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
 * */
Buffer.allocUnsafe = function (size) {
  return allocUnsafe(size)
}
/**
 * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
 */
Buffer.allocUnsafeSlow = function (size) {
  return allocUnsafe(size)
}

function fromString (string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') {
    encoding = 'utf8'
  }

  if (!Buffer.isEncoding(encoding)) {
    throw new TypeError('"encoding" must be a valid string encoding')
  }

  var length = byteLength(string, encoding) | 0
  var buf = createBuffer(length)

  var actual = buf.write(string, encoding)

  if (actual !== length) {
    // Writing a hex string, for example, that contains invalid characters will
    // cause everything after the first invalid character to be ignored. (e.g.
    // 'abxxcd' will be treated as 'ab')
    buf = buf.slice(0, actual)
  }

  return buf
}

function fromArrayLike (array) {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}

function fromArrayBuffer (array, byteOffset, length) {
  if (byteOffset < 0 || array.byteLength < byteOffset) {
    throw new RangeError('\'offset\' is out of bounds')
  }

  if (array.byteLength < byteOffset + (length || 0)) {
    throw new RangeError('\'length\' is out of bounds')
  }

  var buf
  if (byteOffset === undefined && length === undefined) {
    buf = new Uint8Array(array)
  } else if (length === undefined) {
    buf = new Uint8Array(array, byteOffset)
  } else {
    buf = new Uint8Array(array, byteOffset, length)
  }

  // Return an augmented `Uint8Array` instance
  buf.__proto__ = Buffer.prototype
  return buf
}

function fromObject (obj) {
  if (Buffer.isBuffer(obj)) {
    var len = checked(obj.length) | 0
    var buf = createBuffer(len)

    if (buf.length === 0) {
      return buf
    }

    obj.copy(buf, 0, 0, len)
    return buf
  }

  if (obj) {
    if (isArrayBufferView(obj) || 'length' in obj) {
      if (typeof obj.length !== 'number' || numberIsNaN(obj.length)) {
        return createBuffer(0)
      }
      return fromArrayLike(obj)
    }

    if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return fromArrayLike(obj.data)
    }
  }

  throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
}

function checked (length) {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (length) {
  if (+length != length) { // eslint-disable-line eqeqeq
    length = 0
  }
  return Buffer.alloc(+length)
}

Buffer.isBuffer = function isBuffer (b) {
  return b != null && b._isBuffer === true
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i]
      y = b[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'latin1':
    case 'binary':
    case 'base64':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return Buffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = Buffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (!Buffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}

function byteLength (string, encoding) {
  if (Buffer.isBuffer(string)) {
    return string.length
  }
  if (isArrayBufferView(string) || string instanceof ArrayBuffer) {
    return string.byteLength
  }
  if (typeof string !== 'string') {
    string = '' + string
  }

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'latin1':
      case 'binary':
        return len
      case 'utf8':
      case 'utf-8':
      case undefined:
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
  // property of a typed array.

  // This behaves neither like String nor Uint8Array in that we set start/end
  // to their upper/lower bounds if the value passed is out of range.
  // undefined is handled specially as per ECMA-262 6th Edition,
  // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
  if (start === undefined || start < 0) {
    start = 0
  }
  // Return early if start > this.length. Done here to prevent potential uint32
  // coercion fail below.
  if (start > this.length) {
    return ''
  }

  if (end === undefined || end > this.length) {
    end = this.length
  }

  if (end <= 0) {
    return ''
  }

  // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
  end >>>= 0
  start >>>= 0

  if (end <= start) {
    return ''
  }

  if (!encoding) encoding = 'utf8'

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'latin1':
      case 'binary':
        return latin1Slice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

// This property is used by `Buffer.isBuffer` (and the `is-buffer` npm package)
// to detect a Buffer instance. It's not possible to use `instanceof Buffer`
// reliably in a browserify context because there could be multiple different
// copies of the 'buffer' package in use. This method works even for Buffer
// instances that were created from another copy of the `buffer` package.
// See: https://github.com/feross/buffer/issues/154
Buffer.prototype._isBuffer = true

function swap (b, n, m) {
  var i = b[n]
  b[n] = b[m]
  b[m] = i
}

Buffer.prototype.swap16 = function swap16 () {
  var len = this.length
  if (len % 2 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 16-bits')
  }
  for (var i = 0; i < len; i += 2) {
    swap(this, i, i + 1)
  }
  return this
}

Buffer.prototype.swap32 = function swap32 () {
  var len = this.length
  if (len % 4 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 32-bits')
  }
  for (var i = 0; i < len; i += 4) {
    swap(this, i, i + 3)
    swap(this, i + 1, i + 2)
  }
  return this
}

Buffer.prototype.swap64 = function swap64 () {
  var len = this.length
  if (len % 8 !== 0) {
    throw new RangeError('Buffer size must be a multiple of 64-bits')
  }
  for (var i = 0; i < len; i += 8) {
    swap(this, i, i + 7)
    swap(this, i + 1, i + 6)
    swap(this, i + 2, i + 5)
    swap(this, i + 3, i + 4)
  }
  return this
}

Buffer.prototype.toString = function toString () {
  var length = this.length
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
  if (!Buffer.isBuffer(target)) {
    throw new TypeError('Argument must be a Buffer')
  }

  if (start === undefined) {
    start = 0
  }
  if (end === undefined) {
    end = target ? target.length : 0
  }
  if (thisStart === undefined) {
    thisStart = 0
  }
  if (thisEnd === undefined) {
    thisEnd = this.length
  }

  if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
    throw new RangeError('out of range index')
  }

  if (thisStart >= thisEnd && start >= end) {
    return 0
  }
  if (thisStart >= thisEnd) {
    return -1
  }
  if (start >= end) {
    return 1
  }

  start >>>= 0
  end >>>= 0
  thisStart >>>= 0
  thisEnd >>>= 0

  if (this === target) return 0

  var x = thisEnd - thisStart
  var y = end - start
  var len = Math.min(x, y)

  var thisCopy = this.slice(thisStart, thisEnd)
  var targetCopy = target.slice(start, end)

  for (var i = 0; i < len; ++i) {
    if (thisCopy[i] !== targetCopy[i]) {
      x = thisCopy[i]
      y = targetCopy[i]
      break
    }
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

// Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
// OR the last index of `val` in `buffer` at offset <= `byteOffset`.
//
// Arguments:
// - buffer - a Buffer to search
// - val - a string, Buffer, or number
// - byteOffset - an index into `buffer`; will be clamped to an int32
// - encoding - an optional encoding, relevant is val is a string
// - dir - true for indexOf, false for lastIndexOf
function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
  // Empty buffer means no match
  if (buffer.length === 0) return -1

  // Normalize byteOffset
  if (typeof byteOffset === 'string') {
    encoding = byteOffset
    byteOffset = 0
  } else if (byteOffset > 0x7fffffff) {
    byteOffset = 0x7fffffff
  } else if (byteOffset < -0x80000000) {
    byteOffset = -0x80000000
  }
  byteOffset = +byteOffset  // Coerce to Number.
  if (numberIsNaN(byteOffset)) {
    // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
    byteOffset = dir ? 0 : (buffer.length - 1)
  }

  // Normalize byteOffset: negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = buffer.length + byteOffset
  if (byteOffset >= buffer.length) {
    if (dir) return -1
    else byteOffset = buffer.length - 1
  } else if (byteOffset < 0) {
    if (dir) byteOffset = 0
    else return -1
  }

  // Normalize val
  if (typeof val === 'string') {
    val = Buffer.from(val, encoding)
  }

  // Finally, search either indexOf (if dir is true) or lastIndexOf
  if (Buffer.isBuffer(val)) {
    // Special case: looking for empty string/buffer always fails
    if (val.length === 0) {
      return -1
    }
    return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
  } else if (typeof val === 'number') {
    val = val & 0xFF // Search for a byte value [0-255]
    if (typeof Uint8Array.prototype.indexOf === 'function') {
      if (dir) {
        return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
      } else {
        return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
      }
    }
    return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
  }

  throw new TypeError('val must be string, number or Buffer')
}

function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
  var indexSize = 1
  var arrLength = arr.length
  var valLength = val.length

  if (encoding !== undefined) {
    encoding = String(encoding).toLowerCase()
    if (encoding === 'ucs2' || encoding === 'ucs-2' ||
        encoding === 'utf16le' || encoding === 'utf-16le') {
      if (arr.length < 2 || val.length < 2) {
        return -1
      }
      indexSize = 2
      arrLength /= 2
      valLength /= 2
      byteOffset /= 2
    }
  }

  function read (buf, i) {
    if (indexSize === 1) {
      return buf[i]
    } else {
      return buf.readUInt16BE(i * indexSize)
    }
  }

  var i
  if (dir) {
    var foundIndex = -1
    for (i = byteOffset; i < arrLength; i++) {
      if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
      } else {
        if (foundIndex !== -1) i -= i - foundIndex
        foundIndex = -1
      }
    }
  } else {
    if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength
    for (i = byteOffset; i >= 0; i--) {
      var found = true
      for (var j = 0; j < valLength; j++) {
        if (read(arr, i + j) !== read(val, j)) {
          found = false
          break
        }
      }
      if (found) return i
    }
  }

  return -1
}

Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
  return this.indexOf(val, byteOffset, encoding) !== -1
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
}

Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
  return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; ++i) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (numberIsNaN(parsed)) return i
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function latin1Write (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset >>> 0
    if (isFinite(length)) {
      length = length >>> 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  } else {
    throw new Error(
      'Buffer.write(string, encoding, offset[, length]) is no longer supported'
    )
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('Attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'latin1':
      case 'binary':
        return latin1Write(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function latin1Slice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; ++i) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; ++i) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + (bytes[i + 1] * 256))
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf = this.subarray(start, end)
  // Return an augmented `Uint8Array` instance
  newBuf.__proto__ = Buffer.prototype
  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) {
    var maxBytes = Math.pow(2, 8 * byteLength) - 1
    checkInt(this, value, offset, byteLength, maxBytes, 0)
  }

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset + 3] = (value >>> 24)
  this[offset + 2] = (value >>> 16)
  this[offset + 1] = (value >>> 8)
  this[offset] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    var limit = Math.pow(2, (8 * byteLength) - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
      sub = 1
    }
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  this[offset] = (value >>> 8)
  this[offset + 1] = (value & 0xff)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  this[offset] = (value & 0xff)
  this[offset + 1] = (value >>> 8)
  this[offset + 2] = (value >>> 16)
  this[offset + 3] = (value >>> 24)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
  if (offset < 0) throw new RangeError('Index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000) {
    // ascending copy from start
    for (i = 0; i < len; ++i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    Uint8Array.prototype.set.call(
      target,
      this.subarray(start, start + len),
      targetStart
    )
  }

  return len
}

// Usage:
//    buffer.fill(number[, offset[, end]])
//    buffer.fill(buffer[, offset[, end]])
//    buffer.fill(string[, offset[, end]][, encoding])
Buffer.prototype.fill = function fill (val, start, end, encoding) {
  // Handle string cases:
  if (typeof val === 'string') {
    if (typeof start === 'string') {
      encoding = start
      start = 0
      end = this.length
    } else if (typeof end === 'string') {
      encoding = end
      end = this.length
    }
    if (val.length === 1) {
      var code = val.charCodeAt(0)
      if (code < 256) {
        val = code
      }
    }
    if (encoding !== undefined && typeof encoding !== 'string') {
      throw new TypeError('encoding must be a string')
    }
    if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
      throw new TypeError('Unknown encoding: ' + encoding)
    }
  } else if (typeof val === 'number') {
    val = val & 255
  }

  // Invalid ranges are not set to a default, so can range check early.
  if (start < 0 || this.length < start || this.length < end) {
    throw new RangeError('Out of range index')
  }

  if (end <= start) {
    return this
  }

  start = start >>> 0
  end = end === undefined ? this.length : end >>> 0

  if (!val) val = 0

  var i
  if (typeof val === 'number') {
    for (i = start; i < end; ++i) {
      this[i] = val
    }
  } else {
    var bytes = Buffer.isBuffer(val)
      ? val
      : new Buffer(val, encoding)
    var len = bytes.length
    for (i = 0; i < end - start; ++i) {
      this[i + start] = bytes[i % len]
    }
  }

  return this
}

// HELPER FUNCTIONS
// ================

var INVALID_BASE64_RE = /[^+/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = str.trim().replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; ++i) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; ++i) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; ++i) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

// Node 0.10 supports `ArrayBuffer` but lacks `ArrayBuffer.isView`
function isArrayBufferView (obj) {
  return (typeof ArrayBuffer.isView === 'function') && ArrayBuffer.isView(obj)
}

function numberIsNaN (obj) {
  return obj !== obj // eslint-disable-line no-self-compare
}

},{"base64-js":5,"ieee754":21}],9:[function(require,module,exports){
var bnf = require("./parser").parser,
    ebnf = require("./ebnf-transform"),
    jisonlex = require("lex-parser");

exports.parse = function parse (grammar) { return bnf.parse(grammar); };
exports.transform = ebnf.transform;

// adds a declaration to the grammar
bnf.yy.addDeclaration = function (grammar, decl) {
    if (decl.start) {
        grammar.start = decl.start;

    } else if (decl.lex) {
        grammar.lex = parseLex(decl.lex);

    } else if (decl.operator) {
        if (!grammar.operators) grammar.operators = [];
        grammar.operators.push(decl.operator);

    } else if (decl.parseParam) {
        if (!grammar.parseParams) grammar.parseParams = [];
        grammar.parseParams = grammar.parseParams.concat(decl.parseParam);

    } else if (decl.include) {
        if (!grammar.moduleInclude) grammar.moduleInclude = '';
        grammar.moduleInclude += decl.include;

    } else if (decl.options) {
        if (!grammar.options) grammar.options = {};
        for (var i=0; i < decl.options.length; i++) {
            grammar.options[decl.options[i]] = true;
        }
    }

};

// parse an embedded lex section
var parseLex = function (text) {
    return jisonlex.parse(text.replace(/(?:^%lex)|(?:\/lex$)/g, ''));
};


},{"./ebnf-transform":10,"./parser":11,"lex-parser":29}],10:[function(require,module,exports){
var EBNF = (function(){
    var parser = require('./transform-parser.js');

    var transformExpression = function(e, opts, emit) {
        var type = e[0], value = e[1], name = false;

        if (type === 'xalias') {
            type = e[1];
            value = e[2]
            name = e[3];
            if (type) {
                e = e.slice(1,2);
            } else {
                e = value;
                type = e[0];
                value = e[1];
            }
        }

        if (type === 'symbol') {
            var n;
            if (e[1][0] === '\\') n = e[1][1];
            else if (e[1][0] === '\'') n = e[1].substring(1, e[1].length-1);
            else n = e[1];
            emit(n + (name ? "["+name+"]" : ""));
        } else if (type === "+") {
            if (!name) {
                name = opts.production + "_repetition_plus" + opts.repid++;
            }
            emit(name);

            opts = optsForProduction(name, opts.grammar);
            var list = transformExpressionList([value], opts);
            opts.grammar[name] = [
                [list, "$$ = [$1];"],
                [
                    name + " " + list,
                    "$1.push($2);"
                ]
            ];
        } else if (type === "*") {
            if (!name) {
                name = opts.production + "_repetition" + opts.repid++;
            }
            emit(name);

            opts = optsForProduction(name, opts.grammar);
            opts.grammar[name] = [
                ["", "$$ = [];"],
                [
                    name + " " + transformExpressionList([value], opts),
                    "$1.push($2);"
                ]
            ];
        } else if (type ==="?") {
            if (!name) {
                name = opts.production + "_option" + opts.optid++;
            }
            emit(name);

            opts = optsForProduction(name, opts.grammar);
            opts.grammar[name] = [
                "", transformExpressionList([value], opts)
            ];
        } else if (type === "()") {
            if (value.length == 1) {
                emit(transformExpressionList(value[0], opts));
            } else {
                if (!name) {
                    name = opts.production + "_group" + opts.groupid++;
                }
                emit(name);

                opts = optsForProduction(name, opts.grammar);
                opts.grammar[name] = value.map(function(handle) {
                    return transformExpressionList(handle, opts);
                });
            }
        }
    };

    var transformExpressionList = function(list, opts) {
        return list.reduce (function (tot, e) {
            transformExpression (e, opts, function (i) { tot.push(i); });
            return tot;
        }, []).
        join(" ");
    };

    var optsForProduction = function(id, grammar) {
        return {
            production: id,
            repid: 0,
            groupid: 0,
            optid: 0,
            grammar: grammar
        };
    };

    var transformProduction = function(id, production, grammar) {
        var transform_opts = optsForProduction(id, grammar);
        return production.map(function (handle) {
            var action = null, opts = null;
            if (typeof(handle) !== 'string')
                action = handle[1],
                opts = handle[2],
                handle = handle[0];
            var expressions = parser.parse(handle);

            handle = transformExpressionList(expressions, transform_opts);

            var ret = [handle];
            if (action) ret.push(action);
            if (opts) ret.push(opts);
            if (ret.length == 1) return ret[0];
            else return ret;
        });
    };

    var transformGrammar = function(grammar) {
        Object.keys(grammar).forEach(function(id) {
            grammar[id] = transformProduction(id, grammar[id], grammar);
        });
    };

    return {
        transform: function (ebnf) {
            transformGrammar(ebnf);
            return ebnf;
        }
    };
})();

exports.transform = EBNF.transform;


},{"./transform-parser.js":12}],11:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.11 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var bnf = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"spec":3,"declaration_list":4,"%%":5,"grammar":6,"optional_end_block":7,"EOF":8,"CODE":9,"declaration":10,"START":11,"id":12,"LEX_BLOCK":13,"operator":14,"ACTION":15,"parse_param":16,"options":17,"OPTIONS":18,"token_list":19,"PARSE_PARAM":20,"associativity":21,"LEFT":22,"RIGHT":23,"NONASSOC":24,"symbol":25,"production_list":26,"production":27,":":28,"handle_list":29,";":30,"|":31,"handle_action":32,"handle":33,"prec":34,"action":35,"expression_suffix":36,"handle_sublist":37,"expression":38,"suffix":39,"ALIAS":40,"ID":41,"STRING":42,"(":43,")":44,"*":45,"?":46,"+":47,"PREC":48,"{":49,"action_body":50,"}":51,"ARROW_ACTION":52,"action_comments_body":53,"ACTION_BODY":54,"$accept":0,"$end":1},
terminals_: {2:"error",5:"%%",8:"EOF",9:"CODE",11:"START",13:"LEX_BLOCK",15:"ACTION",18:"OPTIONS",20:"PARSE_PARAM",22:"LEFT",23:"RIGHT",24:"NONASSOC",28:":",30:";",31:"|",40:"ALIAS",41:"ID",42:"STRING",43:"(",44:")",45:"*",46:"?",47:"+",48:"PREC",49:"{",51:"}",52:"ARROW_ACTION",54:"ACTION_BODY"},
productions_: [0,[3,5],[3,6],[7,0],[7,1],[4,2],[4,0],[10,2],[10,1],[10,1],[10,1],[10,1],[10,1],[17,2],[16,2],[14,2],[21,1],[21,1],[21,1],[19,2],[19,1],[6,1],[26,2],[26,1],[27,4],[29,3],[29,1],[32,3],[33,2],[33,0],[37,3],[37,1],[36,3],[36,2],[38,1],[38,1],[38,3],[39,0],[39,1],[39,1],[39,1],[34,2],[34,0],[25,1],[25,1],[12,1],[35,3],[35,1],[35,1],[35,0],[50,0],[50,1],[50,5],[50,4],[53,1],[53,2]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1:
          this.$ = $$[$0-4];
          return extend(this.$, $$[$0-2]);
        
break;
case 2:
          this.$ = $$[$0-5];
          yy.addDeclaration(this.$, { include: $$[$0-1] });
          return extend(this.$, $$[$0-3]);
        
break;
case 5:this.$ = $$[$0-1]; yy.addDeclaration(this.$, $$[$0]);
break;
case 6:this.$ = {};
break;
case 7:this.$ = {start: $$[$0]};
break;
case 8:this.$ = {lex: $$[$0]};
break;
case 9:this.$ = {operator: $$[$0]};
break;
case 10:this.$ = {include: $$[$0]};
break;
case 11:this.$ = {parseParam: $$[$0]};
break;
case 12:this.$ = {options: $$[$0]};
break;
case 13:this.$ = $$[$0];
break;
case 14:this.$ = $$[$0];
break;
case 15:this.$ = [$$[$0-1]]; this.$.push.apply(this.$, $$[$0]);
break;
case 16:this.$ = 'left';
break;
case 17:this.$ = 'right';
break;
case 18:this.$ = 'nonassoc';
break;
case 19:this.$ = $$[$0-1]; this.$.push($$[$0]);
break;
case 20:this.$ = [$$[$0]];
break;
case 21:this.$ = $$[$0];
break;
case 22:
            this.$ = $$[$0-1];
            if ($$[$0][0] in this.$) 
                this.$[$$[$0][0]] = this.$[$$[$0][0]].concat($$[$0][1]);
            else
                this.$[$$[$0][0]] = $$[$0][1];
        
break;
case 23:this.$ = {}; this.$[$$[$0][0]] = $$[$0][1];
break;
case 24:this.$ = [$$[$0-3], $$[$0-1]];
break;
case 25:this.$ = $$[$0-2]; this.$.push($$[$0]);
break;
case 26:this.$ = [$$[$0]];
break;
case 27:
            this.$ = [($$[$0-2].length ? $$[$0-2].join(' ') : '')];
            if($$[$0]) this.$.push($$[$0]);
            if($$[$0-1]) this.$.push($$[$0-1]);
            if (this.$.length === 1) this.$ = this.$[0];
        
break;
case 28:this.$ = $$[$0-1]; this.$.push($$[$0])
break;
case 29:this.$ = [];
break;
case 30:this.$ = $$[$0-2]; this.$.push($$[$0].join(' '));
break;
case 31:this.$ = [$$[$0].join(' ')];
break;
case 32:this.$ = $$[$0-2] + $$[$0-1] + "[" + $$[$0] + "]"; 
break;
case 33:this.$ = $$[$0-1] + $$[$0]; 
break;
case 34:this.$ = $$[$0]; 
break;
case 35:this.$ = ebnf ? "'" + $$[$0] + "'" : $$[$0]; 
break;
case 36:this.$ = '(' + $$[$0-1].join(' | ') + ')'; 
break;
case 37:this.$ = ''
break;
case 41:this.$ = {prec: $$[$0]};
break;
case 42:this.$ = null;
break;
case 43:this.$ = $$[$0];
break;
case 44:this.$ = yytext;
break;
case 45:this.$ = yytext;
break;
case 46:this.$ = $$[$0-1];
break;
case 47:this.$ = $$[$0];
break;
case 48:this.$ = '$$ =' + $$[$0] + ';';
break;
case 49:this.$ = '';
break;
case 50:this.$ = '';
break;
case 51:this.$ = $$[$0];
break;
case 52:this.$ = $$[$0-4] + $$[$0-3] + $$[$0-2] + $$[$0-1] + $$[$0];
break;
case 53:this.$ = $$[$0-3] + $$[$0-2] + $$[$0-1] + $$[$0];
break;
case 54: this.$ = yytext; 
break;
case 55: this.$ = $$[$0-1]+$$[$0]; 
break;
}
},
table: [{3:1,4:2,5:[2,6],11:[2,6],13:[2,6],15:[2,6],18:[2,6],20:[2,6],22:[2,6],23:[2,6],24:[2,6]},{1:[3]},{5:[1,3],10:4,11:[1,5],13:[1,6],14:7,15:[1,8],16:9,17:10,18:[1,13],20:[1,12],21:11,22:[1,14],23:[1,15],24:[1,16]},{6:17,12:20,26:18,27:19,41:[1,21]},{5:[2,5],11:[2,5],13:[2,5],15:[2,5],18:[2,5],20:[2,5],22:[2,5],23:[2,5],24:[2,5]},{12:22,41:[1,21]},{5:[2,8],11:[2,8],13:[2,8],15:[2,8],18:[2,8],20:[2,8],22:[2,8],23:[2,8],24:[2,8]},{5:[2,9],11:[2,9],13:[2,9],15:[2,9],18:[2,9],20:[2,9],22:[2,9],23:[2,9],24:[2,9]},{5:[2,10],11:[2,10],13:[2,10],15:[2,10],18:[2,10],20:[2,10],22:[2,10],23:[2,10],24:[2,10]},{5:[2,11],11:[2,11],13:[2,11],15:[2,11],18:[2,11],20:[2,11],22:[2,11],23:[2,11],24:[2,11]},{5:[2,12],11:[2,12],13:[2,12],15:[2,12],18:[2,12],20:[2,12],22:[2,12],23:[2,12],24:[2,12]},{12:25,19:23,25:24,41:[1,21],42:[1,26]},{12:25,19:27,25:24,41:[1,21],42:[1,26]},{12:25,19:28,25:24,41:[1,21],42:[1,26]},{41:[2,16],42:[2,16]},{41:[2,17],42:[2,17]},{41:[2,18],42:[2,18]},{5:[1,30],7:29,8:[2,3]},{5:[2,21],8:[2,21],12:20,27:31,41:[1,21]},{5:[2,23],8:[2,23],41:[2,23]},{28:[1,32]},{5:[2,45],11:[2,45],13:[2,45],15:[2,45],18:[2,45],20:[2,45],22:[2,45],23:[2,45],24:[2,45],28:[2,45],30:[2,45],31:[2,45],41:[2,45],42:[2,45],49:[2,45],52:[2,45]},{5:[2,7],11:[2,7],13:[2,7],15:[2,7],18:[2,7],20:[2,7],22:[2,7],23:[2,7],24:[2,7]},{5:[2,15],11:[2,15],12:25,13:[2,15],15:[2,15],18:[2,15],20:[2,15],22:[2,15],23:[2,15],24:[2,15],25:33,41:[1,21],42:[1,26]},{5:[2,20],11:[2,20],13:[2,20],15:[2,20],18:[2,20],20:[2,20],22:[2,20],23:[2,20],24:[2,20],41:[2,20],42:[2,20]},{5:[2,43],11:[2,43],13:[2,43],15:[2,43],18:[2,43],20:[2,43],22:[2,43],23:[2,43],24:[2,43],30:[2,43],31:[2,43],41:[2,43],42:[2,43],49:[2,43],52:[2,43]},{5:[2,44],11:[2,44],13:[2,44],15:[2,44],18:[2,44],20:[2,44],22:[2,44],23:[2,44],24:[2,44],30:[2,44],31:[2,44],41:[2,44],42:[2,44],49:[2,44],52:[2,44]},{5:[2,14],11:[2,14],12:25,13:[2,14],15:[2,14],18:[2,14],20:[2,14],22:[2,14],23:[2,14],24:[2,14],25:33,41:[1,21],42:[1,26]},{5:[2,13],11:[2,13],12:25,13:[2,13],15:[2,13],18:[2,13],20:[2,13],22:[2,13],23:[2,13],24:[2,13],25:33,41:[1,21],42:[1,26]},{8:[1,34]},{8:[2,4],9:[1,35]},{5:[2,22],8:[2,22],41:[2,22]},{15:[2,29],29:36,30:[2,29],31:[2,29],32:37,33:38,41:[2,29],42:[2,29],43:[2,29],48:[2,29],49:[2,29],52:[2,29]},{5:[2,19],11:[2,19],13:[2,19],15:[2,19],18:[2,19],20:[2,19],22:[2,19],23:[2,19],24:[2,19],41:[2,19],42:[2,19]},{1:[2,1]},{8:[1,39]},{30:[1,40],31:[1,41]},{30:[2,26],31:[2,26]},{15:[2,42],30:[2,42],31:[2,42],34:42,36:43,38:45,41:[1,46],42:[1,47],43:[1,48],48:[1,44],49:[2,42],52:[2,42]},{1:[2,2]},{5:[2,24],8:[2,24],41:[2,24]},{15:[2,29],30:[2,29],31:[2,29],32:49,33:38,41:[2,29],42:[2,29],43:[2,29],48:[2,29],49:[2,29],52:[2,29]},{15:[1,52],30:[2,49],31:[2,49],35:50,49:[1,51],52:[1,53]},{15:[2,28],30:[2,28],31:[2,28],41:[2,28],42:[2,28],43:[2,28],44:[2,28],48:[2,28],49:[2,28],52:[2,28]},{12:25,25:54,41:[1,21],42:[1,26]},{15:[2,37],30:[2,37],31:[2,37],39:55,40:[2,37],41:[2,37],42:[2,37],43:[2,37],44:[2,37],45:[1,56],46:[1,57],47:[1,58],48:[2,37],49:[2,37],52:[2,37]},{15:[2,34],30:[2,34],31:[2,34],40:[2,34],41:[2,34],42:[2,34],43:[2,34],44:[2,34],45:[2,34],46:[2,34],47:[2,34],48:[2,34],49:[2,34],52:[2,34]},{15:[2,35],30:[2,35],31:[2,35],40:[2,35],41:[2,35],42:[2,35],43:[2,35],44:[2,35],45:[2,35],46:[2,35],47:[2,35],48:[2,35],49:[2,35],52:[2,35]},{31:[2,29],33:60,37:59,41:[2,29],42:[2,29],43:[2,29],44:[2,29]},{30:[2,25],31:[2,25]},{30:[2,27],31:[2,27]},{49:[2,50],50:61,51:[2,50],53:62,54:[1,63]},{30:[2,47],31:[2,47]},{30:[2,48],31:[2,48]},{15:[2,41],30:[2,41],31:[2,41],49:[2,41],52:[2,41]},{15:[2,33],30:[2,33],31:[2,33],40:[1,64],41:[2,33],42:[2,33],43:[2,33],44:[2,33],48:[2,33],49:[2,33],52:[2,33]},{15:[2,38],30:[2,38],31:[2,38],40:[2,38],41:[2,38],42:[2,38],43:[2,38],44:[2,38],48:[2,38],49:[2,38],52:[2,38]},{15:[2,39],30:[2,39],31:[2,39],40:[2,39],41:[2,39],42:[2,39],43:[2,39],44:[2,39],48:[2,39],49:[2,39],52:[2,39]},{15:[2,40],30:[2,40],31:[2,40],40:[2,40],41:[2,40],42:[2,40],43:[2,40],44:[2,40],48:[2,40],49:[2,40],52:[2,40]},{31:[1,66],44:[1,65]},{31:[2,31],36:43,38:45,41:[1,46],42:[1,47],43:[1,48],44:[2,31]},{49:[1,68],51:[1,67]},{49:[2,51],51:[2,51],54:[1,69]},{49:[2,54],51:[2,54],54:[2,54]},{15:[2,32],30:[2,32],31:[2,32],41:[2,32],42:[2,32],43:[2,32],44:[2,32],48:[2,32],49:[2,32],52:[2,32]},{15:[2,36],30:[2,36],31:[2,36],40:[2,36],41:[2,36],42:[2,36],43:[2,36],44:[2,36],45:[2,36],46:[2,36],47:[2,36],48:[2,36],49:[2,36],52:[2,36]},{31:[2,29],33:70,41:[2,29],42:[2,29],43:[2,29],44:[2,29]},{30:[2,46],31:[2,46]},{49:[2,50],50:71,51:[2,50],53:62,54:[1,63]},{49:[2,55],51:[2,55],54:[2,55]},{31:[2,30],36:43,38:45,41:[1,46],42:[1,47],43:[1,48],44:[2,30]},{49:[1,68],51:[1,72]},{49:[2,53],51:[2,53],53:73,54:[1,63]},{49:[2,52],51:[2,52],54:[1,69]}],
defaultActions: {34:[2,1],39:[2,2]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        throw new Error(str);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    var args = lstack.slice.call(arguments, 1);
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == 'undefined') {
        this.lexer.yylloc = {};
    }
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === 'function') {
        this.parseError = this.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || EOF;
        if (typeof token !== 'number') {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (this.lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + this.lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: this.lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: this.lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.apply(yyval, [
                yytext,
                yyleng,
                yylineno,
                this.yy,
                action[1],
                vstack,
                lstack
            ].concat(args));
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};

var transform = require('./ebnf-transform').transform;
var ebnf = false;


// transform ebnf to bnf if necessary
function extend (json, grammar) {
    json.bnf = ebnf ? transform(grammar) : grammar;
    return json;
}

/* generated by jison-lex 0.2.1 */
var lexer = (function(){
var lexer = {

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input) {
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len - 1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:this.pushState('code');return 5;
break;
case 1:return 43;
break;
case 2:return 44;
break;
case 3:return 45;
break;
case 4:return 46;
break;
case 5:return 47;
break;
case 6:/* skip whitespace */
break;
case 7:/* skip comment */
break;
case 8:/* skip comment */
break;
case 9:yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 40;
break;
case 10:return 41;
break;
case 11:yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 42;
break;
case 12:yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 42;
break;
case 13:return 28;
break;
case 14:return 30;
break;
case 15:return 31;
break;
case 16:this.pushState(ebnf ? 'ebnf' : 'bnf'); return 5;
break;
case 17:if (!yy.options) yy.options = {}; ebnf = yy.options.ebnf = true;
break;
case 18:return 48;
break;
case 19:return 11;
break;
case 20:return 22;
break;
case 21:return 23;
break;
case 22:return 24;
break;
case 23:return 20;
break;
case 24:return 18;
break;
case 25:return 13;
break;
case 26:/* ignore unrecognized decl */
break;
case 27:/* ignore type */
break;
case 28:yy_.yytext = yy_.yytext.substr(2, yy_.yyleng-4); return 15;
break;
case 29:yy_.yytext = yy_.yytext.substr(2, yy_.yytext.length-4); return 15;
break;
case 30:yy.depth = 0; this.pushState('action'); return 49;
break;
case 31:yy_.yytext = yy_.yytext.substr(2, yy_.yyleng-2); return 52;
break;
case 32:/* ignore bad characters */
break;
case 33:return 8;
break;
case 34:return 54;
break;
case 35:return 54;
break;
case 36:return 54; // regexp with braces or quotes (and no spaces)
break;
case 37:return 54;
break;
case 38:return 54;
break;
case 39:return 54;
break;
case 40:return 54;
break;
case 41:yy.depth++; return 49;
break;
case 42:if (yy.depth==0) this.begin(ebnf ? 'ebnf' : 'bnf'); else yy.depth--; return 51;
break;
case 43:return 9;
break;
}
},
rules: [/^(?:%%)/,/^(?:\()/,/^(?:\))/,/^(?:\*)/,/^(?:\?)/,/^(?:\+)/,/^(?:\s+)/,/^(?:\/\/.*)/,/^(?:\/\*(.|\n|\r)*?\*\/)/,/^(?:\[([a-zA-Z][a-zA-Z0-9_-]*)\])/,/^(?:([a-zA-Z][a-zA-Z0-9_-]*))/,/^(?:"[^"]+")/,/^(?:'[^']+')/,/^(?::)/,/^(?:;)/,/^(?:\|)/,/^(?:%%)/,/^(?:%ebnf\b)/,/^(?:%prec\b)/,/^(?:%start\b)/,/^(?:%left\b)/,/^(?:%right\b)/,/^(?:%nonassoc\b)/,/^(?:%parse-param\b)/,/^(?:%options\b)/,/^(?:%lex[\w\W]*?\/lex\b)/,/^(?:%[a-zA-Z]+[^\r\n]*)/,/^(?:<[a-zA-Z]*>)/,/^(?:\{\{[\w\W]*?\}\})/,/^(?:%\{(.|\r|\n)*?%\})/,/^(?:\{)/,/^(?:->.*)/,/^(?:.)/,/^(?:$)/,/^(?:\/\*(.|\n|\r)*?\*\/)/,/^(?:\/\/.*)/,/^(?:\/[^ /]*?['"{}'][^ ]*?\/)/,/^(?:"(\\\\|\\"|[^"])*")/,/^(?:'(\\\\|\\'|[^'])*')/,/^(?:[/"'][^{}/"']+)/,/^(?:[^{}/"']+)/,/^(?:\{)/,/^(?:\})/,/^(?:(.|\n|\r)+)/],
conditions: {"bnf":{"rules":[0,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33],"inclusive":true},"ebnf":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33],"inclusive":true},"action":{"rules":[33,34,35,36,37,38,39,40,41,42],"inclusive":false},"code":{"rules":[33,43],"inclusive":false},"INITIAL":{"rules":[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33],"inclusive":true}}
};
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = bnf;
exports.Parser = bnf.Parser;
exports.parse = function () { return bnf.parse.apply(bnf, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require('_process'))
},{"./ebnf-transform":10,"_process":33,"fs":7,"path":32}],12:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.11 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var ebnf = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"production":3,"handle":4,"EOF":5,"handle_list":6,"|":7,"expression_suffix":8,"expression":9,"suffix":10,"ALIAS":11,"symbol":12,"(":13,")":14,"*":15,"?":16,"+":17,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",7:"|",11:"ALIAS",12:"symbol",13:"(",14:")",15:"*",16:"?",17:"+"},
productions_: [0,[3,2],[6,1],[6,3],[4,0],[4,2],[8,3],[8,2],[9,1],[9,3],[10,0],[10,1],[10,1],[10,1]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1: return $$[$0-1]; 
break;
case 2: this.$ = [$$[$0]]; 
break;
case 3: $$[$0-2].push($$[$0]); 
break;
case 4: this.$ = []; 
break;
case 5: $$[$0-1].push($$[$0]); 
break;
case 6: this.$ = ['xalias', $$[$0-1], $$[$0-2], $$[$0]]; 
break;
case 7: if ($$[$0]) this.$ = [$$[$0], $$[$0-1]]; else this.$ = $$[$0-1]; 
break;
case 8: this.$ = ['symbol', $$[$0]]; 
break;
case 9: this.$ = ['()', $$[$0-1]]; 
break;
}
},
table: [{3:1,4:2,5:[2,4],12:[2,4],13:[2,4]},{1:[3]},{5:[1,3],8:4,9:5,12:[1,6],13:[1,7]},{1:[2,1]},{5:[2,5],7:[2,5],12:[2,5],13:[2,5],14:[2,5]},{5:[2,10],7:[2,10],10:8,11:[2,10],12:[2,10],13:[2,10],14:[2,10],15:[1,9],16:[1,10],17:[1,11]},{5:[2,8],7:[2,8],11:[2,8],12:[2,8],13:[2,8],14:[2,8],15:[2,8],16:[2,8],17:[2,8]},{4:13,6:12,7:[2,4],12:[2,4],13:[2,4],14:[2,4]},{5:[2,7],7:[2,7],11:[1,14],12:[2,7],13:[2,7],14:[2,7]},{5:[2,11],7:[2,11],11:[2,11],12:[2,11],13:[2,11],14:[2,11]},{5:[2,12],7:[2,12],11:[2,12],12:[2,12],13:[2,12],14:[2,12]},{5:[2,13],7:[2,13],11:[2,13],12:[2,13],13:[2,13],14:[2,13]},{7:[1,16],14:[1,15]},{7:[2,2],8:4,9:5,12:[1,6],13:[1,7],14:[2,2]},{5:[2,6],7:[2,6],12:[2,6],13:[2,6],14:[2,6]},{5:[2,9],7:[2,9],11:[2,9],12:[2,9],13:[2,9],14:[2,9],15:[2,9],16:[2,9],17:[2,9]},{4:17,7:[2,4],12:[2,4],13:[2,4],14:[2,4]},{7:[2,3],8:4,9:5,12:[1,6],13:[1,7],14:[2,3]}],
defaultActions: {3:[2,1]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        throw new Error(str);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    var args = lstack.slice.call(arguments, 1);
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == 'undefined') {
        this.lexer.yylloc = {};
    }
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === 'function') {
        this.parseError = this.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || EOF;
        if (typeof token !== 'number') {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (this.lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + this.lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: this.lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: this.lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.apply(yyval, [
                yytext,
                yyleng,
                yylineno,
                this.yy,
                action[1],
                vstack,
                lstack
            ].concat(args));
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};
/* generated by jison-lex 0.2.1 */
var lexer = (function(){
var lexer = {

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input) {
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len - 1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:/* skip whitespace */
break;
case 1:return 12;
break;
case 2:yy_.yytext = yy_.yytext.substr(1, yy_.yyleng-2); return 11;
break;
case 3:return 12;
break;
case 4:return 12;
break;
case 5:return 'bar';
break;
case 6:return 13;
break;
case 7:return 14;
break;
case 8:return 15;
break;
case 9:return 16;
break;
case 10:return 7;
break;
case 11:return 17;
break;
case 12:return 5;
break;
}
},
rules: [/^(?:\s+)/,/^(?:([a-zA-Z][a-zA-Z0-9_-]*))/,/^(?:\[([a-zA-Z][a-zA-Z0-9_-]*)\])/,/^(?:'[^']*')/,/^(?:\.)/,/^(?:bar\b)/,/^(?:\()/,/^(?:\))/,/^(?:\*)/,/^(?:\?)/,/^(?:\|)/,/^(?:\+)/,/^(?:$)/],
conditions: {"INITIAL":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,12],"inclusive":true}}
};
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = ebnf;
exports.Parser = ebnf.Parser;
exports.parse = function () { return ebnf.parse.apply(ebnf, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require('_process'))
},{"_process":33,"fs":7,"path":32}],13:[function(require,module,exports){
(function (global){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012-2013 Michael Ficarra <escodegen.copyright@michael.ficarra.me>
  Copyright (C) 2012-2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2013 Irakli Gozalishvili <rfobic@gmail.com>
  Copyright (C) 2012 Robert Gust-Bardon <donate@robert.gust-bardon.org>
  Copyright (C) 2012 John Freeman <jfreeman08@gmail.com>
  Copyright (C) 2011-2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*global exports:true, generateStatement:true, generateExpression:true, require:true, global:true*/
(function () {
    'use strict';

    var Syntax,
        Precedence,
        BinaryPrecedence,
        SourceNode,
        estraverse,
        esutils,
        isArray,
        base,
        indent,
        json,
        renumber,
        hexadecimal,
        quotes,
        escapeless,
        newline,
        space,
        parentheses,
        semicolons,
        safeConcatenation,
        directive,
        extra,
        parse,
        sourceMap,
        FORMAT_MINIFY,
        FORMAT_DEFAULTS;

    estraverse = require('estraverse');
    esutils = require('esutils');

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ComprehensionBlock: 'ComprehensionBlock',
        ComprehensionExpression: 'ComprehensionExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExportDeclaration: 'ExportDeclaration',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        ForOfStatement: 'ForOfStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        GeneratorExpression: 'GeneratorExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        ImportDeclaration: 'ImportDeclaration',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    Precedence = {
        Sequence: 0,
        Yield: 1,
        Assignment: 1,
        Conditional: 2,
        ArrowFunction: 2,
        LogicalOR: 3,
        LogicalAND: 4,
        BitwiseOR: 5,
        BitwiseXOR: 6,
        BitwiseAND: 7,
        Equality: 8,
        Relational: 9,
        BitwiseSHIFT: 10,
        Additive: 11,
        Multiplicative: 12,
        Unary: 13,
        Postfix: 14,
        Call: 15,
        New: 16,
        Member: 17,
        Primary: 18
    };

    BinaryPrecedence = {
        '||': Precedence.LogicalOR,
        '&&': Precedence.LogicalAND,
        '|': Precedence.BitwiseOR,
        '^': Precedence.BitwiseXOR,
        '&': Precedence.BitwiseAND,
        '==': Precedence.Equality,
        '!=': Precedence.Equality,
        '===': Precedence.Equality,
        '!==': Precedence.Equality,
        'is': Precedence.Equality,
        'isnt': Precedence.Equality,
        '<': Precedence.Relational,
        '>': Precedence.Relational,
        '<=': Precedence.Relational,
        '>=': Precedence.Relational,
        'in': Precedence.Relational,
        'instanceof': Precedence.Relational,
        '<<': Precedence.BitwiseSHIFT,
        '>>': Precedence.BitwiseSHIFT,
        '>>>': Precedence.BitwiseSHIFT,
        '+': Precedence.Additive,
        '-': Precedence.Additive,
        '*': Precedence.Multiplicative,
        '%': Precedence.Multiplicative,
        '/': Precedence.Multiplicative
    };

    function getDefaultOptions() {
        // default options
        return {
            indent: null,
            base: null,
            parse: null,
            comment: false,
            format: {
                indent: {
                    style: '    ',
                    base: 0,
                    adjustMultilineComment: false
                },
                newline: '\n',
                space: ' ',
                json: false,
                renumber: false,
                hexadecimal: false,
                quotes: 'single',
                escapeless: false,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: false
            },
            moz: {
                comprehensionExpressionStartsWithAssignment: false,
                starlessGenerator: false,
                parenthesizedComprehensionBlock: false
            },
            sourceMap: null,
            sourceMapRoot: null,
            sourceMapWithCode: false,
            directive: false,
            raw: true,
            verbatim: null
        };
    }

    function stringRepeat(str, num) {
        var result = '';

        for (num |= 0; num > 0; num >>>= 1, str += str) {
            if (num & 1) {
                result += str;
            }
        }

        return result;
    }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function hasLineTerminator(str) {
        return (/[\r\n]/g).test(str);
    }

    function endsWithLineTerminator(str) {
        var len = str.length;
        return len && esutils.code.isLineTerminator(str.charCodeAt(len - 1));
    }

    function updateDeeply(target, override) {
        var key, val;

        function isHashObject(target) {
            return typeof target === 'object' && target instanceof Object && !(target instanceof RegExp);
        }

        for (key in override) {
            if (override.hasOwnProperty(key)) {
                val = override[key];
                if (isHashObject(val)) {
                    if (isHashObject(target[key])) {
                        updateDeeply(target[key], val);
                    } else {
                        target[key] = updateDeeply({}, val);
                    }
                } else {
                    target[key] = val;
                }
            }
        }
        return target;
    }

    function generateNumber(value) {
        var result, point, temp, exponent, pos;

        if (value !== value) {
            throw new Error('Numeric literal whose value is NaN');
        }
        if (value < 0 || (value === 0 && 1 / value < 0)) {
            throw new Error('Numeric literal whose value is negative');
        }

        if (value === 1 / 0) {
            return json ? 'null' : renumber ? '1e400' : '1e+400';
        }

        result = '' + value;
        if (!renumber || result.length < 3) {
            return result;
        }

        point = result.indexOf('.');
        if (!json && result.charCodeAt(0) === 0x30  /* 0 */ && point === 1) {
            point = 0;
            result = result.slice(1);
        }
        temp = result;
        result = result.replace('e+', 'e');
        exponent = 0;
        if ((pos = temp.indexOf('e')) > 0) {
            exponent = +temp.slice(pos + 1);
            temp = temp.slice(0, pos);
        }
        if (point >= 0) {
            exponent -= temp.length - point - 1;
            temp = +(temp.slice(0, point) + temp.slice(point + 1)) + '';
        }
        pos = 0;
        while (temp.charCodeAt(temp.length + pos - 1) === 0x30  /* 0 */) {
            --pos;
        }
        if (pos !== 0) {
            exponent -= pos;
            temp = temp.slice(0, pos);
        }
        if (exponent !== 0) {
            temp += 'e' + exponent;
        }
        if ((temp.length < result.length ||
                    (hexadecimal && value > 1e12 && Math.floor(value) === value && (temp = '0x' + value.toString(16)).length < result.length)) &&
                +temp === value) {
            result = temp;
        }

        return result;
    }

    // Generate valid RegExp expression.
    // This function is based on https://github.com/Constellation/iv Engine

    function escapeRegExpCharacter(ch, previousIsBackslash) {
        // not handling '\' and handling \u2028 or \u2029 to unicode escape sequence
        if ((ch & ~1) === 0x2028) {
            return (previousIsBackslash ? 'u' : '\\u') + ((ch === 0x2028) ? '2028' : '2029');
        } else if (ch === 10 || ch === 13) {  // \n, \r
            return (previousIsBackslash ? '' : '\\') + ((ch === 10) ? 'n' : 'r');
        }
        return String.fromCharCode(ch);
    }

    function generateRegExp(reg) {
        var match, result, flags, i, iz, ch, characterInBrack, previousIsBackslash;

        result = reg.toString();

        if (reg.source) {
            // extract flag from toString result
            match = result.match(/\/([^/]*)$/);
            if (!match) {
                return result;
            }

            flags = match[1];
            result = '';

            characterInBrack = false;
            previousIsBackslash = false;
            for (i = 0, iz = reg.source.length; i < iz; ++i) {
                ch = reg.source.charCodeAt(i);

                if (!previousIsBackslash) {
                    if (characterInBrack) {
                        if (ch === 93) {  // ]
                            characterInBrack = false;
                        }
                    } else {
                        if (ch === 47) {  // /
                            result += '\\';
                        } else if (ch === 91) {  // [
                            characterInBrack = true;
                        }
                    }
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    previousIsBackslash = ch === 92;  // \
                } else {
                    // if new RegExp("\\\n') is provided, create /\n/
                    result += escapeRegExpCharacter(ch, previousIsBackslash);
                    // prevent like /\\[/]/
                    previousIsBackslash = false;
                }
            }

            return '/' + result + '/' + flags;
        }

        return result;
    }

    function escapeAllowedCharacter(code, next) {
        var hex, result = '\\';

        switch (code) {
        case 0x08  /* \b */:
            result += 'b';
            break;
        case 0x0C  /* \f */:
            result += 'f';
            break;
        case 0x09  /* \t */:
            result += 't';
            break;
        default:
            hex = code.toString(16).toUpperCase();
            if (json || code > 0xFF) {
                result += 'u' + '0000'.slice(hex.length) + hex;
            } else if (code === 0x0000 && !esutils.code.isDecimalDigit(next)) {
                result += '0';
            } else if (code === 0x000B  /* \v */) { // '\v'
                result += 'x0B';
            } else {
                result += 'x' + '00'.slice(hex.length) + hex;
            }
            break;
        }

        return result;
    }

    function escapeDisallowedCharacter(code) {
        var result = '\\';
        switch (code) {
        case 0x5C  /* \ */:
            result += '\\';
            break;
        case 0x0A  /* \n */:
            result += 'n';
            break;
        case 0x0D  /* \r */:
            result += 'r';
            break;
        case 0x2028:
            result += 'u2028';
            break;
        case 0x2029:
            result += 'u2029';
            break;
        default:
            throw new Error('Incorrectly classified character');
        }

        return result;
    }

    function escapeDirective(str) {
        var i, iz, code, quote;

        quote = quotes === 'double' ? '"' : '\'';
        for (i = 0, iz = str.length; i < iz; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                quote = '"';
                break;
            } else if (code === 0x22  /* " */) {
                quote = '\'';
                break;
            } else if (code === 0x5C  /* \ */) {
                ++i;
            }
        }

        return quote + str + quote;
    }

    function escapeString(str) {
        var result = '', i, len, code, singleQuotes = 0, doubleQuotes = 0, single, quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if (code === 0x27  /* ' */) {
                ++singleQuotes;
            } else if (code === 0x22  /* " */) {
                ++doubleQuotes;
            } else if (code === 0x2F  /* / */ && json) {
                result += '\\';
            } else if (esutils.code.isLineTerminator(code) || code === 0x5C  /* \ */) {
                result += escapeDisallowedCharacter(code);
                continue;
            } else if ((json && code < 0x20  /* SP */) || !(json || escapeless || (code >= 0x20  /* SP */ && code <= 0x7E  /* ~ */))) {
                result += escapeAllowedCharacter(code, str.charCodeAt(i + 1));
                continue;
            }
            result += String.fromCharCode(code);
        }

        single = !(quotes === 'double' || (quotes === 'auto' && doubleQuotes < singleQuotes));
        quote = single ? '\'' : '"';

        if (!(single ? singleQuotes : doubleQuotes)) {
            return quote + result + quote;
        }

        str = result;
        result = quote;

        for (i = 0, len = str.length; i < len; ++i) {
            code = str.charCodeAt(i);
            if ((code === 0x27  /* ' */ && single) || (code === 0x22  /* " */ && !single)) {
                result += '\\';
            }
            result += String.fromCharCode(code);
        }

        return result + quote;
    }

    /**
     * flatten an array to a string, where the array can contain
     * either strings or nested arrays
     */
    function flattenToString(arr) {
        var i, iz, elem, result = '';
        for (i = 0, iz = arr.length; i < iz; ++i) {
            elem = arr[i];
            result += isArray(elem) ? flattenToString(elem) : elem;
        }
        return result;
    }

    /**
     * convert generated to a SourceNode when source maps are enabled.
     */
    function toSourceNodeWhenNeeded(generated, node) {
        if (!sourceMap) {
            // with no source maps, generated is either an
            // array or a string.  if an array, flatten it.
            // if a string, just return it
            if (isArray(generated)) {
                return flattenToString(generated);
            } else {
                return generated;
            }
        }
        if (node == null) {
            if (generated instanceof SourceNode) {
                return generated;
            } else {
                node = {};
            }
        }
        if (node.loc == null) {
            return new SourceNode(null, null, sourceMap, generated, node.name || null);
        }
        return new SourceNode(node.loc.start.line, node.loc.start.column, (sourceMap === true ? node.loc.source || null : sourceMap), generated, node.name || null);
    }

    function noEmptySpace() {
        return (space) ? space : ' ';
    }

    function join(left, right) {
        var leftSource = toSourceNodeWhenNeeded(left).toString(),
            rightSource = toSourceNodeWhenNeeded(right).toString(),
            leftCharCode = leftSource.charCodeAt(leftSource.length - 1),
            rightCharCode = rightSource.charCodeAt(0);

        if ((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode ||
        esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode) ||
        leftCharCode === 0x2F  /* / */ && rightCharCode === 0x69  /* i */) { // infix word operators all start with `i`
            return [left, noEmptySpace(), right];
        } else if (esutils.code.isWhiteSpace(leftCharCode) || esutils.code.isLineTerminator(leftCharCode) ||
                esutils.code.isWhiteSpace(rightCharCode) || esutils.code.isLineTerminator(rightCharCode)) {
            return [left, right];
        }
        return [left, space, right];
    }

    function addIndent(stmt) {
        return [base, stmt];
    }

    function withIndent(fn) {
        var previousBase, result;
        previousBase = base;
        base += indent;
        result = fn.call(this, base);
        base = previousBase;
        return result;
    }

    function calculateSpaces(str) {
        var i;
        for (i = str.length - 1; i >= 0; --i) {
            if (esutils.code.isLineTerminator(str.charCodeAt(i))) {
                break;
            }
        }
        return (str.length - 1) - i;
    }

    function adjustMultilineComment(value, specialBase) {
        var array, i, len, line, j, spaces, previousBase, sn;

        array = value.split(/\r\n|[\r\n]/);
        spaces = Number.MAX_VALUE;

        // first line doesn't have indentation
        for (i = 1, len = array.length; i < len; ++i) {
            line = array[i];
            j = 0;
            while (j < line.length && esutils.code.isWhiteSpace(line.charCodeAt(j))) {
                ++j;
            }
            if (spaces > j) {
                spaces = j;
            }
        }

        if (typeof specialBase !== 'undefined') {
            // pattern like
            // {
            //   var t = 20;  /*
            //                 * this is comment
            //                 */
            // }
            previousBase = base;
            if (array[1][spaces] === '*') {
                specialBase += ' ';
            }
            base = specialBase;
        } else {
            if (spaces & 1) {
                // /*
                //  *
                //  */
                // If spaces are odd number, above pattern is considered.
                // We waste 1 space.
                --spaces;
            }
            previousBase = base;
        }

        for (i = 1, len = array.length; i < len; ++i) {
            sn = toSourceNodeWhenNeeded(addIndent(array[i].slice(spaces)));
            array[i] = sourceMap ? sn.join('') : sn;
        }

        base = previousBase;

        return array.join('\n');
    }

    function generateComment(comment, specialBase) {
        if (comment.type === 'Line') {
            if (endsWithLineTerminator(comment.value)) {
                return '//' + comment.value;
            } else {
                // Always use LineTerminator
                return '//' + comment.value + '\n';
            }
        }
        if (extra.format.indent.adjustMultilineComment && /[\n\r]/.test(comment.value)) {
            return adjustMultilineComment('/*' + comment.value + '*/', specialBase);
        }
        return '/*' + comment.value + '*/';
    }

    function addComments(stmt, result) {
        var i, len, comment, save, tailingToStatement, specialBase, fragment;

        if (stmt.leadingComments && stmt.leadingComments.length > 0) {
            save = result;

            comment = stmt.leadingComments[0];
            result = [];
            if (safeConcatenation && stmt.type === Syntax.Program && stmt.body.length === 0) {
                result.push('\n');
            }
            result.push(generateComment(comment));
            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push('\n');
            }

            for (i = 1, len = stmt.leadingComments.length; i < len; ++i) {
                comment = stmt.leadingComments[i];
                fragment = [generateComment(comment)];
                if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    fragment.push('\n');
                }
                result.push(addIndent(fragment));
            }

            result.push(addIndent(save));
        }

        if (stmt.trailingComments) {
            tailingToStatement = !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
            specialBase = stringRepeat(' ', calculateSpaces(toSourceNodeWhenNeeded([base, result, indent]).toString()));
            for (i = 0, len = stmt.trailingComments.length; i < len; ++i) {
                comment = stmt.trailingComments[i];
                if (tailingToStatement) {
                    // We assume target like following script
                    //
                    // var t = 20;  /**
                    //               * This is comment of t
                    //               */
                    if (i === 0) {
                        // first case
                        result = [result, indent];
                    } else {
                        result = [result, specialBase];
                    }
                    result.push(generateComment(comment, specialBase));
                } else {
                    result = [result, addIndent(generateComment(comment))];
                }
                if (i !== len - 1 && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result = [result, '\n'];
                }
            }
        }

        return result;
    }

    function parenthesize(text, current, should) {
        if (current < should) {
            return ['(', text, ')'];
        }
        return text;
    }

    function maybeBlock(stmt, semicolonOptional, functionBody) {
        var result, noLeadingComment;

        noLeadingComment = !extra.comment || !stmt.leadingComments;

        if (stmt.type === Syntax.BlockStatement && noLeadingComment) {
            return [space, generateStatement(stmt, { functionBody: functionBody })];
        }

        if (stmt.type === Syntax.EmptyStatement && noLeadingComment) {
            return ';';
        }

        withIndent(function () {
            result = [newline, addIndent(generateStatement(stmt, { semicolonOptional: semicolonOptional, functionBody: functionBody }))];
        });

        return result;
    }

    function maybeBlockSuffix(stmt, result) {
        var ends = endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString());
        if (stmt.type === Syntax.BlockStatement && (!extra.comment || !stmt.leadingComments) && !ends) {
            return [result, space];
        }
        if (ends) {
            return [result, base];
        }
        return [result, newline, base];
    }

    function generateVerbatimString(string) {
        var i, iz, result;
        result = string.split(/\r\n|\n/);
        for (i = 1, iz = result.length; i < iz; i++) {
            result[i] = newline + base + result[i];
        }
        return result;
    }

    function generateVerbatim(expr, option) {
        var verbatim, result, prec;
        verbatim = expr[extra.verbatim];

        if (typeof verbatim === 'string') {
            result = parenthesize(generateVerbatimString(verbatim), Precedence.Sequence, option.precedence);
        } else {
            // verbatim is object
            result = generateVerbatimString(verbatim.content);
            prec = (verbatim.precedence != null) ? verbatim.precedence : Precedence.Sequence;
            result = parenthesize(result, prec, option.precedence);
        }

        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateIdentifier(node) {
        return toSourceNodeWhenNeeded(node.name, node);
    }

    function generatePattern(node, options) {
        var result;

        if (node.type === Syntax.Identifier) {
            result = generateIdentifier(node);
        } else {
            result = generateExpression(node, {
                precedence: options.precedence,
                allowIn: options.allowIn,
                allowCall: true
            });
        }

        return result;
    }

    function generateFunctionBody(node) {
        var result, i, len, expr, arrow;

        arrow = node.type === Syntax.ArrowFunctionExpression;

        if (arrow && node.params.length === 1 && node.params[0].type === Syntax.Identifier) {
            // arg => { } case
            result = [generateIdentifier(node.params[0])];
        } else {
            result = ['('];
            for (i = 0, len = node.params.length; i < len; ++i) {
                result.push(generatePattern(node.params[i], {
                    precedence: Precedence.Assignment,
                    allowIn: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');
        }

        if (arrow) {
            result.push(space);
            result.push('=>');
        }

        if (node.expression) {
            result.push(space);
            expr = generateExpression(node.body, {
                precedence: Precedence.Assignment,
                allowIn: true,
                allowCall: true
            });
            if (expr.toString().charAt(0) === '{') {
                expr = ['(', expr, ')'];
            }
            result.push(expr);
        } else {
            result.push(maybeBlock(node.body, false, true));
        }
        return result;
    }

    function generateIterationForStatement(operator, stmt, semicolonIsNotNeeded) {
        var result = ['for' + space + '('];
        withIndent(function () {
            if (stmt.left.type === Syntax.VariableDeclaration) {
                withIndent(function () {
                    result.push(stmt.left.kind + noEmptySpace());
                    result.push(generateStatement(stmt.left.declarations[0], {
                        allowIn: false
                    }));
                });
            } else {
                result.push(generateExpression(stmt.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                }));
            }

            result = join(result, operator);
            result = [join(
                result,
                generateExpression(stmt.right, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), ')'];
        });
        result.push(maybeBlock(stmt.body, semicolonIsNotNeeded));
        return result;
    }

    function generateLiteral(expr) {
        var raw;
        if (expr.hasOwnProperty('raw') && parse && extra.raw) {
            try {
                raw = parse(expr.raw).body[0].expression;
                if (raw.type === Syntax.Literal) {
                    if (raw.value === expr.value) {
                        return expr.raw;
                    }
                }
            } catch (e) {
                // not use raw property
            }
        }

        if (expr.value === null) {
            return 'null';
        }

        if (typeof expr.value === 'string') {
            return escapeString(expr.value);
        }

        if (typeof expr.value === 'number') {
            return generateNumber(expr.value);
        }

        if (typeof expr.value === 'boolean') {
            return expr.value ? 'true' : 'false';
        }

        return generateRegExp(expr.value);
    }

    function generateExpression(expr, option) {
        var result,
            precedence,
            type,
            currentPrecedence,
            i,
            len,
            fragment,
            multiline,
            leftCharCode,
            leftSource,
            rightCharCode,
            allowIn,
            allowCall,
            allowUnparenthesizedNew,
            property,
            isGenerator;

        precedence = option.precedence;
        allowIn = option.allowIn;
        allowCall = option.allowCall;
        type = expr.type || option.type;

        if (extra.verbatim && expr.hasOwnProperty(extra.verbatim)) {
            return generateVerbatim(expr, option);
        }

        switch (type) {
        case Syntax.SequenceExpression:
            result = [];
            allowIn |= (Precedence.Sequence < precedence);
            for (i = 0, len = expr.expressions.length; i < len; ++i) {
                result.push(generateExpression(expr.expressions[i], {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result = parenthesize(result, Precedence.Sequence, precedence);
            break;

        case Syntax.AssignmentExpression:
            allowIn |= (Precedence.Assignment < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.left, {
                        precedence: Precedence.Call,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + expr.operator + space,
                    generateExpression(expr.right, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Assignment,
                precedence
            );
            break;

        case Syntax.ArrowFunctionExpression:
            allowIn |= (Precedence.ArrowFunction < precedence);
            result = parenthesize(generateFunctionBody(expr), Precedence.ArrowFunction, precedence);
            break;

        case Syntax.ConditionalExpression:
            allowIn |= (Precedence.Conditional < precedence);
            result = parenthesize(
                [
                    generateExpression(expr.test, {
                        precedence: Precedence.LogicalOR,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + '?' + space,
                    generateExpression(expr.consequent, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space + ':' + space,
                    generateExpression(expr.alternate, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ],
                Precedence.Conditional,
                precedence
            );
            break;

        case Syntax.LogicalExpression:
        case Syntax.BinaryExpression:
            currentPrecedence = BinaryPrecedence[expr.operator];

            allowIn |= (currentPrecedence < precedence);

            fragment = generateExpression(expr.left, {
                precedence: currentPrecedence,
                allowIn: allowIn,
                allowCall: true
            });

            leftSource = fragment.toString();

            if (leftSource.charCodeAt(leftSource.length - 1) === 0x2F /* / */ && esutils.code.isIdentifierPart(expr.operator.charCodeAt(0))) {
                result = [fragment, noEmptySpace(), expr.operator];
            } else {
                result = join(fragment, expr.operator);
            }

            fragment = generateExpression(expr.right, {
                precedence: currentPrecedence + 1,
                allowIn: allowIn,
                allowCall: true
            });

            if (expr.operator === '/' && fragment.toString().charAt(0) === '/' ||
            expr.operator.slice(-1) === '<' && fragment.toString().slice(0, 3) === '!--') {
                // If '/' concats with '/' or `<` concats with `!--`, it is interpreted as comment start
                result.push(noEmptySpace());
                result.push(fragment);
            } else {
                result = join(result, fragment);
            }

            if (expr.operator === 'in' && !allowIn) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, currentPrecedence, precedence);
            }

            break;

        case Syntax.CallExpression:
            result = [generateExpression(expr.callee, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: true,
                allowUnparenthesizedNew: false
            })];

            result.push('(');
            for (i = 0, len = expr['arguments'].length; i < len; ++i) {
                result.push(generateExpression(expr['arguments'][i], {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                }));
                if (i + 1 < len) {
                    result.push(',' + space);
                }
            }
            result.push(')');

            if (!allowCall) {
                result = ['(', result, ')'];
            } else {
                result = parenthesize(result, Precedence.Call, precedence);
            }
            break;

        case Syntax.NewExpression:
            len = expr['arguments'].length;
            allowUnparenthesizedNew = option.allowUnparenthesizedNew === undefined || option.allowUnparenthesizedNew;

            result = join(
                'new',
                generateExpression(expr.callee, {
                    precedence: Precedence.New,
                    allowIn: true,
                    allowCall: false,
                    allowUnparenthesizedNew: allowUnparenthesizedNew && !parentheses && len === 0
                })
            );

            if (!allowUnparenthesizedNew || parentheses || len > 0) {
                result.push('(');
                for (i = 0; i < len; ++i) {
                    result.push(generateExpression(expr['arguments'][i], {
                        precedence: Precedence.Assignment,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + space);
                    }
                }
                result.push(')');
            }

            result = parenthesize(result, Precedence.New, precedence);
            break;

        case Syntax.MemberExpression:
            result = [generateExpression(expr.object, {
                precedence: Precedence.Call,
                allowIn: true,
                allowCall: allowCall,
                allowUnparenthesizedNew: false
            })];

            if (expr.computed) {
                result.push('[');
                result.push(generateExpression(expr.property, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: allowCall
                }));
                result.push(']');
            } else {
                if (expr.object.type === Syntax.Literal && typeof expr.object.value === 'number') {
                    fragment = toSourceNodeWhenNeeded(result).toString();
                    // When the following conditions are all true,
                    //   1. No floating point
                    //   2. Don't have exponents
                    //   3. The last character is a decimal digit
                    //   4. Not hexadecimal OR octal number literal
                    // we should add a floating point.
                    if (
                            fragment.indexOf('.') < 0 &&
                            !/[eExX]/.test(fragment) &&
                            esutils.code.isDecimalDigit(fragment.charCodeAt(fragment.length - 1)) &&
                            !(fragment.length >= 2 && fragment.charCodeAt(0) === 48)  // '0'
                            ) {
                        result.push('.');
                    }
                }
                result.push('.');
                result.push(generateIdentifier(expr.property));
            }

            result = parenthesize(result, Precedence.Member, precedence);
            break;

        case Syntax.UnaryExpression:
            fragment = generateExpression(expr.argument, {
                precedence: Precedence.Unary,
                allowIn: true,
                allowCall: true
            });

            if (space === '') {
                result = join(expr.operator, fragment);
            } else {
                result = [expr.operator];
                if (expr.operator.length > 2) {
                    // delete, void, typeof
                    // get `typeof []`, not `typeof[]`
                    result = join(result, fragment);
                } else {
                    // Prevent inserting spaces between operator and argument if it is unnecessary
                    // like, `!cond`
                    leftSource = toSourceNodeWhenNeeded(result).toString();
                    leftCharCode = leftSource.charCodeAt(leftSource.length - 1);
                    rightCharCode = fragment.toString().charCodeAt(0);

                    if (((leftCharCode === 0x2B  /* + */ || leftCharCode === 0x2D  /* - */) && leftCharCode === rightCharCode) ||
                            (esutils.code.isIdentifierPart(leftCharCode) && esutils.code.isIdentifierPart(rightCharCode))) {
                        result.push(noEmptySpace());
                        result.push(fragment);
                    } else {
                        result.push(fragment);
                    }
                }
            }
            result = parenthesize(result, Precedence.Unary, precedence);
            break;

        case Syntax.YieldExpression:
            if (expr.delegate) {
                result = 'yield*';
            } else {
                result = 'yield';
            }
            if (expr.argument) {
                result = join(
                    result,
                    generateExpression(expr.argument, {
                        precedence: Precedence.Yield,
                        allowIn: true,
                        allowCall: true
                    })
                );
            }
            result = parenthesize(result, Precedence.Yield, precedence);
            break;

        case Syntax.UpdateExpression:
            if (expr.prefix) {
                result = parenthesize(
                    [
                        expr.operator,
                        generateExpression(expr.argument, {
                            precedence: Precedence.Unary,
                            allowIn: true,
                            allowCall: true
                        })
                    ],
                    Precedence.Unary,
                    precedence
                );
            } else {
                result = parenthesize(
                    [
                        generateExpression(expr.argument, {
                            precedence: Precedence.Postfix,
                            allowIn: true,
                            allowCall: true
                        }),
                        expr.operator
                    ],
                    Precedence.Postfix,
                    precedence
                );
            }
            break;

        case Syntax.FunctionExpression:
            isGenerator = expr.generator && !extra.moz.starlessGenerator;
            result = isGenerator ? 'function*' : 'function';

            if (expr.id) {
                result = [result, (isGenerator) ? space : noEmptySpace(),
                          generateIdentifier(expr.id),
                          generateFunctionBody(expr)];
            } else {
                result = [result + space, generateFunctionBody(expr)];
            }

            break;

        case Syntax.ArrayPattern:
        case Syntax.ArrayExpression:
            if (!expr.elements.length) {
                result = '[]';
                break;
            }
            multiline = expr.elements.length > 1;
            result = ['[', multiline ? newline : ''];
            withIndent(function (indent) {
                for (i = 0, len = expr.elements.length; i < len; ++i) {
                    if (!expr.elements[i]) {
                        if (multiline) {
                            result.push(indent);
                        }
                        if (i + 1 === len) {
                            result.push(',');
                        }
                    } else {
                        result.push(multiline ? indent : '');
                        result.push(generateExpression(expr.elements[i], {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        }));
                    }
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });
            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push(']');
            break;

        case Syntax.Property:
            if (expr.kind === 'get' || expr.kind === 'set') {
                result = [
                    expr.kind, noEmptySpace(),
                    generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    generateFunctionBody(expr.value)
                ];
            } else {
                if (expr.shorthand) {
                    result = generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });
                } else if (expr.method) {
                    result = [];
                    if (expr.value.generator) {
                        result.push('*');
                    }
                    result.push(generateExpression(expr.key, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(generateFunctionBody(expr.value));
                } else {
                    result = [
                        generateExpression(expr.key, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        }),
                        ':' + space,
                        generateExpression(expr.value, {
                            precedence: Precedence.Assignment,
                            allowIn: true,
                            allowCall: true
                        })
                    ];
                }
            }
            break;

        case Syntax.ObjectExpression:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }
            multiline = expr.properties.length > 1;

            withIndent(function () {
                fragment = generateExpression(expr.properties[0], {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true,
                    type: Syntax.Property
                });
            });

            if (!multiline) {
                // issues 4
                // Do not transform from
                //   dejavu.Class.declare({
                //       method2: function () {}
                //   });
                // to
                //   dejavu.Class.declare({method2: function () {
                //       }});
                if (!hasLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result = [ '{', space, fragment, space, '}' ];
                    break;
                }
            }

            withIndent(function (indent) {
                result = [ '{', newline, indent, fragment ];

                if (multiline) {
                    result.push(',' + newline);
                    for (i = 1, len = expr.properties.length; i < len; ++i) {
                        result.push(indent);
                        result.push(generateExpression(expr.properties[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true,
                            type: Syntax.Property
                        }));
                        if (i + 1 < len) {
                            result.push(',' + newline);
                        }
                    }
                }
            });

            if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(base);
            result.push('}');
            break;

        case Syntax.ObjectPattern:
            if (!expr.properties.length) {
                result = '{}';
                break;
            }

            multiline = false;
            if (expr.properties.length === 1) {
                property = expr.properties[0];
                if (property.value.type !== Syntax.Identifier) {
                    multiline = true;
                }
            } else {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    property = expr.properties[i];
                    if (!property.shorthand) {
                        multiline = true;
                        break;
                    }
                }
            }
            result = ['{', multiline ? newline : '' ];

            withIndent(function (indent) {
                for (i = 0, len = expr.properties.length; i < len; ++i) {
                    result.push(multiline ? indent : '');
                    result.push(generateExpression(expr.properties[i], {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    if (i + 1 < len) {
                        result.push(',' + (multiline ? newline : space));
                    }
                }
            });

            if (multiline && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                result.push(newline);
            }
            result.push(multiline ? base : '');
            result.push('}');
            break;

        case Syntax.ThisExpression:
            result = 'this';
            break;

        case Syntax.Identifier:
            result = generateIdentifier(expr);
            break;

        case Syntax.Literal:
            result = generateLiteral(expr);
            break;

        case Syntax.GeneratorExpression:
        case Syntax.ComprehensionExpression:
            // GeneratorExpression should be parenthesized with (...), ComprehensionExpression with [...]
            // Due to https://bugzilla.mozilla.org/show_bug.cgi?id=883468 position of expr.body can differ in Spidermonkey and ES6
            result = (type === Syntax.GeneratorExpression) ? ['('] : ['['];

            if (extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result.push(fragment);
            }

            if (expr.blocks) {
                withIndent(function () {
                    for (i = 0, len = expr.blocks.length; i < len; ++i) {
                        fragment = generateExpression(expr.blocks[i], {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        });

                        if (i > 0 || extra.moz.comprehensionExpressionStartsWithAssignment) {
                            result = join(result, fragment);
                        } else {
                            result.push(fragment);
                        }
                    }
                });
            }

            if (expr.filter) {
                result = join(result, 'if' + space);
                fragment = generateExpression(expr.filter, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                });
                if (extra.moz.parenthesizedComprehensionBlock) {
                    result = join(result, [ '(', fragment, ')' ]);
                } else {
                    result = join(result, fragment);
                }
            }

            if (!extra.moz.comprehensionExpressionStartsWithAssignment) {
                fragment = generateExpression(expr.body, {
                    precedence: Precedence.Assignment,
                    allowIn: true,
                    allowCall: true
                });

                result = join(result, fragment);
            }

            result.push((type === Syntax.GeneratorExpression) ? ')' : ']');
            break;

        case Syntax.ComprehensionBlock:
            if (expr.left.type === Syntax.VariableDeclaration) {
                fragment = [
                    expr.left.kind, noEmptySpace(),
                    generateStatement(expr.left.declarations[0], {
                        allowIn: false
                    })
                ];
            } else {
                fragment = generateExpression(expr.left, {
                    precedence: Precedence.Call,
                    allowIn: true,
                    allowCall: true
                });
            }

            fragment = join(fragment, expr.of ? 'of' : 'in');
            fragment = join(fragment, generateExpression(expr.right, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            }));

            if (extra.moz.parenthesizedComprehensionBlock) {
                result = [ 'for' + space + '(', fragment, ')' ];
            } else {
                result = join('for' + space, fragment);
            }
            break;

        default:
            throw new Error('Unknown expression type: ' + expr.type);
        }

        if (extra.comment) {
            result = addComments(expr,result);
        }
        return toSourceNodeWhenNeeded(result, expr);
    }

    function generateStatement(stmt, option) {
        var i,
            len,
            result,
            node,
            specifier,
            allowIn,
            functionBody,
            directiveContext,
            fragment,
            semicolon,
            isGenerator;

        allowIn = true;
        semicolon = ';';
        functionBody = false;
        directiveContext = false;
        if (option) {
            allowIn = option.allowIn === undefined || option.allowIn;
            if (!semicolons && option.semicolonOptional === true) {
                semicolon = '';
            }
            functionBody = option.functionBody;
            directiveContext = option.directiveContext;
        }

        switch (stmt.type) {
        case Syntax.BlockStatement:
            result = ['{', newline];

            withIndent(function () {
                for (i = 0, len = stmt.body.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.body[i], {
                        semicolonOptional: i === len - 1,
                        directiveContext: functionBody
                    }));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });

            result.push(addIndent('}'));
            break;

        case Syntax.BreakStatement:
            if (stmt.label) {
                result = 'break ' + stmt.label.name + semicolon;
            } else {
                result = 'break' + semicolon;
            }
            break;

        case Syntax.ContinueStatement:
            if (stmt.label) {
                result = 'continue ' + stmt.label.name + semicolon;
            } else {
                result = 'continue' + semicolon;
            }
            break;

        case Syntax.DirectiveStatement:
            if (extra.raw && stmt.raw) {
                result = stmt.raw + semicolon;
            } else {
                result = escapeDirective(stmt.directive) + semicolon;
            }
            break;

        case Syntax.DoWhileStatement:
            // Because `do 42 while (cond)` is Syntax Error. We need semicolon.
            result = join('do', maybeBlock(stmt.body));
            result = maybeBlockSuffix(stmt.body, result);
            result = join(result, [
                'while' + space + '(',
                generateExpression(stmt.test, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                }),
                ')' + semicolon
            ]);
            break;

        case Syntax.CatchClause:
            withIndent(function () {
                var guard;

                result = [
                    'catch' + space + '(',
                    generateExpression(stmt.param, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];

                if (stmt.guard) {
                    guard = generateExpression(stmt.guard, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    });

                    result.splice(2, 0, ' if ', guard);
                }
            });
            result.push(maybeBlock(stmt.body));
            break;

        case Syntax.DebuggerStatement:
            result = 'debugger' + semicolon;
            break;

        case Syntax.EmptyStatement:
            result = ';';
            break;

        case Syntax.ExportDeclaration:
            result = 'export ';
            if (stmt.declaration) {
                // FunctionDeclaration or VariableDeclaration
                result = [result, generateStatement(stmt.declaration, { semicolonOptional: semicolon === '' })];
                break;
            }
            break;

        case Syntax.ExpressionStatement:
            result = [generateExpression(stmt.expression, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            })];
            // 12.4 '{', 'function' is not allowed in this position.
            // wrap expression with parentheses
            fragment = toSourceNodeWhenNeeded(result).toString();
            if (fragment.charAt(0) === '{' ||  // ObjectExpression
                    (fragment.slice(0, 8) === 'function' && '* ('.indexOf(fragment.charAt(8)) >= 0) ||  // function or generator
                    (directive && directiveContext && stmt.expression.type === Syntax.Literal && typeof stmt.expression.value === 'string')) {
                result = ['(', result, ')' + semicolon];
            } else {
                result.push(semicolon);
            }
            break;

        case Syntax.ImportDeclaration:
            // ES6: 15.2.1 valid import declarations:
            //     - import ImportClause FromClause ;
            //     - import ModuleSpecifier ;
            // If no ImportClause is present,
            // this should be `import ModuleSpecifier` so skip `from`
            //
            // ModuleSpecifier is StringLiteral.
            if (stmt.specifiers.length === 0) {
                // import ModuleSpecifier ;
                result = [
                    'import',
                    space,
                    generateLiteral(stmt.source)
                ];
            } else {
                // import ImportClause FromClause ;
                if (stmt.kind === 'default') {
                    // import ... from "...";
                    result = [
                        'import',
                        noEmptySpace(),
                        stmt.specifiers[0].id.name,
                        noEmptySpace()
                    ];
                } else {
                    // stmt.kind === 'named'
                    result = [
                        'import',
                        space,
                        '{',
                    ];

                    if (stmt.specifiers.length === 1) {
                        // import { ... } from "...";
                        specifier = stmt.specifiers[0];
                        result.push(space + specifier.id.name);
                        if (specifier.name) {
                            result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                        }
                        result.push(space + '}' + space);
                    } else {
                        // import {
                        //    ...,
                        //    ...,
                        // } from "...";
                        withIndent(function (indent) {
                            var i, iz;
                            result.push(newline);
                            for (i = 0, iz = stmt.specifiers.length; i < iz; ++i) {
                                specifier = stmt.specifiers[i];
                                result.push(indent + specifier.id.name);
                                if (specifier.name) {
                                    result.push(noEmptySpace() + 'as' + noEmptySpace() + specifier.name.name);
                                }

                                if (i + 1 < iz) {
                                    result.push(',' + newline);
                                }
                            }
                        });
                        if (!endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                            result.push(newline);
                        }
                        result.push(base + '}' + space);
                    }
                }

                result.push('from' + space);
                result.push(generateLiteral(stmt.source));
            }
            result.push(semicolon);
            break;

        case Syntax.VariableDeclarator:
            if (stmt.init) {
                result = [
                    generateExpression(stmt.id, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    }),
                    space,
                    '=',
                    space,
                    generateExpression(stmt.init, {
                        precedence: Precedence.Assignment,
                        allowIn: allowIn,
                        allowCall: true
                    })
                ];
            } else {
                result = generatePattern(stmt.id, {
                    precedence: Precedence.Assignment,
                    allowIn: allowIn
                });
            }
            break;

        case Syntax.VariableDeclaration:
            result = [stmt.kind];
            // special path for
            // var x = function () {
            // };
            if (stmt.declarations.length === 1 && stmt.declarations[0].init &&
                    stmt.declarations[0].init.type === Syntax.FunctionExpression) {
                result.push(noEmptySpace());
                result.push(generateStatement(stmt.declarations[0], {
                    allowIn: allowIn
                }));
            } else {
                // VariableDeclarator is typed as Statement,
                // but joined with comma (not LineTerminator).
                // So if comment is attached to target node, we should specialize.
                withIndent(function () {
                    node = stmt.declarations[0];
                    if (extra.comment && node.leadingComments) {
                        result.push('\n');
                        result.push(addIndent(generateStatement(node, {
                            allowIn: allowIn
                        })));
                    } else {
                        result.push(noEmptySpace());
                        result.push(generateStatement(node, {
                            allowIn: allowIn
                        }));
                    }

                    for (i = 1, len = stmt.declarations.length; i < len; ++i) {
                        node = stmt.declarations[i];
                        if (extra.comment && node.leadingComments) {
                            result.push(',' + newline);
                            result.push(addIndent(generateStatement(node, {
                                allowIn: allowIn
                            })));
                        } else {
                            result.push(',' + space);
                            result.push(generateStatement(node, {
                                allowIn: allowIn
                            }));
                        }
                    }
                });
            }
            result.push(semicolon);
            break;

        case Syntax.ThrowStatement:
            result = [join(
                'throw',
                generateExpression(stmt.argument, {
                    precedence: Precedence.Sequence,
                    allowIn: true,
                    allowCall: true
                })
            ), semicolon];
            break;

        case Syntax.TryStatement:
            result = ['try', maybeBlock(stmt.block)];
            result = maybeBlockSuffix(stmt.block, result);

            if (stmt.handlers) {
                // old interface
                for (i = 0, len = stmt.handlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.handlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.handlers[i].body, result);
                    }
                }
            } else {
                stmt.guardedHandlers = stmt.guardedHandlers || [];

                for (i = 0, len = stmt.guardedHandlers.length; i < len; ++i) {
                    result = join(result, generateStatement(stmt.guardedHandlers[i]));
                    if (stmt.finalizer || i + 1 !== len) {
                        result = maybeBlockSuffix(stmt.guardedHandlers[i].body, result);
                    }
                }

                // new interface
                if (stmt.handler) {
                    if (isArray(stmt.handler)) {
                        for (i = 0, len = stmt.handler.length; i < len; ++i) {
                            result = join(result, generateStatement(stmt.handler[i]));
                            if (stmt.finalizer || i + 1 !== len) {
                                result = maybeBlockSuffix(stmt.handler[i].body, result);
                            }
                        }
                    } else {
                        result = join(result, generateStatement(stmt.handler));
                        if (stmt.finalizer) {
                            result = maybeBlockSuffix(stmt.handler.body, result);
                        }
                    }
                }
            }
            if (stmt.finalizer) {
                result = join(result, ['finally', maybeBlock(stmt.finalizer)]);
            }
            break;

        case Syntax.SwitchStatement:
            withIndent(function () {
                result = [
                    'switch' + space + '(',
                    generateExpression(stmt.discriminant, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')' + space + '{' + newline
                ];
            });
            if (stmt.cases) {
                for (i = 0, len = stmt.cases.length; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.cases[i], {semicolonOptional: i === len - 1}));
                    result.push(fragment);
                    if (!endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            }
            result.push(addIndent('}'));
            break;

        case Syntax.SwitchCase:
            withIndent(function () {
                if (stmt.test) {
                    result = [
                        join('case', generateExpression(stmt.test, {
                            precedence: Precedence.Sequence,
                            allowIn: true,
                            allowCall: true
                        })),
                        ':'
                    ];
                } else {
                    result = ['default:'];
                }

                i = 0;
                len = stmt.consequent.length;
                if (len && stmt.consequent[0].type === Syntax.BlockStatement) {
                    fragment = maybeBlock(stmt.consequent[0]);
                    result.push(fragment);
                    i = 1;
                }

                if (i !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(result).toString())) {
                    result.push(newline);
                }

                for (; i < len; ++i) {
                    fragment = addIndent(generateStatement(stmt.consequent[i], {semicolonOptional: i === len - 1 && semicolon === ''}));
                    result.push(fragment);
                    if (i + 1 !== len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                        result.push(newline);
                    }
                }
            });
            break;

        case Syntax.IfStatement:
            withIndent(function () {
                result = [
                    'if' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            if (stmt.alternate) {
                result.push(maybeBlock(stmt.consequent));
                result = maybeBlockSuffix(stmt.consequent, result);
                if (stmt.alternate.type === Syntax.IfStatement) {
                    result = join(result, ['else ', generateStatement(stmt.alternate, {semicolonOptional: semicolon === ''})]);
                } else {
                    result = join(result, join('else', maybeBlock(stmt.alternate, semicolon === '')));
                }
            } else {
                result.push(maybeBlock(stmt.consequent, semicolon === ''));
            }
            break;

        case Syntax.ForStatement:
            withIndent(function () {
                result = ['for' + space + '('];
                if (stmt.init) {
                    if (stmt.init.type === Syntax.VariableDeclaration) {
                        result.push(generateStatement(stmt.init, {allowIn: false}));
                    } else {
                        result.push(generateExpression(stmt.init, {
                            precedence: Precedence.Sequence,
                            allowIn: false,
                            allowCall: true
                        }));
                        result.push(';');
                    }
                } else {
                    result.push(';');
                }

                if (stmt.test) {
                    result.push(space);
                    result.push(generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(';');
                } else {
                    result.push(';');
                }

                if (stmt.update) {
                    result.push(space);
                    result.push(generateExpression(stmt.update, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }));
                    result.push(')');
                } else {
                    result.push(')');
                }
            });

            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.ForInStatement:
            result = generateIterationForStatement('in', stmt, semicolon === '');
            break;

        case Syntax.ForOfStatement:
            result = generateIterationForStatement('of', stmt, semicolon === '');
            break;

        case Syntax.LabeledStatement:
            result = [stmt.label.name + ':', maybeBlock(stmt.body, semicolon === '')];
            break;

        case Syntax.Program:
            len = stmt.body.length;
            result = [safeConcatenation && len > 0 ? '\n' : ''];
            for (i = 0; i < len; ++i) {
                fragment = addIndent(
                    generateStatement(stmt.body[i], {
                        semicolonOptional: !safeConcatenation && i === len - 1,
                        directiveContext: true
                    })
                );
                result.push(fragment);
                if (i + 1 < len && !endsWithLineTerminator(toSourceNodeWhenNeeded(fragment).toString())) {
                    result.push(newline);
                }
            }
            break;

        case Syntax.FunctionDeclaration:
            isGenerator = stmt.generator && !extra.moz.starlessGenerator;
            result = [
                (isGenerator ? 'function*' : 'function'),
                (isGenerator ? space : noEmptySpace()),
                generateIdentifier(stmt.id),
                generateFunctionBody(stmt)
            ];
            break;

        case Syntax.ReturnStatement:
            if (stmt.argument) {
                result = [join(
                    'return',
                    generateExpression(stmt.argument, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    })
                ), semicolon];
            } else {
                result = ['return' + semicolon];
            }
            break;

        case Syntax.WhileStatement:
            withIndent(function () {
                result = [
                    'while' + space + '(',
                    generateExpression(stmt.test, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        case Syntax.WithStatement:
            withIndent(function () {
                result = [
                    'with' + space + '(',
                    generateExpression(stmt.object, {
                        precedence: Precedence.Sequence,
                        allowIn: true,
                        allowCall: true
                    }),
                    ')'
                ];
            });
            result.push(maybeBlock(stmt.body, semicolon === ''));
            break;

        default:
            throw new Error('Unknown statement type: ' + stmt.type);
        }

        // Attach comments

        if (extra.comment) {
            result = addComments(stmt, result);
        }

        fragment = toSourceNodeWhenNeeded(result).toString();
        if (stmt.type === Syntax.Program && !safeConcatenation && newline === '' &&  fragment.charAt(fragment.length - 1) === '\n') {
            result = sourceMap ? toSourceNodeWhenNeeded(result).replaceRight(/\s+$/, '') : fragment.replace(/\s+$/, '');
        }

        return toSourceNodeWhenNeeded(result, stmt);
    }

    function generate(node, options) {
        var defaultOptions = getDefaultOptions(), result, pair;

        if (options != null) {
            // Obsolete options
            //
            //   `options.indent`
            //   `options.base`
            //
            // Instead of them, we can use `option.format.indent`.
            if (typeof options.indent === 'string') {
                defaultOptions.format.indent.style = options.indent;
            }
            if (typeof options.base === 'number') {
                defaultOptions.format.indent.base = options.base;
            }
            options = updateDeeply(defaultOptions, options);
            indent = options.format.indent.style;
            if (typeof options.base === 'string') {
                base = options.base;
            } else {
                base = stringRepeat(indent, options.format.indent.base);
            }
        } else {
            options = defaultOptions;
            indent = options.format.indent.style;
            base = stringRepeat(indent, options.format.indent.base);
        }
        json = options.format.json;
        renumber = options.format.renumber;
        hexadecimal = json ? false : options.format.hexadecimal;
        quotes = json ? 'double' : options.format.quotes;
        escapeless = options.format.escapeless;
        newline = options.format.newline;
        space = options.format.space;
        if (options.format.compact) {
            newline = space = indent = base = '';
        }
        parentheses = options.format.parentheses;
        semicolons = options.format.semicolons;
        safeConcatenation = options.format.safeConcatenation;
        directive = options.directive;
        parse = json ? null : options.parse;
        sourceMap = options.sourceMap;
        extra = options;

        if (sourceMap) {
            if (!exports.browser) {
                // We assume environment is node.js
                // And prevent from including source-map by browserify
                SourceNode = require('source-map').SourceNode;
            } else {
                SourceNode = global.sourceMap.SourceNode;
            }
        }

        switch (node.type) {
        case Syntax.BlockStatement:
        case Syntax.BreakStatement:
        case Syntax.CatchClause:
        case Syntax.ContinueStatement:
        case Syntax.DirectiveStatement:
        case Syntax.DoWhileStatement:
        case Syntax.DebuggerStatement:
        case Syntax.EmptyStatement:
        case Syntax.ExpressionStatement:
        case Syntax.ForStatement:
        case Syntax.ForInStatement:
        case Syntax.ForOfStatement:
        case Syntax.FunctionDeclaration:
        case Syntax.IfStatement:
        case Syntax.LabeledStatement:
        case Syntax.Program:
        case Syntax.ReturnStatement:
        case Syntax.SwitchStatement:
        case Syntax.SwitchCase:
        case Syntax.ThrowStatement:
        case Syntax.TryStatement:
        case Syntax.VariableDeclaration:
        case Syntax.VariableDeclarator:
        case Syntax.WhileStatement:
        case Syntax.WithStatement:
            result = generateStatement(node);
            break;

        case Syntax.AssignmentExpression:
        case Syntax.ArrayExpression:
        case Syntax.ArrayPattern:
        case Syntax.BinaryExpression:
        case Syntax.CallExpression:
        case Syntax.ConditionalExpression:
        case Syntax.FunctionExpression:
        case Syntax.Identifier:
        case Syntax.Literal:
        case Syntax.LogicalExpression:
        case Syntax.MemberExpression:
        case Syntax.NewExpression:
        case Syntax.ObjectExpression:
        case Syntax.ObjectPattern:
        case Syntax.Property:
        case Syntax.SequenceExpression:
        case Syntax.ThisExpression:
        case Syntax.UnaryExpression:
        case Syntax.UpdateExpression:
        case Syntax.YieldExpression:

            result = generateExpression(node, {
                precedence: Precedence.Sequence,
                allowIn: true,
                allowCall: true
            });
            break;

        default:
            throw new Error('Unknown node type: ' + node.type);
        }

        if (!sourceMap) {
            pair = {code: result.toString(), map: null};
            return options.sourceMapWithCode ? pair : pair.code;
        }


        pair = result.toStringWithSourceMap({
            file: options.file,
            sourceRoot: options.sourceMapRoot
        });

        if (options.sourceContent) {
            pair.map.setSourceContent(options.sourceMap,
                                      options.sourceContent);
        }

        if (options.sourceMapWithCode) {
            return pair;
        }

        return pair.map.toString();
    }

    FORMAT_MINIFY = {
        indent: {
            style: '',
            base: 0
        },
        renumber: true,
        hexadecimal: true,
        quotes: 'auto',
        escapeless: true,
        compact: true,
        parentheses: false,
        semicolons: false
    };

    FORMAT_DEFAULTS = getDefaultOptions().format;

    exports.version = require('./package.json').version;
    exports.generate = generate;
    exports.attachComments = estraverse.attachComments;
    exports.Precedence = updateDeeply({}, Precedence);
    exports.browser = false;
    exports.FORMAT_MINIFY = FORMAT_MINIFY;
    exports.FORMAT_DEFAULTS = FORMAT_DEFAULTS;
}());
/* vim: set sw=4 ts=4 et tw=80 : */

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./package.json":14,"estraverse":16,"esutils":19,"source-map":34}],14:[function(require,module,exports){
module.exports={
  "_args": [
    [
      {
        "raw": "escodegen@1.3.x",
        "scope": null,
        "escapedName": "escodegen",
        "name": "escodegen",
        "rawSpec": "1.3.x",
        "spec": ">=1.3.0 <1.4.0",
        "type": "range"
      },
      "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm/node_modules/jison"
    ]
  ],
  "_from": "escodegen@>=1.3.0 <1.4.0",
  "_id": "escodegen@1.3.3",
  "_inCache": true,
  "_location": "/escodegen",
  "_npmUser": {
    "name": "constellation",
    "email": "utatane.tea@gmail.com"
  },
  "_npmVersion": "1.4.3",
  "_phantomChildren": {},
  "_requested": {
    "raw": "escodegen@1.3.x",
    "scope": null,
    "escapedName": "escodegen",
    "name": "escodegen",
    "rawSpec": "1.3.x",
    "spec": ">=1.3.0 <1.4.0",
    "type": "range"
  },
  "_requiredBy": [
    "/jison"
  ],
  "_resolved": "https://registry.npmjs.org/escodegen/-/escodegen-1.3.3.tgz",
  "_shasum": "f024016f5a88e046fd12005055e939802e6c5f23",
  "_shrinkwrap": null,
  "_spec": "escodegen@1.3.x",
  "_where": "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm/node_modules/jison",
  "bin": {
    "esgenerate": "./bin/esgenerate.js",
    "escodegen": "./bin/escodegen.js"
  },
  "bugs": {
    "url": "https://github.com/Constellation/escodegen/issues"
  },
  "dependencies": {
    "esprima": "~1.1.1",
    "estraverse": "~1.5.0",
    "esutils": "~1.0.0",
    "source-map": "~0.1.33"
  },
  "description": "ECMAScript code generator",
  "devDependencies": {
    "bluebird": "~1.2.0",
    "bower-registry-client": "~0.2.0",
    "chai": "~1.7.2",
    "commonjs-everywhere": "~0.9.6",
    "esprima-moz": "*",
    "gulp": "~3.5.0",
    "gulp-eslint": "~0.1.2",
    "gulp-jshint": "~1.4.0",
    "gulp-mocha": "~0.4.1",
    "jshint-stylish": "~0.1.5",
    "semver": "*"
  },
  "directories": {},
  "dist": {
    "shasum": "f024016f5a88e046fd12005055e939802e6c5f23",
    "tarball": "https://registry.npmjs.org/escodegen/-/escodegen-1.3.3.tgz"
  },
  "engines": {
    "node": ">=0.10.0"
  },
  "homepage": "http://github.com/Constellation/escodegen",
  "licenses": [
    {
      "type": "BSD",
      "url": "http://github.com/Constellation/escodegen/raw/master/LICENSE.BSD"
    }
  ],
  "main": "escodegen.js",
  "maintainers": [
    {
      "name": "constellation",
      "email": "utatane.tea@gmail.com"
    }
  ],
  "name": "escodegen",
  "optionalDependencies": {
    "source-map": "~0.1.33"
  },
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/Constellation/escodegen.git"
  },
  "scripts": {
    "build": "cjsify -a path: tools/entry-point.js > escodegen.browser.js",
    "build-min": "cjsify -ma path: tools/entry-point.js > escodegen.browser.min.js",
    "lint": "gulp lint",
    "release": "node tools/release.js",
    "test": "gulp travis",
    "unit-test": "gulp test"
  },
  "version": "1.3.3"
}

},{}],15:[function(require,module,exports){
/*
  Copyright (C) 2013 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2013 Thaddee Tyl <thaddee.tyl@gmail.com>
  Copyright (C) 2013 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>
  Copyright (C) 2012 Mathias Bynens <mathias@qiwi.be>
  Copyright (C) 2012 Joost-Wim Boekesteijn <joost-wim@boekesteijn.nl>
  Copyright (C) 2012 Kris Kowal <kris.kowal@cixar.com>
  Copyright (C) 2012 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Arpad Borsos <arpad.borsos@googlemail.com>
  Copyright (C) 2011 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/*jslint bitwise:true plusplus:true */
/*global esprima:true, define:true, exports:true, window: true,
createLocationMarker: true,
throwError: true, generateStatement: true, peek: true,
parseAssignmentExpression: true, parseBlock: true, parseExpression: true,
parseFunctionDeclaration: true, parseFunctionExpression: true,
parseFunctionSourceElements: true, parseVariableIdentifier: true,
parseLeftHandSideExpression: true,
parseUnaryExpression: true,
parseStatement: true, parseSourceElement: true */

(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // Rhino, and plain browser loading.
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.esprima = {}));
    }
}(this, function (exports) {
    'use strict';

    var Token,
        TokenName,
        FnExprTokens,
        Syntax,
        PropertyKind,
        Messages,
        Regex,
        SyntaxTreeDelegate,
        source,
        strict,
        index,
        lineNumber,
        lineStart,
        length,
        delegate,
        lookahead,
        state,
        extra;

    Token = {
        BooleanLiteral: 1,
        EOF: 2,
        Identifier: 3,
        Keyword: 4,
        NullLiteral: 5,
        NumericLiteral: 6,
        Punctuator: 7,
        StringLiteral: 8,
        RegularExpression: 9
    };

    TokenName = {};
    TokenName[Token.BooleanLiteral] = 'Boolean';
    TokenName[Token.EOF] = '<end>';
    TokenName[Token.Identifier] = 'Identifier';
    TokenName[Token.Keyword] = 'Keyword';
    TokenName[Token.NullLiteral] = 'Null';
    TokenName[Token.NumericLiteral] = 'Numeric';
    TokenName[Token.Punctuator] = 'Punctuator';
    TokenName[Token.StringLiteral] = 'String';
    TokenName[Token.RegularExpression] = 'RegularExpression';

    // A function following one of those tokens is an expression.
    FnExprTokens = ['(', '{', '[', 'in', 'typeof', 'instanceof', 'new',
                    'return', 'case', 'delete', 'throw', 'void',
                    // assignment operators
                    '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '>>>=',
                    '&=', '|=', '^=', ',',
                    // binary/unary operators
                    '+', '-', '*', '/', '%', '++', '--', '<<', '>>', '>>>', '&',
                    '|', '^', '!', '~', '&&', '||', '?', ':', '===', '==', '>=',
                    '<=', '<', '>', '!=', '!=='];

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DoWhileStatement: 'DoWhileStatement',
        DebuggerStatement: 'DebuggerStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement'
    };

    PropertyKind = {
        Data: 1,
        Get: 2,
        Set: 4
    };

    // Error messages should be identical to V8.
    Messages = {
        UnexpectedToken:  'Unexpected token %0',
        UnexpectedNumber:  'Unexpected number',
        UnexpectedString:  'Unexpected string',
        UnexpectedIdentifier:  'Unexpected identifier',
        UnexpectedReserved:  'Unexpected reserved word',
        UnexpectedEOS:  'Unexpected end of input',
        NewlineAfterThrow:  'Illegal newline after throw',
        InvalidRegExp: 'Invalid regular expression',
        UnterminatedRegExp:  'Invalid regular expression: missing /',
        InvalidLHSInAssignment:  'Invalid left-hand side in assignment',
        InvalidLHSInForIn:  'Invalid left-hand side in for-in',
        MultipleDefaultsInSwitch: 'More than one default clause in switch statement',
        NoCatchOrFinally:  'Missing catch or finally after try',
        UnknownLabel: 'Undefined label \'%0\'',
        Redeclaration: '%0 \'%1\' has already been declared',
        IllegalContinue: 'Illegal continue statement',
        IllegalBreak: 'Illegal break statement',
        IllegalReturn: 'Illegal return statement',
        StrictModeWith:  'Strict mode code may not include a with statement',
        StrictCatchVariable:  'Catch variable may not be eval or arguments in strict mode',
        StrictVarName:  'Variable name may not be eval or arguments in strict mode',
        StrictParamName:  'Parameter name eval or arguments is not allowed in strict mode',
        StrictParamDupe: 'Strict mode function may not have duplicate parameter names',
        StrictFunctionName:  'Function name may not be eval or arguments in strict mode',
        StrictOctalLiteral:  'Octal literals are not allowed in strict mode.',
        StrictDelete:  'Delete of an unqualified identifier in strict mode.',
        StrictDuplicateProperty:  'Duplicate data property in object literal not allowed in strict mode',
        AccessorDataProperty:  'Object literal may not have data and accessor property with the same name',
        AccessorGetSet:  'Object literal may not have multiple get/set accessors with the same name',
        StrictLHSAssignment:  'Assignment to eval or arguments is not allowed in strict mode',
        StrictLHSPostfix:  'Postfix increment/decrement may not have eval or arguments operand in strict mode',
        StrictLHSPrefix:  'Prefix increment/decrement may not have eval or arguments operand in strict mode',
        StrictReservedWord:  'Use of future reserved word in strict mode'
    };

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    // Ensure the condition is true, otherwise throw an error.
    // This is only to have a better contract semantic, i.e. another safety net
    // to catch a logic error. The condition shall be fulfilled in normal case.
    // Do NOT use this to enforce a certain condition on any user input.

    function assert(condition, message) {
        if (!condition) {
            throw new Error('ASSERT: ' + message);
        }
    }

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return '0123456789abcdefABCDEF'.indexOf(ch) >= 0;
    }

    function isOctalDigit(ch) {
        return '01234567'.indexOf(ch) >= 0;
    }


    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 0x24) || (ch === 0x5F) ||  // $ (dollar) and _ (underscore)
            (ch >= 0x41 && ch <= 0x5A) ||         // A..Z
            (ch >= 0x61 && ch <= 0x7A) ||         // a..z
            (ch === 0x5C) ||                      // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 0x24) || (ch === 0x5F) ||  // $ (dollar) and _ (underscore)
            (ch >= 0x41 && ch <= 0x5A) ||         // A..Z
            (ch >= 0x61 && ch <= 0x7A) ||         // a..z
            (ch >= 0x30 && ch <= 0x39) ||         // 0..9
            (ch === 0x5C) ||                      // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    // 7.6.1.2 Future Reserved Words

    function isFutureReservedWord(id) {
        switch (id) {
        case 'class':
        case 'enum':
        case 'export':
        case 'extends':
        case 'import':
        case 'super':
            return true;
        default:
            return false;
        }
    }

    function isStrictModeReservedWord(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'yield':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    // 7.6.1.1 Keywords

    function isKeyword(id) {
        if (strict && isStrictModeReservedWord(id)) {
            return true;
        }

        // 'const' is specialized as Keyword in V8.
        // 'yield' and 'let' are for compatiblity with SpiderMonkey and ES.next.
        // Some others are from future reserved words.

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') ||
                (id === 'try') || (id === 'let');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    // 7.4 Comments

    function addComment(type, value, start, end, loc) {
        var comment, attacher;

        assert(typeof start === 'number', 'Comment must have valid position');

        // Because the way the actual token is scanned, often the comments
        // (if any) are skipped twice during the lexical analysis.
        // Thus, we need to skip adding a comment if the comment array already
        // handled it.
        if (state.lastCommentStart >= start) {
            return;
        }
        state.lastCommentStart = start;

        comment = {
            type: type,
            value: value
        };
        if (extra.range) {
            comment.range = [start, end];
        }
        if (extra.loc) {
            comment.loc = loc;
        }
        extra.comments.push(comment);

        if (extra.attachComment) {
            attacher = {
                comment: comment,
                leading: null,
                trailing: null,
                range: [start, end]
            };
            extra.pendingComments.push(attacher);
        }
    }

    function skipSingleLineComment(offset) {
        var start, loc, ch, comment;

        start = index - offset;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart - offset
            }
        };

        while (index < length) {
            ch = source.charCodeAt(index);
            ++index;
            if (isLineTerminator(ch)) {
                if (extra.comments) {
                    comment = source.slice(start + offset, index - 1);
                    loc.end = {
                        line: lineNumber,
                        column: index - lineStart - 1
                    };
                    addComment('Line', comment, start, index - 1, loc);
                }
                if (ch === 13 && source.charCodeAt(index) === 10) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
                return;
            }
        }

        if (extra.comments) {
            comment = source.slice(start + offset, index);
            loc.end = {
                line: lineNumber,
                column: index - lineStart
            };
            addComment('Line', comment, start, index, loc);
        }
    }

    function skipMultiLineComment() {
        var start, loc, ch, comment;

        if (extra.comments) {
            start = index - 2;
            loc = {
                start: {
                    line: lineNumber,
                    column: index - lineStart - 2
                }
            };
        }

        while (index < length) {
            ch = source.charCodeAt(index);
            if (isLineTerminator(ch)) {
                if (ch === 0x0D && source.charCodeAt(index + 1) === 0x0A) {
                    ++index;
                }
                ++lineNumber;
                ++index;
                lineStart = index;
                if (index >= length) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            } else if (ch === 0x2A) {
                // Block comment ends with '*/'.
                if (source.charCodeAt(index + 1) === 0x2F) {
                    ++index;
                    ++index;
                    if (extra.comments) {
                        comment = source.slice(start + 2, index - 2);
                        loc.end = {
                            line: lineNumber,
                            column: index - lineStart
                        };
                        addComment('Block', comment, start, index, loc);
                    }
                    return;
                }
                ++index;
            } else {
                ++index;
            }
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    function skipComment() {
        var ch, start;

        start = (index === 0);
        while (index < length) {
            ch = source.charCodeAt(index);

            if (isWhiteSpace(ch)) {
                ++index;
            } else if (isLineTerminator(ch)) {
                ++index;
                if (ch === 0x0D && source.charCodeAt(index) === 0x0A) {
                    ++index;
                }
                ++lineNumber;
                lineStart = index;
                start = true;
            } else if (ch === 0x2F) { // U+002F is '/'
                ch = source.charCodeAt(index + 1);
                if (ch === 0x2F) {
                    ++index;
                    ++index;
                    skipSingleLineComment(2);
                    start = true;
                } else if (ch === 0x2A) {  // U+002A is '*'
                    ++index;
                    ++index;
                    skipMultiLineComment();
                } else {
                    break;
                }
            } else if (start && ch === 0x2D) { // U+002D is '-'
                // U+003E is '>'
                if ((source.charCodeAt(index + 1) === 0x2D) && (source.charCodeAt(index + 2) === 0x3E)) {
                    // '-->' is a single-line comment
                    index += 3;
                    skipSingleLineComment(3);
                } else {
                    break;
                }
            } else if (ch === 0x3C) { // U+003C is '<'
                if (source.slice(index + 1, index + 4) === '!--') {
                    ++index; // `<`
                    ++index; // `!`
                    ++index; // `-`
                    ++index; // `-`
                    skipSingleLineComment(4);
                } else {
                    break;
                }
            } else {
                break;
            }
        }
    }

    function scanHexEscape(prefix) {
        var i, len, ch, code = 0;

        len = (prefix === 'u') ? 4 : 2;
        for (i = 0; i < len; ++i) {
            if (index < length && isHexDigit(source[index])) {
                ch = source[index++];
                code = code * 16 + '0123456789abcdef'.indexOf(ch.toLowerCase());
            } else {
                return '';
            }
        }
        return String.fromCharCode(code);
    }

    function getEscapedIdentifier() {
        var ch, id;

        ch = source.charCodeAt(index++);
        id = String.fromCharCode(ch);

        // '\u' (U+005C, U+0075) denotes an escaped character.
        if (ch === 0x5C) {
            if (source.charCodeAt(index) !== 0x75) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            ++index;
            ch = scanHexEscape('u');
            if (!ch || ch === '\\' || !isIdentifierStart(ch.charCodeAt(0))) {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
            id = ch;
        }

        while (index < length) {
            ch = source.charCodeAt(index);
            if (!isIdentifierPart(ch)) {
                break;
            }
            ++index;
            id += String.fromCharCode(ch);

            // '\u' (U+005C, U+0075) denotes an escaped character.
            if (ch === 0x5C) {
                id = id.substr(0, id.length - 1);
                if (source.charCodeAt(index) !== 0x75) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                ++index;
                ch = scanHexEscape('u');
                if (!ch || ch === '\\' || !isIdentifierPart(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
                id += ch;
            }
        }

        return id;
    }

    function getIdentifier() {
        var start, ch;

        start = index++;
        while (index < length) {
            ch = source.charCodeAt(index);
            if (ch === 0x5C) {
                // Blackslash (U+005C) marks Unicode escape sequence.
                index = start;
                return getEscapedIdentifier();
            }
            if (isIdentifierPart(ch)) {
                ++index;
            } else {
                break;
            }
        }

        return source.slice(start, index);
    }

    function scanIdentifier() {
        var start, id, type;

        start = index;

        // Backslash (U+005C) starts an escaped character.
        id = (source.charCodeAt(index) === 0x5C) ? getEscapedIdentifier() : getIdentifier();

        // There is no keyword or literal with only one character.
        // Thus, it must be an identifier.
        if (id.length === 1) {
            type = Token.Identifier;
        } else if (isKeyword(id)) {
            type = Token.Keyword;
        } else if (id === 'null') {
            type = Token.NullLiteral;
        } else if (id === 'true' || id === 'false') {
            type = Token.BooleanLiteral;
        } else {
            type = Token.Identifier;
        }

        return {
            type: type,
            value: id,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }


    // 7.7 Punctuators

    function scanPunctuator() {
        var start = index,
            code = source.charCodeAt(index),
            code2,
            ch1 = source[index],
            ch2,
            ch3,
            ch4;

        switch (code) {

        // Check for most common single-character punctuators.
        case 0x2E:  // . dot
        case 0x28:  // ( open bracket
        case 0x29:  // ) close bracket
        case 0x3B:  // ; semicolon
        case 0x2C:  // , comma
        case 0x7B:  // { open curly brace
        case 0x7D:  // } close curly brace
        case 0x5B:  // [
        case 0x5D:  // ]
        case 0x3A:  // :
        case 0x3F:  // ?
        case 0x7E:  // ~
            ++index;
            if (extra.tokenize) {
                if (code === 0x28) {
                    extra.openParenToken = extra.tokens.length;
                } else if (code === 0x7B) {
                    extra.openCurlyToken = extra.tokens.length;
                }
            }
            return {
                type: Token.Punctuator,
                value: String.fromCharCode(code),
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };

        default:
            code2 = source.charCodeAt(index + 1);

            // '=' (U+003D) marks an assignment or comparison operator.
            if (code2 === 0x3D) {
                switch (code) {
                case 0x25:  // %
                case 0x26:  // &
                case 0x2A:  // *:
                case 0x2B:  // +
                case 0x2D:  // -
                case 0x2F:  // /
                case 0x3C:  // <
                case 0x3E:  // >
                case 0x5E:  // ^
                case 0x7C:  // |
                    index += 2;
                    return {
                        type: Token.Punctuator,
                        value: String.fromCharCode(code) + String.fromCharCode(code2),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };

                case 0x21: // !
                case 0x3D: // =
                    index += 2;

                    // !== and ===
                    if (source.charCodeAt(index) === 0x3D) {
                        ++index;
                    }
                    return {
                        type: Token.Punctuator,
                        value: source.slice(start, index),
                        lineNumber: lineNumber,
                        lineStart: lineStart,
                        range: [start, index]
                    };
                default:
                    break;
                }
            }
            break;
        }

        // Peek more characters.

        ch2 = source[index + 1];
        ch3 = source[index + 2];
        ch4 = source[index + 3];

        // 4-character punctuator: >>>=

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            if (ch4 === '=') {
                index += 4;
                return {
                    type: Token.Punctuator,
                    value: '>>>=',
                    lineNumber: lineNumber,
                    lineStart: lineStart,
                    range: [start, index]
                };
            }
        }

        // 3-character punctuators: === !== >>> <<= >>=

        if (ch1 === '>' && ch2 === '>' && ch3 === '>') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>>',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '<' && ch2 === '<' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '<<=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if (ch1 === '>' && ch2 === '>' && ch3 === '=') {
            index += 3;
            return {
                type: Token.Punctuator,
                value: '>>=',
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        // Other 2-character punctuators: ++ -- << >> && ||

        if (ch1 === ch2 && ('+-<>&|'.indexOf(ch1) >= 0)) {
            index += 2;
            return {
                type: Token.Punctuator,
                value: ch1 + ch2,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        if ('<>=!+-*%&|^/'.indexOf(ch1) >= 0) {
            ++index;
            return {
                type: Token.Punctuator,
                value: ch1,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }

        throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
    }

    // 7.8.3 Numeric Literals

    function scanHexLiteral(start) {
        var number = '';

        while (index < length) {
            if (!isHexDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (number.length === 0) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt('0x' + number, 16),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanOctalLiteral(start) {
        var number = '0' + source[index++];
        while (index < length) {
            if (!isOctalDigit(source[index])) {
                break;
            }
            number += source[index++];
        }

        if (isIdentifierStart(source.charCodeAt(index)) || isDecimalDigit(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseInt(number, 8),
            octal: true,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanNumericLiteral() {
        var number, start, ch;

        ch = source[index];
        assert(isDecimalDigit(ch.charCodeAt(0)) || (ch === '.'),
            'Numeric literal must start with a decimal digit or a decimal point');

        start = index;
        number = '';
        if (ch !== '.') {
            number = source[index++];
            ch = source[index];

            // Hex number starts with '0x'.
            // Octal number starts with '0'.
            if (number === '0') {
                if (ch === 'x' || ch === 'X') {
                    ++index;
                    return scanHexLiteral(start);
                }
                if (isOctalDigit(ch)) {
                    return scanOctalLiteral(start);
                }

                // decimal number starts with '0' such as '09' is illegal.
                if (ch && isDecimalDigit(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
                }
            }

            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === '.') {
            number += source[index++];
            while (isDecimalDigit(source.charCodeAt(index))) {
                number += source[index++];
            }
            ch = source[index];
        }

        if (ch === 'e' || ch === 'E') {
            number += source[index++];

            ch = source[index];
            if (ch === '+' || ch === '-') {
                number += source[index++];
            }
            if (isDecimalDigit(source.charCodeAt(index))) {
                while (isDecimalDigit(source.charCodeAt(index))) {
                    number += source[index++];
                }
            } else {
                throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
            }
        }

        if (isIdentifierStart(source.charCodeAt(index))) {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.NumericLiteral,
            value: parseFloat(number),
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    // 7.8.4 String Literals

    function scanStringLiteral() {
        var str = '', quote, start, ch, code, unescaped, restore, octal = false;

        quote = source[index];
        assert((quote === '\'' || quote === '"'),
            'String literal must starts with a quote');

        start = index;
        ++index;

        while (index < length) {
            ch = source[index++];

            if (ch === quote) {
                quote = '';
                break;
            } else if (ch === '\\') {
                ch = source[index++];
                if (!ch || !isLineTerminator(ch.charCodeAt(0))) {
                    switch (ch) {
                    case 'n':
                        str += '\n';
                        break;
                    case 'r':
                        str += '\r';
                        break;
                    case 't':
                        str += '\t';
                        break;
                    case 'u':
                    case 'x':
                        restore = index;
                        unescaped = scanHexEscape(ch);
                        if (unescaped) {
                            str += unescaped;
                        } else {
                            index = restore;
                            str += ch;
                        }
                        break;
                    case 'b':
                        str += '\b';
                        break;
                    case 'f':
                        str += '\f';
                        break;
                    case 'v':
                        str += '\x0B';
                        break;

                    default:
                        if (isOctalDigit(ch)) {
                            code = '01234567'.indexOf(ch);

                            // \0 is not octal escape sequence
                            if (code !== 0) {
                                octal = true;
                            }

                            if (index < length && isOctalDigit(source[index])) {
                                octal = true;
                                code = code * 8 + '01234567'.indexOf(source[index++]);

                                // 3 digits are only allowed when string starts
                                // with 0, 1, 2, 3
                                if ('0123'.indexOf(ch) >= 0 &&
                                        index < length &&
                                        isOctalDigit(source[index])) {
                                    code = code * 8 + '01234567'.indexOf(source[index++]);
                                }
                            }
                            str += String.fromCharCode(code);
                        } else {
                            str += ch;
                        }
                        break;
                    }
                } else {
                    ++lineNumber;
                    if (ch ===  '\r' && source[index] === '\n') {
                        ++index;
                    }
                    lineStart = index;
                }
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                break;
            } else {
                str += ch;
            }
        }

        if (quote !== '') {
            throwError({}, Messages.UnexpectedToken, 'ILLEGAL');
        }

        return {
            type: Token.StringLiteral,
            value: str,
            octal: octal,
            lineNumber: lineNumber,
            lineStart: lineStart,
            range: [start, index]
        };
    }

    function scanRegExp() {
        var str, ch, start, pattern, flags, value, classMarker = false, restore, terminated = false;

        lookahead = null;
        skipComment();

        start = index;
        ch = source[index];
        assert(ch === '/', 'Regular expression literal must start with a slash');
        str = source[index++];

        while (index < length) {
            ch = source[index++];
            str += ch;
            if (ch === '\\') {
                ch = source[index++];
                // ECMA-262 7.8.5
                if (isLineTerminator(ch.charCodeAt(0))) {
                    throwError({}, Messages.UnterminatedRegExp);
                }
                str += ch;
            } else if (isLineTerminator(ch.charCodeAt(0))) {
                throwError({}, Messages.UnterminatedRegExp);
            } else if (classMarker) {
                if (ch === ']') {
                    classMarker = false;
                }
            } else {
                if (ch === '/') {
                    terminated = true;
                    break;
                } else if (ch === '[') {
                    classMarker = true;
                }
            }
        }

        if (!terminated) {
            throwError({}, Messages.UnterminatedRegExp);
        }

        // Exclude leading and trailing slash.
        pattern = str.substr(1, str.length - 2);

        flags = '';
        while (index < length) {
            ch = source[index];
            if (!isIdentifierPart(ch.charCodeAt(0))) {
                break;
            }

            ++index;
            if (ch === '\\' && index < length) {
                ch = source[index];
                if (ch === 'u') {
                    ++index;
                    restore = index;
                    ch = scanHexEscape('u');
                    if (ch) {
                        flags += ch;
                        for (str += '\\u'; restore < index; ++restore) {
                            str += source[restore];
                        }
                    } else {
                        index = restore;
                        flags += 'u';
                        str += '\\u';
                    }
                } else {
                    str += '\\';
                }
            } else {
                flags += ch;
                str += ch;
            }
        }

        try {
            value = new RegExp(pattern, flags);
        } catch (e) {
            throwError({}, Messages.InvalidRegExp);
        }



        if (extra.tokenize) {
            return {
                type: Token.RegularExpression,
                value: value,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [start, index]
            };
        }
        return {
            literal: str,
            value: value,
            range: [start, index]
        };
    }

    function collectRegex() {
        var pos, loc, regex, token;

        skipComment();

        pos = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        regex = scanRegExp();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (!extra.tokenize) {
            // Pop the previous token, which is likely '/' or '/='
            if (extra.tokens.length > 0) {
                token = extra.tokens[extra.tokens.length - 1];
                if (token.range[0] === pos && token.type === 'Punctuator') {
                    if (token.value === '/' || token.value === '/=') {
                        extra.tokens.pop();
                    }
                }
            }

            extra.tokens.push({
                type: 'RegularExpression',
                value: regex.literal,
                range: [pos, index],
                loc: loc
            });
        }

        return regex;
    }

    function isIdentifierName(token) {
        return token.type === Token.Identifier ||
            token.type === Token.Keyword ||
            token.type === Token.BooleanLiteral ||
            token.type === Token.NullLiteral;
    }

    function advanceSlash() {
        var prevToken,
            checkToken;
        // Using the following algorithm:
        // https://github.com/mozilla/sweet.js/wiki/design
        prevToken = extra.tokens[extra.tokens.length - 1];
        if (!prevToken) {
            // Nothing before that: it cannot be a division.
            return collectRegex();
        }
        if (prevToken.type === 'Punctuator') {
            if (prevToken.value === ']') {
                return scanPunctuator();
            }
            if (prevToken.value === ')') {
                checkToken = extra.tokens[extra.openParenToken - 1];
                if (checkToken &&
                        checkToken.type === 'Keyword' &&
                        (checkToken.value === 'if' ||
                         checkToken.value === 'while' ||
                         checkToken.value === 'for' ||
                         checkToken.value === 'with')) {
                    return collectRegex();
                }
                return scanPunctuator();
            }
            if (prevToken.value === '}') {
                // Dividing a function by anything makes little sense,
                // but we have to check for that.
                if (extra.tokens[extra.openCurlyToken - 3] &&
                        extra.tokens[extra.openCurlyToken - 3].type === 'Keyword') {
                    // Anonymous function.
                    checkToken = extra.tokens[extra.openCurlyToken - 4];
                    if (!checkToken) {
                        return scanPunctuator();
                    }
                } else if (extra.tokens[extra.openCurlyToken - 4] &&
                        extra.tokens[extra.openCurlyToken - 4].type === 'Keyword') {
                    // Named function.
                    checkToken = extra.tokens[extra.openCurlyToken - 5];
                    if (!checkToken) {
                        return collectRegex();
                    }
                } else {
                    return scanPunctuator();
                }
                // checkToken determines whether the function is
                // a declaration or an expression.
                if (FnExprTokens.indexOf(checkToken.value) >= 0) {
                    // It is an expression.
                    return scanPunctuator();
                }
                // It is a declaration.
                return collectRegex();
            }
            return collectRegex();
        }
        if (prevToken.type === 'Keyword') {
            return collectRegex();
        }
        return scanPunctuator();
    }

    function advance() {
        var ch;

        skipComment();

        if (index >= length) {
            return {
                type: Token.EOF,
                lineNumber: lineNumber,
                lineStart: lineStart,
                range: [index, index]
            };
        }

        ch = source.charCodeAt(index);

        // Very common: ( and ) and ;
        if (ch === 0x28 || ch === 0x29 || ch === 0x3A) {
            return scanPunctuator();
        }

        // String literal starts with single quote (U+0027) or double quote (U+0022).
        if (ch === 0x27 || ch === 0x22) {
            return scanStringLiteral();
        }

        if (isIdentifierStart(ch)) {
            return scanIdentifier();
        }

        // Dot (.) U+002E can also start a floating-point number, hence the need
        // to check the next character.
        if (ch === 0x2E) {
            if (isDecimalDigit(source.charCodeAt(index + 1))) {
                return scanNumericLiteral();
            }
            return scanPunctuator();
        }

        if (isDecimalDigit(ch)) {
            return scanNumericLiteral();
        }

        // Slash (/) U+002F can also start a regex.
        if (extra.tokenize && ch === 0x2F) {
            return advanceSlash();
        }

        return scanPunctuator();
    }

    function collectToken() {
        var start, loc, token, range, value;

        skipComment();
        start = index;
        loc = {
            start: {
                line: lineNumber,
                column: index - lineStart
            }
        };

        token = advance();
        loc.end = {
            line: lineNumber,
            column: index - lineStart
        };

        if (token.type !== Token.EOF) {
            range = [token.range[0], token.range[1]];
            value = source.slice(token.range[0], token.range[1]);
            extra.tokens.push({
                type: TokenName[token.type],
                value: value,
                range: range,
                loc: loc
            });
        }

        return token;
    }

    function lex() {
        var token;

        token = lookahead;
        index = token.range[1];
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        lookahead = (typeof extra.tokens !== 'undefined') ? collectToken() : advance();

        index = token.range[1];
        lineNumber = token.lineNumber;
        lineStart = token.lineStart;

        return token;
    }

    function peek() {
        var pos, line, start;

        pos = index;
        line = lineNumber;
        start = lineStart;
        lookahead = (typeof extra.tokens !== 'undefined') ? collectToken() : advance();
        index = pos;
        lineNumber = line;
        lineStart = start;
    }

    SyntaxTreeDelegate = {

        name: 'SyntaxTree',

        markStart: function () {
            skipComment();
            if (extra.loc) {
                state.markerStack.push(index - lineStart);
                state.markerStack.push(lineNumber);
            }
            if (extra.range) {
                state.markerStack.push(index);
            }
        },

        processComment: function (node) {
            var i, attacher, pos, len, candidate;

            if (typeof node.type === 'undefined' || node.type === Syntax.Program) {
                return;
            }

            // Check for possible additional trailing comments.
            peek();

            for (i = 0; i < extra.pendingComments.length; ++i) {
                attacher = extra.pendingComments[i];
                if (node.range[0] >= attacher.comment.range[1]) {
                    candidate = attacher.leading;
                    if (candidate) {
                        pos = candidate.range[0];
                        len = candidate.range[1] - pos;
                        if (node.range[0] <= pos && (node.range[1] - node.range[0] >= len)) {
                            attacher.leading = node;
                        }
                    } else {
                        attacher.leading = node;
                    }
                }
                if (node.range[1] <= attacher.comment.range[0]) {
                    candidate = attacher.trailing;
                    if (candidate) {
                        pos = candidate.range[0];
                        len = candidate.range[1] - pos;
                        if (node.range[0] <= pos && (node.range[1] - node.range[0] >= len)) {
                            attacher.trailing = node;
                        }
                    } else {
                        attacher.trailing = node;
                    }
                }
            }
        },

        markEnd: function (node) {
            if (extra.range) {
                node.range = [state.markerStack.pop(), index];
            }
            if (extra.loc) {
                node.loc = {
                    start: {
                        line: state.markerStack.pop(),
                        column: state.markerStack.pop()
                    },
                    end: {
                        line: lineNumber,
                        column: index - lineStart
                    }
                };
                this.postProcess(node);
            }
            if (extra.attachComment) {
                this.processComment(node);
            }
            return node;
        },

        markEndIf: function (node) {
            if (node.range || node.loc) {
                if (extra.loc) {
                    state.markerStack.pop();
                    state.markerStack.pop();
                }
                if (extra.range) {
                    state.markerStack.pop();
                }
            } else {
                this.markEnd(node);
            }
            return node;
        },

        postProcess: function (node) {
            if (extra.source) {
                node.loc.source = extra.source;
            }
            return node;
        },

        createArrayExpression: function (elements) {
            return {
                type: Syntax.ArrayExpression,
                elements: elements
            };
        },

        createAssignmentExpression: function (operator, left, right) {
            return {
                type: Syntax.AssignmentExpression,
                operator: operator,
                left: left,
                right: right
            };
        },

        createBinaryExpression: function (operator, left, right) {
            var type = (operator === '||' || operator === '&&') ? Syntax.LogicalExpression :
                        Syntax.BinaryExpression;
            return {
                type: type,
                operator: operator,
                left: left,
                right: right
            };
        },

        createBlockStatement: function (body) {
            return {
                type: Syntax.BlockStatement,
                body: body
            };
        },

        createBreakStatement: function (label) {
            return {
                type: Syntax.BreakStatement,
                label: label
            };
        },

        createCallExpression: function (callee, args) {
            return {
                type: Syntax.CallExpression,
                callee: callee,
                'arguments': args
            };
        },

        createCatchClause: function (param, body) {
            return {
                type: Syntax.CatchClause,
                param: param,
                body: body
            };
        },

        createConditionalExpression: function (test, consequent, alternate) {
            return {
                type: Syntax.ConditionalExpression,
                test: test,
                consequent: consequent,
                alternate: alternate
            };
        },

        createContinueStatement: function (label) {
            return {
                type: Syntax.ContinueStatement,
                label: label
            };
        },

        createDebuggerStatement: function () {
            return {
                type: Syntax.DebuggerStatement
            };
        },

        createDoWhileStatement: function (body, test) {
            return {
                type: Syntax.DoWhileStatement,
                body: body,
                test: test
            };
        },

        createEmptyStatement: function () {
            return {
                type: Syntax.EmptyStatement
            };
        },

        createExpressionStatement: function (expression) {
            return {
                type: Syntax.ExpressionStatement,
                expression: expression
            };
        },

        createForStatement: function (init, test, update, body) {
            return {
                type: Syntax.ForStatement,
                init: init,
                test: test,
                update: update,
                body: body
            };
        },

        createForInStatement: function (left, right, body) {
            return {
                type: Syntax.ForInStatement,
                left: left,
                right: right,
                body: body,
                each: false
            };
        },

        createFunctionDeclaration: function (id, params, defaults, body) {
            return {
                type: Syntax.FunctionDeclaration,
                id: id,
                params: params,
                defaults: defaults,
                body: body,
                rest: null,
                generator: false,
                expression: false
            };
        },

        createFunctionExpression: function (id, params, defaults, body) {
            return {
                type: Syntax.FunctionExpression,
                id: id,
                params: params,
                defaults: defaults,
                body: body,
                rest: null,
                generator: false,
                expression: false
            };
        },

        createIdentifier: function (name) {
            return {
                type: Syntax.Identifier,
                name: name
            };
        },

        createIfStatement: function (test, consequent, alternate) {
            return {
                type: Syntax.IfStatement,
                test: test,
                consequent: consequent,
                alternate: alternate
            };
        },

        createLabeledStatement: function (label, body) {
            return {
                type: Syntax.LabeledStatement,
                label: label,
                body: body
            };
        },

        createLiteral: function (token) {
            return {
                type: Syntax.Literal,
                value: token.value,
                raw: source.slice(token.range[0], token.range[1])
            };
        },

        createMemberExpression: function (accessor, object, property) {
            return {
                type: Syntax.MemberExpression,
                computed: accessor === '[',
                object: object,
                property: property
            };
        },

        createNewExpression: function (callee, args) {
            return {
                type: Syntax.NewExpression,
                callee: callee,
                'arguments': args
            };
        },

        createObjectExpression: function (properties) {
            return {
                type: Syntax.ObjectExpression,
                properties: properties
            };
        },

        createPostfixExpression: function (operator, argument) {
            return {
                type: Syntax.UpdateExpression,
                operator: operator,
                argument: argument,
                prefix: false
            };
        },

        createProgram: function (body) {
            return {
                type: Syntax.Program,
                body: body
            };
        },

        createProperty: function (kind, key, value) {
            return {
                type: Syntax.Property,
                key: key,
                value: value,
                kind: kind
            };
        },

        createReturnStatement: function (argument) {
            return {
                type: Syntax.ReturnStatement,
                argument: argument
            };
        },

        createSequenceExpression: function (expressions) {
            return {
                type: Syntax.SequenceExpression,
                expressions: expressions
            };
        },

        createSwitchCase: function (test, consequent) {
            return {
                type: Syntax.SwitchCase,
                test: test,
                consequent: consequent
            };
        },

        createSwitchStatement: function (discriminant, cases) {
            return {
                type: Syntax.SwitchStatement,
                discriminant: discriminant,
                cases: cases
            };
        },

        createThisExpression: function () {
            return {
                type: Syntax.ThisExpression
            };
        },

        createThrowStatement: function (argument) {
            return {
                type: Syntax.ThrowStatement,
                argument: argument
            };
        },

        createTryStatement: function (block, guardedHandlers, handlers, finalizer) {
            return {
                type: Syntax.TryStatement,
                block: block,
                guardedHandlers: guardedHandlers,
                handlers: handlers,
                finalizer: finalizer
            };
        },

        createUnaryExpression: function (operator, argument) {
            if (operator === '++' || operator === '--') {
                return {
                    type: Syntax.UpdateExpression,
                    operator: operator,
                    argument: argument,
                    prefix: true
                };
            }
            return {
                type: Syntax.UnaryExpression,
                operator: operator,
                argument: argument,
                prefix: true
            };
        },

        createVariableDeclaration: function (declarations, kind) {
            return {
                type: Syntax.VariableDeclaration,
                declarations: declarations,
                kind: kind
            };
        },

        createVariableDeclarator: function (id, init) {
            return {
                type: Syntax.VariableDeclarator,
                id: id,
                init: init
            };
        },

        createWhileStatement: function (test, body) {
            return {
                type: Syntax.WhileStatement,
                test: test,
                body: body
            };
        },

        createWithStatement: function (object, body) {
            return {
                type: Syntax.WithStatement,
                object: object,
                body: body
            };
        }
    };

    // Return true if there is a line terminator before the next token.

    function peekLineTerminator() {
        var pos, line, start, found;

        pos = index;
        line = lineNumber;
        start = lineStart;
        skipComment();
        found = lineNumber !== line;
        index = pos;
        lineNumber = line;
        lineStart = start;

        return found;
    }

    // Throw an exception

    function throwError(token, messageFormat) {
        var error,
            args = Array.prototype.slice.call(arguments, 2),
            msg = messageFormat.replace(
                /%(\d)/g,
                function (whole, index) {
                    assert(index < args.length, 'Message reference must be in range');
                    return args[index];
                }
            );

        if (typeof token.lineNumber === 'number') {
            error = new Error('Line ' + token.lineNumber + ': ' + msg);
            error.index = token.range[0];
            error.lineNumber = token.lineNumber;
            error.column = token.range[0] - lineStart + 1;
        } else {
            error = new Error('Line ' + lineNumber + ': ' + msg);
            error.index = index;
            error.lineNumber = lineNumber;
            error.column = index - lineStart + 1;
        }

        error.description = msg;
        throw error;
    }

    function throwErrorTolerant() {
        try {
            throwError.apply(null, arguments);
        } catch (e) {
            if (extra.errors) {
                extra.errors.push(e);
            } else {
                throw e;
            }
        }
    }


    // Throw an exception because of the token.

    function throwUnexpected(token) {
        if (token.type === Token.EOF) {
            throwError(token, Messages.UnexpectedEOS);
        }

        if (token.type === Token.NumericLiteral) {
            throwError(token, Messages.UnexpectedNumber);
        }

        if (token.type === Token.StringLiteral) {
            throwError(token, Messages.UnexpectedString);
        }

        if (token.type === Token.Identifier) {
            throwError(token, Messages.UnexpectedIdentifier);
        }

        if (token.type === Token.Keyword) {
            if (isFutureReservedWord(token.value)) {
                throwError(token, Messages.UnexpectedReserved);
            } else if (strict && isStrictModeReservedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictReservedWord);
                return;
            }
            throwError(token, Messages.UnexpectedToken, token.value);
        }

        // BooleanLiteral, NullLiteral, or Punctuator.
        throwError(token, Messages.UnexpectedToken, token.value);
    }

    // Expect the next token to match the specified punctuator.
    // If not, an exception will be thrown.

    function expect(value) {
        var token = lex();
        if (token.type !== Token.Punctuator || token.value !== value) {
            throwUnexpected(token);
        }
    }

    // Expect the next token to match the specified keyword.
    // If not, an exception will be thrown.

    function expectKeyword(keyword) {
        var token = lex();
        if (token.type !== Token.Keyword || token.value !== keyword) {
            throwUnexpected(token);
        }
    }

    // Return true if the next token matches the specified punctuator.

    function match(value) {
        return lookahead.type === Token.Punctuator && lookahead.value === value;
    }

    // Return true if the next token matches the specified keyword

    function matchKeyword(keyword) {
        return lookahead.type === Token.Keyword && lookahead.value === keyword;
    }

    // Return true if the next token is an assignment operator

    function matchAssign() {
        var op;

        if (lookahead.type !== Token.Punctuator) {
            return false;
        }
        op = lookahead.value;
        return op === '=' ||
            op === '*=' ||
            op === '/=' ||
            op === '%=' ||
            op === '+=' ||
            op === '-=' ||
            op === '<<=' ||
            op === '>>=' ||
            op === '>>>=' ||
            op === '&=' ||
            op === '^=' ||
            op === '|=';
    }

    function consumeSemicolon() {
        var line;

        // Catch the very common case first: immediately a semicolon (U+003B).
        if (source.charCodeAt(index) === 0x3B) {
            lex();
            return;
        }

        line = lineNumber;
        skipComment();
        if (lineNumber !== line) {
            return;
        }

        if (match(';')) {
            lex();
            return;
        }

        if (lookahead.type !== Token.EOF && !match('}')) {
            throwUnexpected(lookahead);
        }
    }

    // Return true if provided expression is LeftHandSideExpression

    function isLeftHandSide(expr) {
        return expr.type === Syntax.Identifier || expr.type === Syntax.MemberExpression;
    }

    // 11.1.4 Array Initialiser

    function parseArrayInitialiser() {
        var elements = [];

        expect('[');

        while (!match(']')) {
            if (match(',')) {
                lex();
                elements.push(null);
            } else {
                elements.push(parseAssignmentExpression());

                if (!match(']')) {
                    expect(',');
                }
            }
        }

        expect(']');

        return delegate.createArrayExpression(elements);
    }

    // 11.1.5 Object Initialiser

    function parsePropertyFunction(param, first) {
        var previousStrict, body;

        previousStrict = strict;
        delegate.markStart();
        body = parseFunctionSourceElements();
        if (first && strict && isRestrictedWord(param[0].name)) {
            throwErrorTolerant(first, Messages.StrictParamName);
        }
        strict = previousStrict;
        return delegate.markEnd(delegate.createFunctionExpression(null, param, [], body));
    }

    function parseObjectPropertyKey() {
        var token;

        delegate.markStart();
        token = lex();

        // Note: This function is called only from parseObjectProperty(), where
        // EOF and Punctuator tokens are already filtered out.

        if (token.type === Token.StringLiteral || token.type === Token.NumericLiteral) {
            if (strict && token.octal) {
                throwErrorTolerant(token, Messages.StrictOctalLiteral);
            }
            return delegate.markEnd(delegate.createLiteral(token));
        }

        return delegate.markEnd(delegate.createIdentifier(token.value));
    }

    function parseObjectProperty() {
        var token, key, id, value, param;

        token = lookahead;
        delegate.markStart();

        if (token.type === Token.Identifier) {

            id = parseObjectPropertyKey();

            // Property Assignment: Getter and Setter.

            if (token.value === 'get' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                expect(')');
                value = parsePropertyFunction([]);
                return delegate.markEnd(delegate.createProperty('get', key, value));
            }
            if (token.value === 'set' && !match(':')) {
                key = parseObjectPropertyKey();
                expect('(');
                token = lookahead;
                if (token.type !== Token.Identifier) {
                    expect(')');
                    throwErrorTolerant(token, Messages.UnexpectedToken, token.value);
                    value = parsePropertyFunction([]);
                } else {
                    param = [ parseVariableIdentifier() ];
                    expect(')');
                    value = parsePropertyFunction(param, token);
                }
                return delegate.markEnd(delegate.createProperty('set', key, value));
            }
            expect(':');
            value = parseAssignmentExpression();
            return delegate.markEnd(delegate.createProperty('init', id, value));
        }
        if (token.type === Token.EOF || token.type === Token.Punctuator) {
            throwUnexpected(token);
        } else {
            key = parseObjectPropertyKey();
            expect(':');
            value = parseAssignmentExpression();
            return delegate.markEnd(delegate.createProperty('init', key, value));
        }
    }

    function parseObjectInitialiser() {
        var properties = [], property, name, key, kind, map = {}, toString = String;

        expect('{');

        while (!match('}')) {
            property = parseObjectProperty();

            if (property.key.type === Syntax.Identifier) {
                name = property.key.name;
            } else {
                name = toString(property.key.value);
            }
            kind = (property.kind === 'init') ? PropertyKind.Data : (property.kind === 'get') ? PropertyKind.Get : PropertyKind.Set;

            key = '$' + name;
            if (Object.prototype.hasOwnProperty.call(map, key)) {
                if (map[key] === PropertyKind.Data) {
                    if (strict && kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.StrictDuplicateProperty);
                    } else if (kind !== PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    }
                } else {
                    if (kind === PropertyKind.Data) {
                        throwErrorTolerant({}, Messages.AccessorDataProperty);
                    } else if (map[key] & kind) {
                        throwErrorTolerant({}, Messages.AccessorGetSet);
                    }
                }
                map[key] |= kind;
            } else {
                map[key] = kind;
            }

            properties.push(property);

            if (!match('}')) {
                expect(',');
            }
        }

        expect('}');

        return delegate.createObjectExpression(properties);
    }

    // 11.1.6 The Grouping Operator

    function parseGroupExpression() {
        var expr;

        expect('(');

        expr = parseExpression();

        expect(')');

        return expr;
    }


    // 11.1 Primary Expressions

    function parsePrimaryExpression() {
        var type, token, expr;

        if (match('(')) {
            return parseGroupExpression();
        }

        type = lookahead.type;
        delegate.markStart();

        if (type === Token.Identifier) {
            expr =  delegate.createIdentifier(lex().value);
        } else if (type === Token.StringLiteral || type === Token.NumericLiteral) {
            if (strict && lookahead.octal) {
                throwErrorTolerant(lookahead, Messages.StrictOctalLiteral);
            }
            expr = delegate.createLiteral(lex());
        } else if (type === Token.Keyword) {
            if (matchKeyword('this')) {
                lex();
                expr = delegate.createThisExpression();
            } else if (matchKeyword('function')) {
                expr = parseFunctionExpression();
            }
        } else if (type === Token.BooleanLiteral) {
            token = lex();
            token.value = (token.value === 'true');
            expr = delegate.createLiteral(token);
        } else if (type === Token.NullLiteral) {
            token = lex();
            token.value = null;
            expr = delegate.createLiteral(token);
        } else if (match('[')) {
            expr = parseArrayInitialiser();
        } else if (match('{')) {
            expr = parseObjectInitialiser();
        } else if (match('/') || match('/=')) {
            if (typeof extra.tokens !== 'undefined') {
                expr = delegate.createLiteral(collectRegex());
            } else {
                expr = delegate.createLiteral(scanRegExp());
            }
            peek();
        }

        if (expr) {
            return delegate.markEnd(expr);
        }

        throwUnexpected(lex());
    }

    // 11.2 Left-Hand-Side Expressions

    function parseArguments() {
        var args = [];

        expect('(');

        if (!match(')')) {
            while (index < length) {
                args.push(parseAssignmentExpression());
                if (match(')')) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        return args;
    }

    function parseNonComputedProperty() {
        var token;

        delegate.markStart();
        token = lex();

        if (!isIdentifierName(token)) {
            throwUnexpected(token);
        }

        return delegate.markEnd(delegate.createIdentifier(token.value));
    }

    function parseNonComputedMember() {
        expect('.');

        return parseNonComputedProperty();
    }

    function parseComputedMember() {
        var expr;

        expect('[');

        expr = parseExpression();

        expect(']');

        return expr;
    }

    function parseNewExpression() {
        var callee, args;

        delegate.markStart();
        expectKeyword('new');
        callee = parseLeftHandSideExpression();
        args = match('(') ? parseArguments() : [];

        return delegate.markEnd(delegate.createNewExpression(callee, args));
    }

    function parseLeftHandSideExpressionAllowCall() {
        var marker, previousAllowIn, expr, args, property;

        marker = createLocationMarker();

        previousAllowIn = state.allowIn;
        state.allowIn = true;
        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
        state.allowIn = previousAllowIn;

        while (match('.') || match('[') || match('(')) {
            if (match('(')) {
                args = parseArguments();
                expr = delegate.createCallExpression(expr, args);
            } else if (match('[')) {
                property = parseComputedMember();
                expr = delegate.createMemberExpression('[', expr, property);
            } else {
                property = parseNonComputedMember();
                expr = delegate.createMemberExpression('.', expr, property);
            }
            if (marker) {
                marker.apply(expr);
            }
        }

        return expr;
    }

    function parseLeftHandSideExpression() {
        var marker, previousAllowIn, expr, property;

        marker = createLocationMarker();

        previousAllowIn = state.allowIn;
        expr = matchKeyword('new') ? parseNewExpression() : parsePrimaryExpression();
        state.allowIn = previousAllowIn;

        while (match('.') || match('[')) {
            if (match('[')) {
                property = parseComputedMember();
                expr = delegate.createMemberExpression('[', expr, property);
            } else {
                property = parseNonComputedMember();
                expr = delegate.createMemberExpression('.', expr, property);
            }
            if (marker) {
                marker.apply(expr);
            }
        }

        return expr;
    }

    // 11.3 Postfix Expressions

    function parsePostfixExpression() {
        var expr, token;

        delegate.markStart();
        expr = parseLeftHandSideExpressionAllowCall();

        if (lookahead.type === Token.Punctuator) {
            if ((match('++') || match('--')) && !peekLineTerminator()) {
                // 11.3.1, 11.3.2
                if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                    throwErrorTolerant({}, Messages.StrictLHSPostfix);
                }

                if (!isLeftHandSide(expr)) {
                    throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
                }

                token = lex();
                expr = delegate.createPostfixExpression(token.value, expr);
            }
        }

        return delegate.markEndIf(expr);
    }

    // 11.4 Unary Operators

    function parseUnaryExpression() {
        var token, expr;

        delegate.markStart();

        if (lookahead.type !== Token.Punctuator && lookahead.type !== Token.Keyword) {
            expr = parsePostfixExpression();
        } else if (match('++') || match('--')) {
            token = lex();
            expr = parseUnaryExpression();
            // 11.4.4, 11.4.5
            if (strict && expr.type === Syntax.Identifier && isRestrictedWord(expr.name)) {
                throwErrorTolerant({}, Messages.StrictLHSPrefix);
            }

            if (!isLeftHandSide(expr)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            expr = delegate.createUnaryExpression(token.value, expr);
        } else if (match('+') || match('-') || match('~') || match('!')) {
            token = lex();
            expr = parseUnaryExpression();
            expr = delegate.createUnaryExpression(token.value, expr);
        } else if (matchKeyword('delete') || matchKeyword('void') || matchKeyword('typeof')) {
            token = lex();
            expr = parseUnaryExpression();
            expr = delegate.createUnaryExpression(token.value, expr);
            if (strict && expr.operator === 'delete' && expr.argument.type === Syntax.Identifier) {
                throwErrorTolerant({}, Messages.StrictDelete);
            }
        } else {
            expr = parsePostfixExpression();
        }

        return delegate.markEndIf(expr);
    }

    function binaryPrecedence(token, allowIn) {
        var prec = 0;

        if (token.type !== Token.Punctuator && token.type !== Token.Keyword) {
            return 0;
        }

        switch (token.value) {
        case '||':
            prec = 1;
            break;

        case '&&':
            prec = 2;
            break;

        case '|':
            prec = 3;
            break;

        case '^':
            prec = 4;
            break;

        case '&':
            prec = 5;
            break;

        case '==':
        case '!=':
        case '===':
        case '!==':
            prec = 6;
            break;

        case '<':
        case '>':
        case '<=':
        case '>=':
        case 'instanceof':
            prec = 7;
            break;

        case 'in':
            prec = allowIn ? 7 : 0;
            break;

        case '<<':
        case '>>':
        case '>>>':
            prec = 8;
            break;

        case '+':
        case '-':
            prec = 9;
            break;

        case '*':
        case '/':
        case '%':
            prec = 11;
            break;

        default:
            break;
        }

        return prec;
    }

    // 11.5 Multiplicative Operators
    // 11.6 Additive Operators
    // 11.7 Bitwise Shift Operators
    // 11.8 Relational Operators
    // 11.9 Equality Operators
    // 11.10 Binary Bitwise Operators
    // 11.11 Binary Logical Operators

    function parseBinaryExpression() {
        var marker, markers, expr, token, prec, stack, right, operator, left, i;

        marker = createLocationMarker();
        left = parseUnaryExpression();

        token = lookahead;
        prec = binaryPrecedence(token, state.allowIn);
        if (prec === 0) {
            return left;
        }
        token.prec = prec;
        lex();

        markers = [marker, createLocationMarker()];
        right = parseUnaryExpression();

        stack = [left, token, right];

        while ((prec = binaryPrecedence(lookahead, state.allowIn)) > 0) {

            // Reduce: make a binary expression from the three topmost entries.
            while ((stack.length > 2) && (prec <= stack[stack.length - 2].prec)) {
                right = stack.pop();
                operator = stack.pop().value;
                left = stack.pop();
                expr = delegate.createBinaryExpression(operator, left, right);
                markers.pop();
                marker = markers.pop();
                if (marker) {
                    marker.apply(expr);
                }
                stack.push(expr);
                markers.push(marker);
            }

            // Shift.
            token = lex();
            token.prec = prec;
            stack.push(token);
            markers.push(createLocationMarker());
            expr = parseUnaryExpression();
            stack.push(expr);
        }

        // Final reduce to clean-up the stack.
        i = stack.length - 1;
        expr = stack[i];
        markers.pop();
        while (i > 1) {
            expr = delegate.createBinaryExpression(stack[i - 1].value, stack[i - 2], expr);
            i -= 2;
            marker = markers.pop();
            if (marker) {
                marker.apply(expr);
            }
        }

        return expr;
    }


    // 11.12 Conditional Operator

    function parseConditionalExpression() {
        var expr, previousAllowIn, consequent, alternate;

        delegate.markStart();
        expr = parseBinaryExpression();

        if (match('?')) {
            lex();
            previousAllowIn = state.allowIn;
            state.allowIn = true;
            consequent = parseAssignmentExpression();
            state.allowIn = previousAllowIn;
            expect(':');
            alternate = parseAssignmentExpression();

            expr = delegate.markEnd(delegate.createConditionalExpression(expr, consequent, alternate));
        } else {
            delegate.markEnd({});
        }

        return expr;
    }

    // 11.13 Assignment Operators

    function parseAssignmentExpression() {
        var token, left, right, node;

        token = lookahead;
        delegate.markStart();
        node = left = parseConditionalExpression();

        if (matchAssign()) {
            // LeftHandSideExpression
            if (!isLeftHandSide(left)) {
                throwErrorTolerant({}, Messages.InvalidLHSInAssignment);
            }

            // 11.13.1
            if (strict && left.type === Syntax.Identifier && isRestrictedWord(left.name)) {
                throwErrorTolerant(token, Messages.StrictLHSAssignment);
            }

            token = lex();
            right = parseAssignmentExpression();
            node = delegate.createAssignmentExpression(token.value, left, right);
        }

        return delegate.markEndIf(node);
    }

    // 11.14 Comma Operator

    function parseExpression() {
        var expr;

        delegate.markStart();
        expr = parseAssignmentExpression();

        if (match(',')) {
            expr = delegate.createSequenceExpression([ expr ]);

            while (index < length) {
                if (!match(',')) {
                    break;
                }
                lex();
                expr.expressions.push(parseAssignmentExpression());
            }
        }

        return delegate.markEndIf(expr);
    }

    // 12.1 Block

    function parseStatementList() {
        var list = [],
            statement;

        while (index < length) {
            if (match('}')) {
                break;
            }
            statement = parseSourceElement();
            if (typeof statement === 'undefined') {
                break;
            }
            list.push(statement);
        }

        return list;
    }

    function parseBlock() {
        var block;

        delegate.markStart();
        expect('{');

        block = parseStatementList();

        expect('}');

        return delegate.markEnd(delegate.createBlockStatement(block));
    }

    // 12.2 Variable Statement

    function parseVariableIdentifier() {
        var token;

        delegate.markStart();
        token = lex();

        if (token.type !== Token.Identifier) {
            throwUnexpected(token);
        }

        return delegate.markEnd(delegate.createIdentifier(token.value));
    }

    function parseVariableDeclaration(kind) {
        var init = null, id;

        delegate.markStart();
        id = parseVariableIdentifier();

        // 12.2.1
        if (strict && isRestrictedWord(id.name)) {
            throwErrorTolerant({}, Messages.StrictVarName);
        }

        if (kind === 'const') {
            expect('=');
            init = parseAssignmentExpression();
        } else if (match('=')) {
            lex();
            init = parseAssignmentExpression();
        }

        return delegate.markEnd(delegate.createVariableDeclarator(id, init));
    }

    function parseVariableDeclarationList(kind) {
        var list = [];

        do {
            list.push(parseVariableDeclaration(kind));
            if (!match(',')) {
                break;
            }
            lex();
        } while (index < length);

        return list;
    }

    function parseVariableStatement() {
        var declarations;

        expectKeyword('var');

        declarations = parseVariableDeclarationList();

        consumeSemicolon();

        return delegate.createVariableDeclaration(declarations, 'var');
    }

    // kind may be `const` or `let`
    // Both are experimental and not in the specification yet.
    // see http://wiki.ecmascript.org/doku.php?id=harmony:const
    // and http://wiki.ecmascript.org/doku.php?id=harmony:let
    function parseConstLetDeclaration(kind) {
        var declarations;

        delegate.markStart();

        expectKeyword(kind);

        declarations = parseVariableDeclarationList(kind);

        consumeSemicolon();

        return delegate.markEnd(delegate.createVariableDeclaration(declarations, kind));
    }

    // 12.3 Empty Statement

    function parseEmptyStatement() {
        expect(';');
        return delegate.createEmptyStatement();
    }

    // 12.4 Expression Statement

    function parseExpressionStatement() {
        var expr = parseExpression();
        consumeSemicolon();
        return delegate.createExpressionStatement(expr);
    }

    // 12.5 If statement

    function parseIfStatement() {
        var test, consequent, alternate;

        expectKeyword('if');

        expect('(');

        test = parseExpression();

        expect(')');

        consequent = parseStatement();

        if (matchKeyword('else')) {
            lex();
            alternate = parseStatement();
        } else {
            alternate = null;
        }

        return delegate.createIfStatement(test, consequent, alternate);
    }

    // 12.6 Iteration Statements

    function parseDoWhileStatement() {
        var body, test, oldInIteration;

        expectKeyword('do');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        if (match(';')) {
            lex();
        }

        return delegate.createDoWhileStatement(body, test);
    }

    function parseWhileStatement() {
        var test, body, oldInIteration;

        expectKeyword('while');

        expect('(');

        test = parseExpression();

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return delegate.createWhileStatement(test, body);
    }

    function parseForVariableDeclaration() {
        var token, declarations;

        delegate.markStart();
        token = lex();
        declarations = parseVariableDeclarationList();

        return delegate.markEnd(delegate.createVariableDeclaration(declarations, token.value));
    }

    function parseForStatement() {
        var init, test, update, left, right, body, oldInIteration;

        init = test = update = null;

        expectKeyword('for');

        expect('(');

        if (match(';')) {
            lex();
        } else {
            if (matchKeyword('var') || matchKeyword('let')) {
                state.allowIn = false;
                init = parseForVariableDeclaration();
                state.allowIn = true;

                if (init.declarations.length === 1 && matchKeyword('in')) {
                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            } else {
                state.allowIn = false;
                init = parseExpression();
                state.allowIn = true;

                if (matchKeyword('in')) {
                    // LeftHandSideExpression
                    if (!isLeftHandSide(init)) {
                        throwErrorTolerant({}, Messages.InvalidLHSInForIn);
                    }

                    lex();
                    left = init;
                    right = parseExpression();
                    init = null;
                }
            }

            if (typeof left === 'undefined') {
                expect(';');
            }
        }

        if (typeof left === 'undefined') {

            if (!match(';')) {
                test = parseExpression();
            }
            expect(';');

            if (!match(')')) {
                update = parseExpression();
            }
        }

        expect(')');

        oldInIteration = state.inIteration;
        state.inIteration = true;

        body = parseStatement();

        state.inIteration = oldInIteration;

        return (typeof left === 'undefined') ?
                delegate.createForStatement(init, test, update, body) :
                delegate.createForInStatement(left, right, body);
    }

    // 12.7 The continue statement

    function parseContinueStatement() {
        var label = null, key;

        expectKeyword('continue');

        // Optimize the most common form: 'continue;'.
        if (source.charCodeAt(index) === 0x3B) {
            lex();

            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return delegate.createContinueStatement(null);
        }

        if (peekLineTerminator()) {
            if (!state.inIteration) {
                throwError({}, Messages.IllegalContinue);
            }

            return delegate.createContinueStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !state.inIteration) {
            throwError({}, Messages.IllegalContinue);
        }

        return delegate.createContinueStatement(label);
    }

    // 12.8 The break statement

    function parseBreakStatement() {
        var label = null, key;

        expectKeyword('break');

        // Catch the very common case first: immediately a semicolon (U+003B).
        if (source.charCodeAt(index) === 0x3B) {
            lex();

            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return delegate.createBreakStatement(null);
        }

        if (peekLineTerminator()) {
            if (!(state.inIteration || state.inSwitch)) {
                throwError({}, Messages.IllegalBreak);
            }

            return delegate.createBreakStatement(null);
        }

        if (lookahead.type === Token.Identifier) {
            label = parseVariableIdentifier();

            key = '$' + label.name;
            if (!Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.UnknownLabel, label.name);
            }
        }

        consumeSemicolon();

        if (label === null && !(state.inIteration || state.inSwitch)) {
            throwError({}, Messages.IllegalBreak);
        }

        return delegate.createBreakStatement(label);
    }

    // 12.9 The return statement

    function parseReturnStatement() {
        var argument = null;

        expectKeyword('return');

        if (!state.inFunctionBody) {
            throwErrorTolerant({}, Messages.IllegalReturn);
        }

        // 'return' followed by a space and an identifier is very common.
        if (source.charCodeAt(index) === 0x20) {
            if (isIdentifierStart(source.charCodeAt(index + 1))) {
                argument = parseExpression();
                consumeSemicolon();
                return delegate.createReturnStatement(argument);
            }
        }

        if (peekLineTerminator()) {
            return delegate.createReturnStatement(null);
        }

        if (!match(';')) {
            if (!match('}') && lookahead.type !== Token.EOF) {
                argument = parseExpression();
            }
        }

        consumeSemicolon();

        return delegate.createReturnStatement(argument);
    }

    // 12.10 The with statement

    function parseWithStatement() {
        var object, body;

        if (strict) {
            throwErrorTolerant({}, Messages.StrictModeWith);
        }

        expectKeyword('with');

        expect('(');

        object = parseExpression();

        expect(')');

        body = parseStatement();

        return delegate.createWithStatement(object, body);
    }

    // 12.10 The swith statement

    function parseSwitchCase() {
        var test,
            consequent = [],
            statement;

        delegate.markStart();
        if (matchKeyword('default')) {
            lex();
            test = null;
        } else {
            expectKeyword('case');
            test = parseExpression();
        }
        expect(':');

        while (index < length) {
            if (match('}') || matchKeyword('default') || matchKeyword('case')) {
                break;
            }
            statement = parseStatement();
            consequent.push(statement);
        }

        return delegate.markEnd(delegate.createSwitchCase(test, consequent));
    }

    function parseSwitchStatement() {
        var discriminant, cases, clause, oldInSwitch, defaultFound;

        expectKeyword('switch');

        expect('(');

        discriminant = parseExpression();

        expect(')');

        expect('{');

        cases = [];

        if (match('}')) {
            lex();
            return delegate.createSwitchStatement(discriminant, cases);
        }

        oldInSwitch = state.inSwitch;
        state.inSwitch = true;
        defaultFound = false;

        while (index < length) {
            if (match('}')) {
                break;
            }
            clause = parseSwitchCase();
            if (clause.test === null) {
                if (defaultFound) {
                    throwError({}, Messages.MultipleDefaultsInSwitch);
                }
                defaultFound = true;
            }
            cases.push(clause);
        }

        state.inSwitch = oldInSwitch;

        expect('}');

        return delegate.createSwitchStatement(discriminant, cases);
    }

    // 12.13 The throw statement

    function parseThrowStatement() {
        var argument;

        expectKeyword('throw');

        if (peekLineTerminator()) {
            throwError({}, Messages.NewlineAfterThrow);
        }

        argument = parseExpression();

        consumeSemicolon();

        return delegate.createThrowStatement(argument);
    }

    // 12.14 The try statement

    function parseCatchClause() {
        var param, body;

        delegate.markStart();
        expectKeyword('catch');

        expect('(');
        if (match(')')) {
            throwUnexpected(lookahead);
        }

        param = parseVariableIdentifier();
        // 12.14.1
        if (strict && isRestrictedWord(param.name)) {
            throwErrorTolerant({}, Messages.StrictCatchVariable);
        }

        expect(')');
        body = parseBlock();
        return delegate.markEnd(delegate.createCatchClause(param, body));
    }

    function parseTryStatement() {
        var block, handlers = [], finalizer = null;

        expectKeyword('try');

        block = parseBlock();

        if (matchKeyword('catch')) {
            handlers.push(parseCatchClause());
        }

        if (matchKeyword('finally')) {
            lex();
            finalizer = parseBlock();
        }

        if (handlers.length === 0 && !finalizer) {
            throwError({}, Messages.NoCatchOrFinally);
        }

        return delegate.createTryStatement(block, [], handlers, finalizer);
    }

    // 12.15 The debugger statement

    function parseDebuggerStatement() {
        expectKeyword('debugger');

        consumeSemicolon();

        return delegate.createDebuggerStatement();
    }

    // 12 Statements

    function parseStatement() {
        var type = lookahead.type,
            expr,
            labeledBody,
            key;

        if (type === Token.EOF) {
            throwUnexpected(lookahead);
        }

        delegate.markStart();

        if (type === Token.Punctuator) {
            switch (lookahead.value) {
            case ';':
                return delegate.markEnd(parseEmptyStatement());
            case '{':
                return delegate.markEnd(parseBlock());
            case '(':
                return delegate.markEnd(parseExpressionStatement());
            default:
                break;
            }
        }

        if (type === Token.Keyword) {
            switch (lookahead.value) {
            case 'break':
                return delegate.markEnd(parseBreakStatement());
            case 'continue':
                return delegate.markEnd(parseContinueStatement());
            case 'debugger':
                return delegate.markEnd(parseDebuggerStatement());
            case 'do':
                return delegate.markEnd(parseDoWhileStatement());
            case 'for':
                return delegate.markEnd(parseForStatement());
            case 'function':
                return delegate.markEnd(parseFunctionDeclaration());
            case 'if':
                return delegate.markEnd(parseIfStatement());
            case 'return':
                return delegate.markEnd(parseReturnStatement());
            case 'switch':
                return delegate.markEnd(parseSwitchStatement());
            case 'throw':
                return delegate.markEnd(parseThrowStatement());
            case 'try':
                return delegate.markEnd(parseTryStatement());
            case 'var':
                return delegate.markEnd(parseVariableStatement());
            case 'while':
                return delegate.markEnd(parseWhileStatement());
            case 'with':
                return delegate.markEnd(parseWithStatement());
            default:
                break;
            }
        }

        expr = parseExpression();

        // 12.12 Labelled Statements
        if ((expr.type === Syntax.Identifier) && match(':')) {
            lex();

            key = '$' + expr.name;
            if (Object.prototype.hasOwnProperty.call(state.labelSet, key)) {
                throwError({}, Messages.Redeclaration, 'Label', expr.name);
            }

            state.labelSet[key] = true;
            labeledBody = parseStatement();
            delete state.labelSet[key];
            return delegate.markEnd(delegate.createLabeledStatement(expr, labeledBody));
        }

        consumeSemicolon();

        return delegate.markEnd(delegate.createExpressionStatement(expr));
    }

    // 13 Function Definition

    function parseFunctionSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted,
            oldLabelSet, oldInIteration, oldInSwitch, oldInFunctionBody;

        delegate.markStart();
        expect('{');

        while (index < length) {
            if (lookahead.type !== Token.StringLiteral) {
                break;
            }
            token = lookahead;

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        oldLabelSet = state.labelSet;
        oldInIteration = state.inIteration;
        oldInSwitch = state.inSwitch;
        oldInFunctionBody = state.inFunctionBody;

        state.labelSet = {};
        state.inIteration = false;
        state.inSwitch = false;
        state.inFunctionBody = true;

        while (index < length) {
            if (match('}')) {
                break;
            }
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }

        expect('}');

        state.labelSet = oldLabelSet;
        state.inIteration = oldInIteration;
        state.inSwitch = oldInSwitch;
        state.inFunctionBody = oldInFunctionBody;

        return delegate.markEnd(delegate.createBlockStatement(sourceElements));
    }

    function parseParams(firstRestricted) {
        var param, params = [], token, stricted, paramSet, key, message;
        expect('(');

        if (!match(')')) {
            paramSet = {};
            while (index < length) {
                token = lookahead;
                param = parseVariableIdentifier();
                key = '$' + token.value;
                if (strict) {
                    if (isRestrictedWord(token.value)) {
                        stricted = token;
                        message = Messages.StrictParamName;
                    }
                    if (Object.prototype.hasOwnProperty.call(paramSet, key)) {
                        stricted = token;
                        message = Messages.StrictParamDupe;
                    }
                } else if (!firstRestricted) {
                    if (isRestrictedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictParamName;
                    } else if (isStrictModeReservedWord(token.value)) {
                        firstRestricted = token;
                        message = Messages.StrictReservedWord;
                    } else if (Object.prototype.hasOwnProperty.call(paramSet, key)) {
                        firstRestricted = token;
                        message = Messages.StrictParamDupe;
                    }
                }
                params.push(param);
                paramSet[key] = true;
                if (match(')')) {
                    break;
                }
                expect(',');
            }
        }

        expect(')');

        return {
            params: params,
            stricted: stricted,
            firstRestricted: firstRestricted,
            message: message
        };
    }

    function parseFunctionDeclaration() {
        var id, params = [], body, token, stricted, tmp, firstRestricted, message, previousStrict;

        delegate.markStart();

        expectKeyword('function');
        token = lookahead;
        id = parseVariableIdentifier();
        if (strict) {
            if (isRestrictedWord(token.value)) {
                throwErrorTolerant(token, Messages.StrictFunctionName);
            }
        } else {
            if (isRestrictedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictFunctionName;
            } else if (isStrictModeReservedWord(token.value)) {
                firstRestricted = token;
                message = Messages.StrictReservedWord;
            }
        }

        tmp = parseParams(firstRestricted);
        params = tmp.params;
        stricted = tmp.stricted;
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return delegate.markEnd(delegate.createFunctionDeclaration(id, params, [], body));
    }

    function parseFunctionExpression() {
        var token, id = null, stricted, firstRestricted, message, tmp, params = [], body, previousStrict;

        delegate.markStart();
        expectKeyword('function');

        if (!match('(')) {
            token = lookahead;
            id = parseVariableIdentifier();
            if (strict) {
                if (isRestrictedWord(token.value)) {
                    throwErrorTolerant(token, Messages.StrictFunctionName);
                }
            } else {
                if (isRestrictedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictFunctionName;
                } else if (isStrictModeReservedWord(token.value)) {
                    firstRestricted = token;
                    message = Messages.StrictReservedWord;
                }
            }
        }

        tmp = parseParams(firstRestricted);
        params = tmp.params;
        stricted = tmp.stricted;
        firstRestricted = tmp.firstRestricted;
        if (tmp.message) {
            message = tmp.message;
        }

        previousStrict = strict;
        body = parseFunctionSourceElements();
        if (strict && firstRestricted) {
            throwError(firstRestricted, message);
        }
        if (strict && stricted) {
            throwErrorTolerant(stricted, message);
        }
        strict = previousStrict;

        return delegate.markEnd(delegate.createFunctionExpression(id, params, [], body));
    }

    // 14 Program

    function parseSourceElement() {
        if (lookahead.type === Token.Keyword) {
            switch (lookahead.value) {
            case 'const':
            case 'let':
                return parseConstLetDeclaration(lookahead.value);
            case 'function':
                return parseFunctionDeclaration();
            default:
                return parseStatement();
            }
        }

        if (lookahead.type !== Token.EOF) {
            return parseStatement();
        }
    }

    function parseSourceElements() {
        var sourceElement, sourceElements = [], token, directive, firstRestricted;

        while (index < length) {
            token = lookahead;
            if (token.type !== Token.StringLiteral) {
                break;
            }

            sourceElement = parseSourceElement();
            sourceElements.push(sourceElement);
            if (sourceElement.expression.type !== Syntax.Literal) {
                // this is not directive
                break;
            }
            directive = source.slice(token.range[0] + 1, token.range[1] - 1);
            if (directive === 'use strict') {
                strict = true;
                if (firstRestricted) {
                    throwErrorTolerant(firstRestricted, Messages.StrictOctalLiteral);
                }
            } else {
                if (!firstRestricted && token.octal) {
                    firstRestricted = token;
                }
            }
        }

        while (index < length) {
            sourceElement = parseSourceElement();
            if (typeof sourceElement === 'undefined') {
                break;
            }
            sourceElements.push(sourceElement);
        }
        return sourceElements;
    }

    function parseProgram() {
        var body;

        delegate.markStart();
        strict = false;
        peek();
        body = parseSourceElements();
        return delegate.markEnd(delegate.createProgram(body));
    }

    function attachComments() {
        var i, attacher, comment, leading, trailing;

        for (i = 0; i < extra.pendingComments.length; ++i) {
            attacher = extra.pendingComments[i];
            comment = attacher.comment;
            leading = attacher.leading;
            if (leading) {
                if (typeof leading.leadingComments === 'undefined') {
                    leading.leadingComments = [];
                }
                leading.leadingComments.push(attacher.comment);
            }
            trailing = attacher.trailing;
            if (trailing) {
                if (typeof trailing.trailingComments === 'undefined') {
                    trailing.trailingComments = [];
                }
                trailing.trailingComments.push(attacher.comment);
            }
        }
        extra.pendingComments = [];
    }

    function filterTokenLocation() {
        var i, entry, token, tokens = [];

        for (i = 0; i < extra.tokens.length; ++i) {
            entry = extra.tokens[i];
            token = {
                type: entry.type,
                value: entry.value
            };
            if (extra.range) {
                token.range = entry.range;
            }
            if (extra.loc) {
                token.loc = entry.loc;
            }
            tokens.push(token);
        }

        extra.tokens = tokens;
    }

    function LocationMarker() {
        this.startIndex = index;
        this.startLine = lineNumber;
        this.startColumn = index - lineStart;
    }

    LocationMarker.prototype = {
        constructor: LocationMarker,

        apply: function (node) {
            if (extra.range) {
                node.range = [this.startIndex, index];
            }
            if (extra.loc) {
                node.loc = {
                    start: {
                        line: this.startLine,
                        column: this.startColumn
                    },
                    end: {
                        line: lineNumber,
                        column: index - lineStart
                    }
                };
                node = delegate.postProcess(node);
            }
            if (extra.attachComment) {
                delegate.processComment(node);
            }
        }
    };

    function createLocationMarker() {
        if (!extra.loc && !extra.range) {
            return null;
        }

        skipComment();

        return new LocationMarker();
    }

    function tokenize(code, options) {
        var toString,
            token,
            tokens;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        delegate = SyntaxTreeDelegate;
        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowIn: true,
            labelSet: {},
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false,
            lastCommentStart: -1
        };

        extra = {};

        // Options matching.
        options = options || {};

        // Of course we collect tokens here.
        options.tokens = true;
        extra.tokens = [];
        extra.tokenize = true;
        // The following two fields are necessary to compute the Regex tokens.
        extra.openParenToken = -1;
        extra.openCurlyToken = -1;

        extra.range = (typeof options.range === 'boolean') && options.range;
        extra.loc = (typeof options.loc === 'boolean') && options.loc;

        if (typeof options.comment === 'boolean' && options.comment) {
            extra.comments = [];
        }
        if (typeof options.tolerant === 'boolean' && options.tolerant) {
            extra.errors = [];
        }

        if (length > 0) {
            if (typeof source[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source = code.valueOf();
                }
            }
        }

        try {
            peek();
            if (lookahead.type === Token.EOF) {
                return extra.tokens;
            }

            token = lex();
            while (lookahead.type !== Token.EOF) {
                try {
                    token = lex();
                } catch (lexError) {
                    token = lookahead;
                    if (extra.errors) {
                        extra.errors.push(lexError);
                        // We have to break on the first error
                        // to avoid infinite loops.
                        break;
                    } else {
                        throw lexError;
                    }
                }
            }

            filterTokenLocation();
            tokens = extra.tokens;
            if (typeof extra.comments !== 'undefined') {
                tokens.comments = extra.comments;
            }
            if (typeof extra.errors !== 'undefined') {
                tokens.errors = extra.errors;
            }
        } catch (e) {
            throw e;
        } finally {
            extra = {};
        }
        return tokens;
    }

    function parse(code, options) {
        var program, toString;

        toString = String;
        if (typeof code !== 'string' && !(code instanceof String)) {
            code = toString(code);
        }

        delegate = SyntaxTreeDelegate;
        source = code;
        index = 0;
        lineNumber = (source.length > 0) ? 1 : 0;
        lineStart = 0;
        length = source.length;
        lookahead = null;
        state = {
            allowIn: true,
            labelSet: {},
            inFunctionBody: false,
            inIteration: false,
            inSwitch: false,
            lastCommentStart: -1,
            markerStack: []
        };

        extra = {};
        if (typeof options !== 'undefined') {
            extra.range = (typeof options.range === 'boolean') && options.range;
            extra.loc = (typeof options.loc === 'boolean') && options.loc;
            extra.attachComment = (typeof options.attachComment === 'boolean') && options.attachComment;

            if (extra.loc && options.source !== null && options.source !== undefined) {
                extra.source = toString(options.source);
            }

            if (typeof options.tokens === 'boolean' && options.tokens) {
                extra.tokens = [];
            }
            if (typeof options.comment === 'boolean' && options.comment) {
                extra.comments = [];
            }
            if (typeof options.tolerant === 'boolean' && options.tolerant) {
                extra.errors = [];
            }
            if (extra.attachComment) {
                extra.range = true;
                extra.pendingComments = [];
                extra.comments = [];
            }
        }

        if (length > 0) {
            if (typeof source[0] === 'undefined') {
                // Try first to convert to a string. This is good as fast path
                // for old IE which understands string indexing for string
                // literals only and not for string object.
                if (code instanceof String) {
                    source = code.valueOf();
                }
            }
        }

        try {
            program = parseProgram();
            if (typeof extra.comments !== 'undefined') {
                program.comments = extra.comments;
            }
            if (typeof extra.tokens !== 'undefined') {
                filterTokenLocation();
                program.tokens = extra.tokens;
            }
            if (typeof extra.errors !== 'undefined') {
                program.errors = extra.errors;
            }
            if (extra.attachComment) {
                attachComments();
            }
        } catch (e) {
            throw e;
        } finally {
            extra = {};
        }

        return program;
    }

    // Sync with *.json manifests.
    exports.version = '1.1.1';

    exports.tokenize = tokenize;

    exports.parse = parse;

    // Deep copy.
    exports.Syntax = (function () {
        var name, types = {};

        if (typeof Object.create === 'function') {
            types = Object.create(null);
        }

        for (name in Syntax) {
            if (Syntax.hasOwnProperty(name)) {
                types[name] = Syntax[name];
            }
        }

        if (typeof Object.freeze === 'function') {
            Object.freeze(types);
        }

        return types;
    }());

}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],16:[function(require,module,exports){
/*
  Copyright (C) 2012-2013 Yusuke Suzuki <utatane.tea@gmail.com>
  Copyright (C) 2012 Ariya Hidayat <ariya.hidayat@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*jslint vars:false, bitwise:true*/
/*jshint indent:4*/
/*global exports:true, define:true*/
(function (root, factory) {
    'use strict';

    // Universal Module Definition (UMD) to support AMD, CommonJS/Node.js,
    // and plain browser loading,
    if (typeof define === 'function' && define.amd) {
        define(['exports'], factory);
    } else if (typeof exports !== 'undefined') {
        factory(exports);
    } else {
        factory((root.estraverse = {}));
    }
}(this, function (exports) {
    'use strict';

    var Syntax,
        isArray,
        VisitorOption,
        VisitorKeys,
        BREAK,
        SKIP;

    Syntax = {
        AssignmentExpression: 'AssignmentExpression',
        ArrayExpression: 'ArrayExpression',
        ArrayPattern: 'ArrayPattern',
        ArrowFunctionExpression: 'ArrowFunctionExpression',
        BlockStatement: 'BlockStatement',
        BinaryExpression: 'BinaryExpression',
        BreakStatement: 'BreakStatement',
        CallExpression: 'CallExpression',
        CatchClause: 'CatchClause',
        ClassBody: 'ClassBody',
        ClassDeclaration: 'ClassDeclaration',
        ClassExpression: 'ClassExpression',
        ConditionalExpression: 'ConditionalExpression',
        ContinueStatement: 'ContinueStatement',
        DebuggerStatement: 'DebuggerStatement',
        DirectiveStatement: 'DirectiveStatement',
        DoWhileStatement: 'DoWhileStatement',
        EmptyStatement: 'EmptyStatement',
        ExpressionStatement: 'ExpressionStatement',
        ForStatement: 'ForStatement',
        ForInStatement: 'ForInStatement',
        FunctionDeclaration: 'FunctionDeclaration',
        FunctionExpression: 'FunctionExpression',
        Identifier: 'Identifier',
        IfStatement: 'IfStatement',
        Literal: 'Literal',
        LabeledStatement: 'LabeledStatement',
        LogicalExpression: 'LogicalExpression',
        MemberExpression: 'MemberExpression',
        MethodDefinition: 'MethodDefinition',
        NewExpression: 'NewExpression',
        ObjectExpression: 'ObjectExpression',
        ObjectPattern: 'ObjectPattern',
        Program: 'Program',
        Property: 'Property',
        ReturnStatement: 'ReturnStatement',
        SequenceExpression: 'SequenceExpression',
        SwitchStatement: 'SwitchStatement',
        SwitchCase: 'SwitchCase',
        ThisExpression: 'ThisExpression',
        ThrowStatement: 'ThrowStatement',
        TryStatement: 'TryStatement',
        UnaryExpression: 'UnaryExpression',
        UpdateExpression: 'UpdateExpression',
        VariableDeclaration: 'VariableDeclaration',
        VariableDeclarator: 'VariableDeclarator',
        WhileStatement: 'WhileStatement',
        WithStatement: 'WithStatement',
        YieldExpression: 'YieldExpression'
    };

    function ignoreJSHintError() { }

    isArray = Array.isArray;
    if (!isArray) {
        isArray = function isArray(array) {
            return Object.prototype.toString.call(array) === '[object Array]';
        };
    }

    function deepCopy(obj) {
        var ret = {}, key, val;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                val = obj[key];
                if (typeof val === 'object' && val !== null) {
                    ret[key] = deepCopy(val);
                } else {
                    ret[key] = val;
                }
            }
        }
        return ret;
    }

    function shallowCopy(obj) {
        var ret = {}, key;
        for (key in obj) {
            if (obj.hasOwnProperty(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    ignoreJSHintError(shallowCopy);

    // based on LLVM libc++ upper_bound / lower_bound
    // MIT License

    function upperBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                len = diff;
            } else {
                i = current + 1;
                len -= diff + 1;
            }
        }
        return i;
    }

    function lowerBound(array, func) {
        var diff, len, i, current;

        len = array.length;
        i = 0;

        while (len) {
            diff = len >>> 1;
            current = i + diff;
            if (func(array[current])) {
                i = current + 1;
                len -= diff + 1;
            } else {
                len = diff;
            }
        }
        return i;
    }
    ignoreJSHintError(lowerBound);

    VisitorKeys = {
        AssignmentExpression: ['left', 'right'],
        ArrayExpression: ['elements'],
        ArrayPattern: ['elements'],
        ArrowFunctionExpression: ['params', 'defaults', 'rest', 'body'],
        BlockStatement: ['body'],
        BinaryExpression: ['left', 'right'],
        BreakStatement: ['label'],
        CallExpression: ['callee', 'arguments'],
        CatchClause: ['param', 'body'],
        ClassBody: ['body'],
        ClassDeclaration: ['id', 'body', 'superClass'],
        ClassExpression: ['id', 'body', 'superClass'],
        ConditionalExpression: ['test', 'consequent', 'alternate'],
        ContinueStatement: ['label'],
        DebuggerStatement: [],
        DirectiveStatement: [],
        DoWhileStatement: ['body', 'test'],
        EmptyStatement: [],
        ExpressionStatement: ['expression'],
        ForStatement: ['init', 'test', 'update', 'body'],
        ForInStatement: ['left', 'right', 'body'],
        ForOfStatement: ['left', 'right', 'body'],
        FunctionDeclaration: ['id', 'params', 'defaults', 'rest', 'body'],
        FunctionExpression: ['id', 'params', 'defaults', 'rest', 'body'],
        Identifier: [],
        IfStatement: ['test', 'consequent', 'alternate'],
        Literal: [],
        LabeledStatement: ['label', 'body'],
        LogicalExpression: ['left', 'right'],
        MemberExpression: ['object', 'property'],
        MethodDefinition: ['key', 'value'],
        NewExpression: ['callee', 'arguments'],
        ObjectExpression: ['properties'],
        ObjectPattern: ['properties'],
        Program: ['body'],
        Property: ['key', 'value'],
        ReturnStatement: ['argument'],
        SequenceExpression: ['expressions'],
        SwitchStatement: ['discriminant', 'cases'],
        SwitchCase: ['test', 'consequent'],
        ThisExpression: [],
        ThrowStatement: ['argument'],
        TryStatement: ['block', 'handlers', 'handler', 'guardedHandlers', 'finalizer'],
        UnaryExpression: ['argument'],
        UpdateExpression: ['argument'],
        VariableDeclaration: ['declarations'],
        VariableDeclarator: ['id', 'init'],
        WhileStatement: ['test', 'body'],
        WithStatement: ['object', 'body'],
        YieldExpression: ['argument']
    };

    // unique id
    BREAK = {};
    SKIP = {};

    VisitorOption = {
        Break: BREAK,
        Skip: SKIP
    };

    function Reference(parent, key) {
        this.parent = parent;
        this.key = key;
    }

    Reference.prototype.replace = function replace(node) {
        this.parent[this.key] = node;
    };

    function Element(node, path, wrap, ref) {
        this.node = node;
        this.path = path;
        this.wrap = wrap;
        this.ref = ref;
    }

    function Controller() { }

    // API:
    // return property path array from root to current node
    Controller.prototype.path = function path() {
        var i, iz, j, jz, result, element;

        function addToPath(result, path) {
            if (isArray(path)) {
                for (j = 0, jz = path.length; j < jz; ++j) {
                    result.push(path[j]);
                }
            } else {
                result.push(path);
            }
        }

        // root node
        if (!this.__current.path) {
            return null;
        }

        // first node is sentinel, second node is root element
        result = [];
        for (i = 2, iz = this.__leavelist.length; i < iz; ++i) {
            element = this.__leavelist[i];
            addToPath(result, element.path);
        }
        addToPath(result, this.__current.path);
        return result;
    };

    // API:
    // return array of parent elements
    Controller.prototype.parents = function parents() {
        var i, iz, result;

        // first node is sentinel
        result = [];
        for (i = 1, iz = this.__leavelist.length; i < iz; ++i) {
            result.push(this.__leavelist[i].node);
        }

        return result;
    };

    // API:
    // return current node
    Controller.prototype.current = function current() {
        return this.__current.node;
    };

    Controller.prototype.__execute = function __execute(callback, element) {
        var previous, result;

        result = undefined;

        previous  = this.__current;
        this.__current = element;
        this.__state = null;
        if (callback) {
            result = callback.call(this, element.node, this.__leavelist[this.__leavelist.length - 1].node);
        }
        this.__current = previous;

        return result;
    };

    // API:
    // notify control skip / break
    Controller.prototype.notify = function notify(flag) {
        this.__state = flag;
    };

    // API:
    // skip child nodes of current node
    Controller.prototype.skip = function () {
        this.notify(SKIP);
    };

    // API:
    // break traversals
    Controller.prototype['break'] = function () {
        this.notify(BREAK);
    };

    Controller.prototype.__initialize = function(root, visitor) {
        this.visitor = visitor;
        this.root = root;
        this.__worklist = [];
        this.__leavelist = [];
        this.__current = null;
        this.__state = null;
    };

    Controller.prototype.traverse = function traverse(root, visitor) {
        var worklist,
            leavelist,
            element,
            node,
            nodeType,
            ret,
            key,
            current,
            current2,
            candidates,
            candidate,
            sentinel;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        worklist.push(new Element(root, null, null, null));
        leavelist.push(new Element(null, null, null, null));

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                ret = this.__execute(visitor.leave, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }
                continue;
            }

            if (element.node) {

                ret = this.__execute(visitor.enter, element);

                if (this.__state === BREAK || ret === BREAK) {
                    return;
                }

                worklist.push(sentinel);
                leavelist.push(element);

                if (this.__state === SKIP || ret === SKIP) {
                    continue;
                }

                node = element.node;
                nodeType = element.wrap || node.type;
                candidates = VisitorKeys[nodeType];

                current = candidates.length;
                while ((current -= 1) >= 0) {
                    key = candidates[current];
                    candidate = node[key];
                    if (!candidate) {
                        continue;
                    }

                    if (!isArray(candidate)) {
                        worklist.push(new Element(candidate, key, null, null));
                        continue;
                    }

                    current2 = candidate.length;
                    while ((current2 -= 1) >= 0) {
                        if (!candidate[current2]) {
                            continue;
                        }
                        if ((nodeType === Syntax.ObjectExpression || nodeType === Syntax.ObjectPattern) && 'properties' === candidates[current]) {
                            element = new Element(candidate[current2], [key, current2], 'Property', null);
                        } else {
                            element = new Element(candidate[current2], [key, current2], null, null);
                        }
                        worklist.push(element);
                    }
                }
            }
        }
    };

    Controller.prototype.replace = function replace(root, visitor) {
        var worklist,
            leavelist,
            node,
            nodeType,
            target,
            element,
            current,
            current2,
            candidates,
            candidate,
            sentinel,
            outer,
            key;

        this.__initialize(root, visitor);

        sentinel = {};

        // reference
        worklist = this.__worklist;
        leavelist = this.__leavelist;

        // initialize
        outer = {
            root: root
        };
        element = new Element(root, null, null, new Reference(outer, 'root'));
        worklist.push(element);
        leavelist.push(element);

        while (worklist.length) {
            element = worklist.pop();

            if (element === sentinel) {
                element = leavelist.pop();

                target = this.__execute(visitor.leave, element);

                // node may be replaced with null,
                // so distinguish between undefined and null in this place
                if (target !== undefined && target !== BREAK && target !== SKIP) {
                    // replace
                    element.ref.replace(target);
                }

                if (this.__state === BREAK || target === BREAK) {
                    return outer.root;
                }
                continue;
            }

            target = this.__execute(visitor.enter, element);

            // node may be replaced with null,
            // so distinguish between undefined and null in this place
            if (target !== undefined && target !== BREAK && target !== SKIP) {
                // replace
                element.ref.replace(target);
                element.node = target;
            }

            if (this.__state === BREAK || target === BREAK) {
                return outer.root;
            }

            // node may be null
            node = element.node;
            if (!node) {
                continue;
            }

            worklist.push(sentinel);
            leavelist.push(element);

            if (this.__state === SKIP || target === SKIP) {
                continue;
            }

            nodeType = element.wrap || node.type;
            candidates = VisitorKeys[nodeType];

            current = candidates.length;
            while ((current -= 1) >= 0) {
                key = candidates[current];
                candidate = node[key];
                if (!candidate) {
                    continue;
                }

                if (!isArray(candidate)) {
                    worklist.push(new Element(candidate, key, null, new Reference(node, key)));
                    continue;
                }

                current2 = candidate.length;
                while ((current2 -= 1) >= 0) {
                    if (!candidate[current2]) {
                        continue;
                    }
                    if (nodeType === Syntax.ObjectExpression && 'properties' === candidates[current]) {
                        element = new Element(candidate[current2], [key, current2], 'Property', new Reference(candidate, current2));
                    } else {
                        element = new Element(candidate[current2], [key, current2], null, new Reference(candidate, current2));
                    }
                    worklist.push(element);
                }
            }
        }

        return outer.root;
    };

    function traverse(root, visitor) {
        var controller = new Controller();
        return controller.traverse(root, visitor);
    }

    function replace(root, visitor) {
        var controller = new Controller();
        return controller.replace(root, visitor);
    }

    function extendCommentRange(comment, tokens) {
        var target;

        target = upperBound(tokens, function search(token) {
            return token.range[0] > comment.range[0];
        });

        comment.extendedRange = [comment.range[0], comment.range[1]];

        if (target !== tokens.length) {
            comment.extendedRange[1] = tokens[target].range[0];
        }

        target -= 1;
        if (target >= 0) {
            comment.extendedRange[0] = tokens[target].range[1];
        }

        return comment;
    }

    function attachComments(tree, providedComments, tokens) {
        // At first, we should calculate extended comment ranges.
        var comments = [], comment, len, i, cursor;

        if (!tree.range) {
            throw new Error('attachComments needs range information');
        }

        // tokens array is empty, we attach comments to tree as 'leadingComments'
        if (!tokens.length) {
            if (providedComments.length) {
                for (i = 0, len = providedComments.length; i < len; i += 1) {
                    comment = deepCopy(providedComments[i]);
                    comment.extendedRange = [0, tree.range[0]];
                    comments.push(comment);
                }
                tree.leadingComments = comments;
            }
            return tree;
        }

        for (i = 0, len = providedComments.length; i < len; i += 1) {
            comments.push(extendCommentRange(deepCopy(providedComments[i]), tokens));
        }

        // This is based on John Freeman's implementation.
        cursor = 0;
        traverse(tree, {
            enter: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (comment.extendedRange[1] > node.range[0]) {
                        break;
                    }

                    if (comment.extendedRange[1] === node.range[0]) {
                        if (!node.leadingComments) {
                            node.leadingComments = [];
                        }
                        node.leadingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        cursor = 0;
        traverse(tree, {
            leave: function (node) {
                var comment;

                while (cursor < comments.length) {
                    comment = comments[cursor];
                    if (node.range[1] < comment.extendedRange[0]) {
                        break;
                    }

                    if (node.range[1] === comment.extendedRange[0]) {
                        if (!node.trailingComments) {
                            node.trailingComments = [];
                        }
                        node.trailingComments.push(comment);
                        comments.splice(cursor, 1);
                    } else {
                        cursor += 1;
                    }
                }

                // already out of owned node
                if (cursor === comments.length) {
                    return VisitorOption.Break;
                }

                if (comments[cursor].extendedRange[0] > node.range[1]) {
                    return VisitorOption.Skip;
                }
            }
        });

        return tree;
    }

    exports.version = '1.5.1-dev';
    exports.Syntax = Syntax;
    exports.traverse = traverse;
    exports.replace = replace;
    exports.attachComments = attachComments;
    exports.VisitorKeys = VisitorKeys;
    exports.VisitorOption = VisitorOption;
    exports.Controller = Controller;
}));
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],17:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var Regex;

    // See also tools/generate-unicode-regex.py.
    Regex = {
        NonAsciiIdentifierStart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0370-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E\u066F\u0671-\u06D3\u06D5\u06E5\u06E6\u06EE\u06EF\u06FA-\u06FC\u06FF\u0710\u0712-\u072F\u074D-\u07A5\u07B1\u07CA-\u07EA\u07F4\u07F5\u07FA\u0800-\u0815\u081A\u0824\u0828\u0840-\u0858\u08A0\u08A2-\u08AC\u0904-\u0939\u093D\u0950\u0958-\u0961\u0971-\u0977\u0979-\u097F\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BD\u09CE\u09DC\u09DD\u09DF-\u09E1\u09F0\u09F1\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A59-\u0A5C\u0A5E\u0A72-\u0A74\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABD\u0AD0\u0AE0\u0AE1\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3D\u0B5C\u0B5D\u0B5F-\u0B61\u0B71\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BD0\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D\u0C58\u0C59\u0C60\u0C61\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBD\u0CDE\u0CE0\u0CE1\u0CF1\u0CF2\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D\u0D4E\u0D60\u0D61\u0D7A-\u0D7F\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0E01-\u0E30\u0E32\u0E33\u0E40-\u0E46\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB0\u0EB2\u0EB3\u0EBD\u0EC0-\u0EC4\u0EC6\u0EDC-\u0EDF\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C\u1000-\u102A\u103F\u1050-\u1055\u105A-\u105D\u1061\u1065\u1066\u106E-\u1070\u1075-\u1081\u108E\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176C\u176E-\u1770\u1780-\u17B3\u17D7\u17DC\u1820-\u1877\u1880-\u18A8\u18AA\u18B0-\u18F5\u1900-\u191C\u1950-\u196D\u1970-\u1974\u1980-\u19AB\u19C1-\u19C7\u1A00-\u1A16\u1A20-\u1A54\u1AA7\u1B05-\u1B33\u1B45-\u1B4B\u1B83-\u1BA0\u1BAE\u1BAF\u1BBA-\u1BE5\u1C00-\u1C23\u1C4D-\u1C4F\u1C5A-\u1C7D\u1CE9-\u1CEC\u1CEE-\u1CF1\u1CF5\u1CF6\u1D00-\u1DBF\u1E00-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u2071\u207F\u2090-\u209C\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CEE\u2CF2\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D80-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2E2F\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303C\u3041-\u3096\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA61F\uA62A\uA62B\uA640-\uA66E\uA67F-\uA697\uA6A0-\uA6EF\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA801\uA803-\uA805\uA807-\uA80A\uA80C-\uA822\uA840-\uA873\uA882-\uA8B3\uA8F2-\uA8F7\uA8FB\uA90A-\uA925\uA930-\uA946\uA960-\uA97C\uA984-\uA9B2\uA9CF\uAA00-\uAA28\uAA40-\uAA42\uAA44-\uAA4B\uAA60-\uAA76\uAA7A\uAA80-\uAAAF\uAAB1\uAAB5\uAAB6\uAAB9-\uAABD\uAAC0\uAAC2\uAADB-\uAADD\uAAE0-\uAAEA\uAAF2-\uAAF4\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABE2\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D\uFB1F-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE70-\uFE74\uFE76-\uFEFC\uFF21-\uFF3A\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]'),
        NonAsciiIdentifierPart: new RegExp('[\xAA\xB5\xBA\xC0-\xD6\xD8-\xF6\xF8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE\u0300-\u0374\u0376\u0377\u037A-\u037D\u0386\u0388-\u038A\u038C\u038E-\u03A1\u03A3-\u03F5\u03F7-\u0481\u0483-\u0487\u048A-\u0527\u0531-\u0556\u0559\u0561-\u0587\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u05D0-\u05EA\u05F0-\u05F2\u0610-\u061A\u0620-\u0669\u066E-\u06D3\u06D5-\u06DC\u06DF-\u06E8\u06EA-\u06FC\u06FF\u0710-\u074A\u074D-\u07B1\u07C0-\u07F5\u07FA\u0800-\u082D\u0840-\u085B\u08A0\u08A2-\u08AC\u08E4-\u08FE\u0900-\u0963\u0966-\u096F\u0971-\u0977\u0979-\u097F\u0981-\u0983\u0985-\u098C\u098F\u0990\u0993-\u09A8\u09AA-\u09B0\u09B2\u09B6-\u09B9\u09BC-\u09C4\u09C7\u09C8\u09CB-\u09CE\u09D7\u09DC\u09DD\u09DF-\u09E3\u09E6-\u09F1\u0A01-\u0A03\u0A05-\u0A0A\u0A0F\u0A10\u0A13-\u0A28\u0A2A-\u0A30\u0A32\u0A33\u0A35\u0A36\u0A38\u0A39\u0A3C\u0A3E-\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A59-\u0A5C\u0A5E\u0A66-\u0A75\u0A81-\u0A83\u0A85-\u0A8D\u0A8F-\u0A91\u0A93-\u0AA8\u0AAA-\u0AB0\u0AB2\u0AB3\u0AB5-\u0AB9\u0ABC-\u0AC5\u0AC7-\u0AC9\u0ACB-\u0ACD\u0AD0\u0AE0-\u0AE3\u0AE6-\u0AEF\u0B01-\u0B03\u0B05-\u0B0C\u0B0F\u0B10\u0B13-\u0B28\u0B2A-\u0B30\u0B32\u0B33\u0B35-\u0B39\u0B3C-\u0B44\u0B47\u0B48\u0B4B-\u0B4D\u0B56\u0B57\u0B5C\u0B5D\u0B5F-\u0B63\u0B66-\u0B6F\u0B71\u0B82\u0B83\u0B85-\u0B8A\u0B8E-\u0B90\u0B92-\u0B95\u0B99\u0B9A\u0B9C\u0B9E\u0B9F\u0BA3\u0BA4\u0BA8-\u0BAA\u0BAE-\u0BB9\u0BBE-\u0BC2\u0BC6-\u0BC8\u0BCA-\u0BCD\u0BD0\u0BD7\u0BE6-\u0BEF\u0C01-\u0C03\u0C05-\u0C0C\u0C0E-\u0C10\u0C12-\u0C28\u0C2A-\u0C33\u0C35-\u0C39\u0C3D-\u0C44\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C58\u0C59\u0C60-\u0C63\u0C66-\u0C6F\u0C82\u0C83\u0C85-\u0C8C\u0C8E-\u0C90\u0C92-\u0CA8\u0CAA-\u0CB3\u0CB5-\u0CB9\u0CBC-\u0CC4\u0CC6-\u0CC8\u0CCA-\u0CCD\u0CD5\u0CD6\u0CDE\u0CE0-\u0CE3\u0CE6-\u0CEF\u0CF1\u0CF2\u0D02\u0D03\u0D05-\u0D0C\u0D0E-\u0D10\u0D12-\u0D3A\u0D3D-\u0D44\u0D46-\u0D48\u0D4A-\u0D4E\u0D57\u0D60-\u0D63\u0D66-\u0D6F\u0D7A-\u0D7F\u0D82\u0D83\u0D85-\u0D96\u0D9A-\u0DB1\u0DB3-\u0DBB\u0DBD\u0DC0-\u0DC6\u0DCA\u0DCF-\u0DD4\u0DD6\u0DD8-\u0DDF\u0DF2\u0DF3\u0E01-\u0E3A\u0E40-\u0E4E\u0E50-\u0E59\u0E81\u0E82\u0E84\u0E87\u0E88\u0E8A\u0E8D\u0E94-\u0E97\u0E99-\u0E9F\u0EA1-\u0EA3\u0EA5\u0EA7\u0EAA\u0EAB\u0EAD-\u0EB9\u0EBB-\u0EBD\u0EC0-\u0EC4\u0EC6\u0EC8-\u0ECD\u0ED0-\u0ED9\u0EDC-\u0EDF\u0F00\u0F18\u0F19\u0F20-\u0F29\u0F35\u0F37\u0F39\u0F3E-\u0F47\u0F49-\u0F6C\u0F71-\u0F84\u0F86-\u0F97\u0F99-\u0FBC\u0FC6\u1000-\u1049\u1050-\u109D\u10A0-\u10C5\u10C7\u10CD\u10D0-\u10FA\u10FC-\u1248\u124A-\u124D\u1250-\u1256\u1258\u125A-\u125D\u1260-\u1288\u128A-\u128D\u1290-\u12B0\u12B2-\u12B5\u12B8-\u12BE\u12C0\u12C2-\u12C5\u12C8-\u12D6\u12D8-\u1310\u1312-\u1315\u1318-\u135A\u135D-\u135F\u1380-\u138F\u13A0-\u13F4\u1401-\u166C\u166F-\u167F\u1681-\u169A\u16A0-\u16EA\u16EE-\u16F0\u1700-\u170C\u170E-\u1714\u1720-\u1734\u1740-\u1753\u1760-\u176C\u176E-\u1770\u1772\u1773\u1780-\u17D3\u17D7\u17DC\u17DD\u17E0-\u17E9\u180B-\u180D\u1810-\u1819\u1820-\u1877\u1880-\u18AA\u18B0-\u18F5\u1900-\u191C\u1920-\u192B\u1930-\u193B\u1946-\u196D\u1970-\u1974\u1980-\u19AB\u19B0-\u19C9\u19D0-\u19D9\u1A00-\u1A1B\u1A20-\u1A5E\u1A60-\u1A7C\u1A7F-\u1A89\u1A90-\u1A99\u1AA7\u1B00-\u1B4B\u1B50-\u1B59\u1B6B-\u1B73\u1B80-\u1BF3\u1C00-\u1C37\u1C40-\u1C49\u1C4D-\u1C7D\u1CD0-\u1CD2\u1CD4-\u1CF6\u1D00-\u1DE6\u1DFC-\u1F15\u1F18-\u1F1D\u1F20-\u1F45\u1F48-\u1F4D\u1F50-\u1F57\u1F59\u1F5B\u1F5D\u1F5F-\u1F7D\u1F80-\u1FB4\u1FB6-\u1FBC\u1FBE\u1FC2-\u1FC4\u1FC6-\u1FCC\u1FD0-\u1FD3\u1FD6-\u1FDB\u1FE0-\u1FEC\u1FF2-\u1FF4\u1FF6-\u1FFC\u200C\u200D\u203F\u2040\u2054\u2071\u207F\u2090-\u209C\u20D0-\u20DC\u20E1\u20E5-\u20F0\u2102\u2107\u210A-\u2113\u2115\u2119-\u211D\u2124\u2126\u2128\u212A-\u212D\u212F-\u2139\u213C-\u213F\u2145-\u2149\u214E\u2160-\u2188\u2C00-\u2C2E\u2C30-\u2C5E\u2C60-\u2CE4\u2CEB-\u2CF3\u2D00-\u2D25\u2D27\u2D2D\u2D30-\u2D67\u2D6F\u2D7F-\u2D96\u2DA0-\u2DA6\u2DA8-\u2DAE\u2DB0-\u2DB6\u2DB8-\u2DBE\u2DC0-\u2DC6\u2DC8-\u2DCE\u2DD0-\u2DD6\u2DD8-\u2DDE\u2DE0-\u2DFF\u2E2F\u3005-\u3007\u3021-\u302F\u3031-\u3035\u3038-\u303C\u3041-\u3096\u3099\u309A\u309D-\u309F\u30A1-\u30FA\u30FC-\u30FF\u3105-\u312D\u3131-\u318E\u31A0-\u31BA\u31F0-\u31FF\u3400-\u4DB5\u4E00-\u9FCC\uA000-\uA48C\uA4D0-\uA4FD\uA500-\uA60C\uA610-\uA62B\uA640-\uA66F\uA674-\uA67D\uA67F-\uA697\uA69F-\uA6F1\uA717-\uA71F\uA722-\uA788\uA78B-\uA78E\uA790-\uA793\uA7A0-\uA7AA\uA7F8-\uA827\uA840-\uA873\uA880-\uA8C4\uA8D0-\uA8D9\uA8E0-\uA8F7\uA8FB\uA900-\uA92D\uA930-\uA953\uA960-\uA97C\uA980-\uA9C0\uA9CF-\uA9D9\uAA00-\uAA36\uAA40-\uAA4D\uAA50-\uAA59\uAA60-\uAA76\uAA7A\uAA7B\uAA80-\uAAC2\uAADB-\uAADD\uAAE0-\uAAEF\uAAF2-\uAAF6\uAB01-\uAB06\uAB09-\uAB0E\uAB11-\uAB16\uAB20-\uAB26\uAB28-\uAB2E\uABC0-\uABEA\uABEC\uABED\uABF0-\uABF9\uAC00-\uD7A3\uD7B0-\uD7C6\uD7CB-\uD7FB\uF900-\uFA6D\uFA70-\uFAD9\uFB00-\uFB06\uFB13-\uFB17\uFB1D-\uFB28\uFB2A-\uFB36\uFB38-\uFB3C\uFB3E\uFB40\uFB41\uFB43\uFB44\uFB46-\uFBB1\uFBD3-\uFD3D\uFD50-\uFD8F\uFD92-\uFDC7\uFDF0-\uFDFB\uFE00-\uFE0F\uFE20-\uFE26\uFE33\uFE34\uFE4D-\uFE4F\uFE70-\uFE74\uFE76-\uFEFC\uFF10-\uFF19\uFF21-\uFF3A\uFF3F\uFF41-\uFF5A\uFF66-\uFFBE\uFFC2-\uFFC7\uFFCA-\uFFCF\uFFD2-\uFFD7\uFFDA-\uFFDC]')
    };

    function isDecimalDigit(ch) {
        return (ch >= 48 && ch <= 57);   // 0..9
    }

    function isHexDigit(ch) {
        return isDecimalDigit(ch) || (97 <= ch && ch <= 102) || (65 <= ch && ch <= 70);
    }

    function isOctalDigit(ch) {
        return (ch >= 48 && ch <= 55);   // 0..7
    }

    // 7.2 White Space

    function isWhiteSpace(ch) {
        return (ch === 0x20) || (ch === 0x09) || (ch === 0x0B) || (ch === 0x0C) || (ch === 0xA0) ||
            (ch >= 0x1680 && [0x1680, 0x180E, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000, 0xFEFF].indexOf(ch) >= 0);
    }

    // 7.3 Line Terminators

    function isLineTerminator(ch) {
        return (ch === 0x0A) || (ch === 0x0D) || (ch === 0x2028) || (ch === 0x2029);
    }

    // 7.6 Identifier Names and Identifiers

    function isIdentifierStart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierStart.test(String.fromCharCode(ch)));
    }

    function isIdentifierPart(ch) {
        return (ch === 36) || (ch === 95) ||  // $ (dollar) and _ (underscore)
            (ch >= 65 && ch <= 90) ||         // A..Z
            (ch >= 97 && ch <= 122) ||        // a..z
            (ch >= 48 && ch <= 57) ||         // 0..9
            (ch === 92) ||                    // \ (backslash)
            ((ch >= 0x80) && Regex.NonAsciiIdentifierPart.test(String.fromCharCode(ch)));
    }

    module.exports = {
        isDecimalDigit: isDecimalDigit,
        isHexDigit: isHexDigit,
        isOctalDigit: isOctalDigit,
        isWhiteSpace: isWhiteSpace,
        isLineTerminator: isLineTerminator,
        isIdentifierStart: isIdentifierStart,
        isIdentifierPart: isIdentifierPart
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{}],18:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

(function () {
    'use strict';

    var code = require('./code');

    function isStrictModeReservedWordES6(id) {
        switch (id) {
        case 'implements':
        case 'interface':
        case 'package':
        case 'private':
        case 'protected':
        case 'public':
        case 'static':
        case 'let':
            return true;
        default:
            return false;
        }
    }

    function isKeywordES5(id, strict) {
        // yield should not be treated as keyword under non-strict mode.
        if (!strict && id === 'yield') {
            return false;
        }
        return isKeywordES6(id, strict);
    }

    function isKeywordES6(id, strict) {
        if (strict && isStrictModeReservedWordES6(id)) {
            return true;
        }

        switch (id.length) {
        case 2:
            return (id === 'if') || (id === 'in') || (id === 'do');
        case 3:
            return (id === 'var') || (id === 'for') || (id === 'new') || (id === 'try');
        case 4:
            return (id === 'this') || (id === 'else') || (id === 'case') ||
                (id === 'void') || (id === 'with') || (id === 'enum');
        case 5:
            return (id === 'while') || (id === 'break') || (id === 'catch') ||
                (id === 'throw') || (id === 'const') || (id === 'yield') ||
                (id === 'class') || (id === 'super');
        case 6:
            return (id === 'return') || (id === 'typeof') || (id === 'delete') ||
                (id === 'switch') || (id === 'export') || (id === 'import');
        case 7:
            return (id === 'default') || (id === 'finally') || (id === 'extends');
        case 8:
            return (id === 'function') || (id === 'continue') || (id === 'debugger');
        case 10:
            return (id === 'instanceof');
        default:
            return false;
        }
    }

    function isRestrictedWord(id) {
        return id === 'eval' || id === 'arguments';
    }

    function isIdentifierName(id) {
        var i, iz, ch;

        if (id.length === 0) {
            return false;
        }

        ch = id.charCodeAt(0);
        if (!code.isIdentifierStart(ch) || ch === 92) {  // \ (backslash)
            return false;
        }

        for (i = 1, iz = id.length; i < iz; ++i) {
            ch = id.charCodeAt(i);
            if (!code.isIdentifierPart(ch) || ch === 92) {  // \ (backslash)
                return false;
            }
        }
        return true;
    }

    module.exports = {
        isKeywordES5: isKeywordES5,
        isKeywordES6: isKeywordES6,
        isRestrictedWord: isRestrictedWord,
        isIdentifierName: isIdentifierName
    };
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":17}],19:[function(require,module,exports){
/*
  Copyright (C) 2013 Yusuke Suzuki <utatane.tea@gmail.com>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


(function () {
    'use strict';

    exports.code = require('./code');
    exports.keyword = require('./keyword');
}());
/* vim: set sw=4 ts=4 et tw=80 : */

},{"./code":17,"./keyword":18}],20:[function(require,module,exports){
function parse(str, settings) {
    var _settings = {
        leadingChar: '#',
        compact: false
    };

    config(_settings, settings);

    var lines = split(str);
    check(lines, _settings);
    return build(lines, _settings);
}

function config(_settings, settings) {
    var key, val;
    if (!settings)
        return;

    for (key in _settings) {
        val = settings[key];
        if (val) _settings[key] = val;
    }
}

function split(str) {
    var lines = str.split(/[\r\n]+/);

    return lines.filter(function(line) {
        return line.trim() != '';
    });
}

function check(str, _settings) {
    checkRoot(str, _settings);
}

function escapeRegExp(string) {
    return string.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
}

function checkRoot(lines, _settings) {
    var c = escapeRegExp(_settings.leadingChar),
        firstTwoPattern = new RegExp('^' + c + '[^' + c + ']'),
        pattern = new RegExp('^' + c + '[^' + c + '].*$'),
        roots = lines.filter(function(line) {
            return pattern.test(line);
        });

    if (roots.length > 1)
        throw new Error('Only single root node is allowed!');


    if (!firstTwoPattern.test(lines[0]))
        throw new Error('The root node should be the first node!');
}

function parseLine(line, _settings) {
    var c = escapeRegExp(_settings.leadingChar),
        pattern = new RegExp('^(' + c + '+)' + '(.+)$'),
        matches = line.match(pattern),
        node = Object.create(null);

    node.level = matches[1].length - 1;
    node.value = matches[2];
    return node;
}

function build(lines, _settings) {
    var i,
        node,
        root = Object.create(null),
        stack = [],
        len = lines.length;

    for (i = 0; i < len; ++i) {
        node = parseLine(lines[i], _settings);

        if (stack.length == 0) {
            root = node;
            stack.unshift(root);
            continue;
        }

        while (stack[0].level >= node.level)
            stack.shift();

        if (!stack[0].nodes)
            stack[0].nodes = [];

        stack[0].nodes.push(node);
        stack.unshift(node);
    }

    if (_settings.compact)
        return compress(root);

    return root;
}

function compress(root) {
    var compressed = Object.create(null);
    if (root.nodes) {
        compressed[root.value] = [];
        for (var i = 0, len = root.nodes.length; i < len; ++i)
            compressed[root.value].push(compress(root.nodes[i]));
    } else
        compressed[root.value] = null;

    return compressed;
}

exports.parse = parse;
},{}],21:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],22:[function(require,module,exports){
(function (process){
'use strict';
var boolifyString = require('boolify-string');
module.exports = function () {
  return process.env.hasOwnProperty('TRAVIS') &&
    boolifyString(process.env.TRAVIS) &&
    process.env.hasOwnProperty('CI') &&
    boolifyString(process.env.CI);
};

}).call(this,require('_process'))
},{"_process":33,"boolify-string":6}],23:[function(require,module,exports){
module.exports={
  "_args": [
    [
      {
        "raw": "jison-lex@0.3.x",
        "scope": null,
        "escapedName": "jison-lex",
        "name": "jison-lex",
        "rawSpec": "0.3.x",
        "spec": ">=0.3.0 <0.4.0",
        "type": "range"
      },
      "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm/node_modules/jison"
    ]
  ],
  "_from": "jison-lex@>=0.3.0 <0.4.0",
  "_id": "jison-lex@0.3.4",
  "_inCache": true,
  "_location": "/jison-lex",
  "_npmUser": {
    "name": "zaach",
    "email": "zack.carter@gmail.com"
  },
  "_npmVersion": "1.4.3",
  "_phantomChildren": {},
  "_requested": {
    "raw": "jison-lex@0.3.x",
    "scope": null,
    "escapedName": "jison-lex",
    "name": "jison-lex",
    "rawSpec": "0.3.x",
    "spec": ">=0.3.0 <0.4.0",
    "type": "range"
  },
  "_requiredBy": [
    "/jison"
  ],
  "_resolved": "https://registry.npmjs.org/jison-lex/-/jison-lex-0.3.4.tgz",
  "_shasum": "81ca28d84f84499dfa8c594dcde3d8a3f26ec7a5",
  "_shrinkwrap": null,
  "_spec": "jison-lex@0.3.x",
  "_where": "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm/node_modules/jison",
  "author": {
    "name": "Zach Carter",
    "email": "zach@carter.name",
    "url": "http://zaa.ch"
  },
  "bin": {
    "jison-lex": "cli.js"
  },
  "bugs": {
    "url": "http://github.com/zaach/jison-lex/issues",
    "email": "jison@librelist.com"
  },
  "dependencies": {
    "lex-parser": "0.1.x",
    "nomnom": "1.5.2"
  },
  "description": "lexical analyzer generator used by jison",
  "devDependencies": {
    "test": "0.4.4"
  },
  "directories": {
    "lib": "lib",
    "tests": "tests"
  },
  "dist": {
    "shasum": "81ca28d84f84499dfa8c594dcde3d8a3f26ec7a5",
    "tarball": "https://registry.npmjs.org/jison-lex/-/jison-lex-0.3.4.tgz"
  },
  "engines": {
    "node": ">=0.4"
  },
  "homepage": "http://jison.org",
  "keywords": [
    "jison",
    "parser",
    "generator",
    "lexer",
    "flex",
    "tokenizer"
  ],
  "main": "regexp-lexer",
  "maintainers": [
    {
      "name": "zaach",
      "email": "zack.carter@gmail.com"
    }
  ],
  "name": "jison-lex",
  "optionalDependencies": {},
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git://github.com/zaach/jison-lex.git"
  },
  "scripts": {
    "test": "node tests/all-tests.js"
  },
  "version": "0.3.4"
}

},{}],24:[function(require,module,exports){
// Basic Lexer implemented using JavaScript regular expressions
// MIT Licensed

"use strict";

var lexParser = require('lex-parser');
var version = require('./package.json').version;

// expand macros and convert matchers to RegExp's
function prepareRules(rules, macros, actions, tokens, startConditions, caseless) {
    var m,i,k,action,conditions,
        newRules = [];

    if (macros) {
        macros = prepareMacros(macros);
    }

    function tokenNumberReplacement (str, token) {
        return "return " + (tokens[token] || "'" + token + "'");
    }

    actions.push('switch($avoiding_name_collisions) {');

    for (i=0;i < rules.length; i++) {
        if (Object.prototype.toString.apply(rules[i][0]) !== '[object Array]') {
            // implicit add to all inclusive start conditions
            for (k in startConditions) {
                if (startConditions[k].inclusive) {
                    startConditions[k].rules.push(i);
                }
            }
        } else if (rules[i][0][0] === '*') {
            // Add to ALL start conditions
            for (k in startConditions) {
                startConditions[k].rules.push(i);
            }
            rules[i].shift();
        } else {
            // Add to explicit start conditions
            conditions = rules[i].shift();
            for (k=0;k<conditions.length;k++) {
                startConditions[conditions[k]].rules.push(i);
            }
        }

        m = rules[i][0];
        if (typeof m === 'string') {
            for (k in macros) {
                if (macros.hasOwnProperty(k)) {
                    m = m.split("{" + k + "}").join('(' + macros[k] + ')');
                }
            }
            m = new RegExp("^(?:" + m + ")", caseless ? 'i':'');
        }
        newRules.push(m);
        if (typeof rules[i][1] === 'function') {
            rules[i][1] = String(rules[i][1]).replace(/^\s*function \(\)\s?\{/, '').replace(/\}\s*$/, '');
        }
        action = rules[i][1];
        if (tokens && action.match(/return '[^']+'/)) {
            action = action.replace(/return '([^']+)'/g, tokenNumberReplacement);
        }
        actions.push('case ' + i + ':' + action + '\nbreak;');
    }
    actions.push("}");

    return newRules;
}

// expand macros within macros
function prepareMacros (macros) {
    var cont = true,
        m,i,k,mnew;
    while (cont) {
        cont = false;
        for (i in macros) if (macros.hasOwnProperty(i)) {
            m = macros[i];
            for (k in macros) if (macros.hasOwnProperty(k) && i !== k) {
                mnew = m.split("{" + k + "}").join('(' + macros[k] + ')');
                if (mnew !== m) {
                    cont = true;
                    macros[i] = mnew;
                }
            }
        }
    }
    return macros;
}

function prepareStartConditions (conditions) {
    var sc,
        hash = {};
    for (sc in conditions) if (conditions.hasOwnProperty(sc)) {
        hash[sc] = {rules:[],inclusive:!!!conditions[sc]};
    }
    return hash;
}

function buildActions (dict, tokens) {
    var actions = [dict.actionInclude || '', "var YYSTATE=YY_START;"];
    var tok;
    var toks = {};

    for (tok in tokens) {
        toks[tokens[tok]] = tok;
    }

    if (dict.options && dict.options.flex) {
        dict.rules.push([".", "console.log(yytext);"]);
    }

    this.rules = prepareRules(dict.rules, dict.macros, actions, tokens && toks, this.conditions, this.options["case-insensitive"]);
    var fun = actions.join("\n");
    "yytext yyleng yylineno yylloc".split(' ').forEach(function (yy) {
        fun = fun.replace(new RegExp("\\b(" + yy + ")\\b", "g"), "yy_.$1");
    });

    return "function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {" + fun + "\n}";
}

function RegExpLexer (dict, input, tokens) {
    var opts = processGrammar(dict, tokens);
    var source = generateModuleBody(opts);
    var lexer = eval(source);

    lexer.yy = {};
    if (input) {
        lexer.setInput(input);
    }

    lexer.generate = function () { return generateFromOpts(opts); };
    lexer.generateModule = function () { return generateModule(opts); };
    lexer.generateCommonJSModule = function () { return generateCommonJSModule(opts); };
    lexer.generateAMDModule = function () { return generateAMDModule(opts); };

    return lexer;
}

RegExpLexer.prototype = {
    EOF: 1,
    parseError: function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

    // resets the lexer, sets new input
    setInput: function (input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

    // consumes and returns one char from the input
    input: function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

    // unshifts one char (or a string) into the input
    unput: function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

    // When called from action, caches matched text and appends it on next action
    more: function () {
        this._more = true;
        return this;
    },

    // When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
    reject: function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

    // retain first n characters of the match
    less: function (n) {
        this.unput(this.match.slice(n));
    },

    // displays already matched input, i.e. for error messages
    pastInput: function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

    // displays upcoming input, i.e. for error messages
    upcomingInput: function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

    // displays the character position where the lexing error occurred, i.e. for error messages
    showPosition: function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

    // test the lexed token: return FALSE when not a match, otherwise return token
    test_match: function(match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

    // return next match in input
    next: function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

    // return next match that has a token
    lex: function lex () {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

    // activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
    begin: function begin (condition) {
        this.conditionStack.push(condition);
    },

    // pop the previously active lexer condition state off the condition stack
    popState: function popState () {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

    // produce the lexer rule set which is active for the currently active lexer condition state
    _currentRules: function _currentRules () {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

    // return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
    topState: function topState (n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

    // alias for begin(condition)
    pushState: function pushState (condition) {
        this.begin(condition);
    },

    // return the number of states pushed
    stateStackSize: function stateStackSize() {
        return this.conditionStack.length;
    }
};


// generate lexer source from a grammar
function generate (dict, tokens) {
    var opt = processGrammar(dict, tokens);

    return generateFromOpts(opt);
}

// process the grammar and build final data structures and functions
function processGrammar(dict, tokens) {
    var opts = {};
    if (typeof dict === 'string') {
        dict = lexParser.parse(dict);
    }
    dict = dict || {};

    opts.options = dict.options || {};
    opts.moduleType = opts.options.moduleType;
    opts.moduleName = opts.options.moduleName;

    opts.conditions = prepareStartConditions(dict.startConditions);
    opts.conditions.INITIAL = {rules:[],inclusive:true};

    opts.performAction = buildActions.call(opts, dict, tokens);
    opts.conditionStack = ['INITIAL'];

    opts.moduleInclude = (dict.moduleInclude || '').trim();
    return opts;
}

// Assemble the final source from the processed grammar
function generateFromOpts (opt) {
    var code = "";

    if (opt.moduleType === 'commonjs') {
        code = generateCommonJSModule(opt);
    } else if (opt.moduleType === 'amd') {
        code = generateAMDModule(opt);
    } else {
        code = generateModule(opt);
    }

    return code;
}

function generateModuleBody (opt) {
    var functionDescriptions = {
        setInput: "resets the lexer, sets new input",
        input: "consumes and returns one char from the input",
        unput: "unshifts one char (or a string) into the input",
        more: "When called from action, caches matched text and appends it on next action",
        reject: "When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.",
        less: "retain first n characters of the match",
        pastInput: "displays already matched input, i.e. for error messages",
        upcomingInput: "displays upcoming input, i.e. for error messages",
        showPosition: "displays the character position where the lexing error occurred, i.e. for error messages",
        test_match: "test the lexed token: return FALSE when not a match, otherwise return token",
        next: "return next match in input",
        lex: "return next match that has a token",
        begin: "activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)",
        popState: "pop the previously active lexer condition state off the condition stack",
        _currentRules: "produce the lexer rule set which is active for the currently active lexer condition state",
        topState: "return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available",
        pushState: "alias for begin(condition)",
        stateStackSize: "return the number of states currently on the stack"
    };
    var out = "({\n";
    var p = [];
    var descr;
    for (var k in RegExpLexer.prototype) {
        if (RegExpLexer.prototype.hasOwnProperty(k) && k.indexOf("generate") === -1) {
            // copy the function description as a comment before the implementation; supports multi-line descriptions
            descr = "\n";
            if (functionDescriptions[k]) {
                descr += "// " + functionDescriptions[k].replace(/\n/g, "\n\/\/ ") + "\n";
            }
            p.push(descr + k + ":" + (RegExpLexer.prototype[k].toString() || '""'));
        }
    }
    out += p.join(",\n");

    if (opt.options) {
        out += ",\noptions: " + JSON.stringify(opt.options);
    }

    out += ",\nperformAction: " + String(opt.performAction);
    out += ",\nrules: [" + opt.rules + "]";
    out += ",\nconditions: " + JSON.stringify(opt.conditions);
    out += "\n})";

    return out;
}

function generateModule(opt) {
    opt = opt || {};

    var out = "/* generated by jison-lex " + version + " */";
    var moduleName = opt.moduleName || "lexer";

    out += "\nvar " + moduleName + " = (function(){\nvar lexer = "
          + generateModuleBody(opt);

    if (opt.moduleInclude) {
        out += ";\n" + opt.moduleInclude;
    }

    out += ";\nreturn lexer;\n})();";

    return out;
}

function generateAMDModule(opt) {
    var out = "/* generated by jison-lex " + version + " */";

    out += "define([], function(){\nvar lexer = "
          + generateModuleBody(opt);

    if (opt.moduleInclude) {
        out += ";\n" + opt.moduleInclude;
    }

    out += ";\nreturn lexer;"
         + "\n});";

    return out;
}

function generateCommonJSModule(opt) {
    opt = opt || {};

    var out = "";
    var moduleName = opt.moduleName || "lexer";

    out += generateModule(opt);
    out += "\nexports.lexer = " + moduleName;
    out += ";\nexports.lex = function () { return " + moduleName + ".lex.apply(lexer, arguments); };";
    return out;
}

RegExpLexer.generate = generate;

module.exports = RegExpLexer;


},{"./package.json":23,"lex-parser":29}],25:[function(require,module,exports){
(function (process){
// Jison, an LR(0), SLR(1), LARL(1), LR(1) Parser Generator
// Zachary Carter <zach@carter.name>
// MIT X Licensed

var typal      = require('./util/typal').typal;
var Set        = require('./util/set').Set;
var Lexer      = require('jison-lex');
var ebnfParser = require('ebnf-parser');
var JSONSelect = require('JSONSelect');
var esprima    = require('esprima');
var escodegen  = require('escodegen');


var version = require('../package.json').version;

var Jison = exports.Jison = exports;
Jison.version = version;

// detect print
if (typeof console !== 'undefined' && console.log) {
    Jison.print = console.log;
} else if (typeof puts !== 'undefined') {
    Jison.print = function print () { puts([].join.call(arguments, ' ')); };
} else if (typeof print !== 'undefined') {
    Jison.print = print;
} else {
    Jison.print = function print () {};
}

Jison.Parser = (function () {

// iterator utility
function each (obj, func) {
    if (obj.forEach) {
        obj.forEach(func);
    } else {
        var p;
        for (p in obj) {
            if (obj.hasOwnProperty(p)) {
                func.call(obj, obj[p], p, obj);
            }
        }
    }
}

var Nonterminal = typal.construct({
    constructor: function Nonterminal (symbol) {
        this.symbol = symbol;
        this.productions = new Set();
        this.first = [];
        this.follows = [];
        this.nullable = false;
    },
    toString: function Nonterminal_toString () {
        var str = this.symbol+"\n";
        str += (this.nullable ? 'nullable' : 'not nullable');
        str += "\nFirsts: "+this.first.join(', ');
        str += "\nFollows: "+this.first.join(', ');
        str += "\nProductions:\n  "+this.productions.join('\n  ');

        return str;
    }
});

var Production = typal.construct({
    constructor: function Production (symbol, handle, id) {
        this.symbol = symbol;
        this.handle = handle;
        this.nullable = false;
        this.id = id;
        this.first = [];
        this.precedence = 0;
    },
    toString: function Production_toString () {
        return this.symbol+" -> "+this.handle.join(' ');
    }
});

var generator = typal.beget();

generator.constructor = function Jison_Generator (grammar, opt) {
    if (typeof grammar === 'string') {
        grammar = ebnfParser.parse(grammar);
    }

    var options = typal.mix.call({}, grammar.options, opt);
    this.terms = {};
    this.operators = {};
    this.productions = [];
    this.conflicts = 0;
    this.resolutions = [];
    this.options = options;
    this.parseParams = grammar.parseParams;
    this.yy = {}; // accessed as yy free variable in the parser/lexer actions

    // source included in semantic action execution scope
    if (grammar.actionInclude) {
        if (typeof grammar.actionInclude === 'function') {
            grammar.actionInclude = String(grammar.actionInclude).replace(/^\s*function \(\) \{/, '').replace(/\}\s*$/, '');
        }
        this.actionInclude = grammar.actionInclude;
    }
    this.moduleInclude = grammar.moduleInclude || '';

    this.DEBUG = options.debug || false;
    if (this.DEBUG) this.mix(generatorDebug); // mixin debug methods

    this.processGrammar(grammar);

    if (grammar.lex) {
        this.lexer = new Lexer(grammar.lex, null, this.terminals_);
    }
};

generator.processGrammar = function processGrammarDef (grammar) {
    var bnf = grammar.bnf,
        tokens = grammar.tokens,
        nonterminals = this.nonterminals = {},
        productions = this.productions,
        self = this;

    if (!grammar.bnf && grammar.ebnf) {
        bnf = grammar.bnf = ebnfParser.transform(grammar.ebnf);
    }

    if (tokens) {
        if (typeof tokens === 'string') {
            tokens = tokens.trim().split(' ');
        } else {
            tokens = tokens.slice(0);
        }
    }

    var symbols = this.symbols = [];

    // calculate precedence of operators
    var operators = this.operators = processOperators(grammar.operators);

    // build productions from cfg
    this.buildProductions(bnf, productions, nonterminals, symbols, operators);

    if (tokens && this.terminals.length !== tokens.length) {
        self.trace("Warning: declared tokens differ from tokens found in rules.");
        self.trace(this.terminals);
        self.trace(tokens);
    }

    // augment the grammar
    this.augmentGrammar(grammar);
};

generator.augmentGrammar = function augmentGrammar (grammar) {
    if (this.productions.length === 0) {
        throw new Error("Grammar error: must have at least one rule.");
    }
    // use specified start symbol, or default to first user defined production
    this.startSymbol = grammar.start || grammar.startSymbol || this.productions[0].symbol;
    if (!this.nonterminals[this.startSymbol]) {
        throw new Error("Grammar error: startSymbol must be a non-terminal found in your grammar.");
    }
    this.EOF = "$end";

    // augment the grammar
    var acceptProduction = new Production('$accept', [this.startSymbol, '$end'], 0);
    this.productions.unshift(acceptProduction);

    // prepend parser tokens
    this.symbols.unshift("$accept",this.EOF);
    this.symbols_.$accept = 0;
    this.symbols_[this.EOF] = 1;
    this.terminals.unshift(this.EOF);

    this.nonterminals.$accept = new Nonterminal("$accept");
    this.nonterminals.$accept.productions.push(acceptProduction);

    // add follow $ to start symbol
    this.nonterminals[this.startSymbol].follows.push(this.EOF);
};

// set precedence and associativity of operators
function processOperators (ops) {
    if (!ops) return {};
    var operators = {};
    for (var i=0,k,prec;prec=ops[i]; i++) {
        for (k=1;k < prec.length;k++) {
            operators[prec[k]] = {precedence: i+1, assoc: prec[0]};
        }
    }
    return operators;
}


generator.buildProductions = function buildProductions(bnf, productions, nonterminals, symbols, operators) {
    var actions = [
      '/* this == yyval */',
      this.actionInclude || '',
      'var $0 = $$.length - 1;',
      'switch (yystate) {'
    ];
    var actionGroups = {};
    var prods, symbol;
    var productions_ = [0];
    var symbolId = 1;
    var symbols_ = {};

    var her = false; // has error recovery

    function addSymbol (s) {
        if (s && !symbols_[s]) {
            symbols_[s] = ++symbolId;
            symbols.push(s);
        }
    }

    // add error symbol; will be third symbol, or "2" ($accept, $end, error)
    addSymbol("error");

    for (symbol in bnf) {
        if (!bnf.hasOwnProperty(symbol)) continue;

        addSymbol(symbol);
        nonterminals[symbol] = new Nonterminal(symbol);

        if (typeof bnf[symbol] === 'string') {
            prods = bnf[symbol].split(/\s*\|\s*/g);
        } else {
            prods = bnf[symbol].slice(0);
        }

        prods.forEach(buildProduction);
    }
    for (var action in actionGroups)
      actions.push(actionGroups[action].join(' '), action, 'break;');

    var sym, terms = [], terms_ = {};
    each(symbols_, function (id, sym) {
        if (!nonterminals[sym]) {
            terms.push(sym);
            terms_[id] = sym;
        }
    });

    this.hasErrorRecovery = her;

    this.terminals = terms;
    this.terminals_ = terms_;
    this.symbols_ = symbols_;

    this.productions_ = productions_;
    actions.push('}');

    actions = actions.join("\n")
                .replace(/YYABORT/g, 'return false')
                .replace(/YYACCEPT/g, 'return true');

    var parameters = "yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */";
    if (this.parseParams) parameters += ', ' + this.parseParams.join(', ');

    this.performAction = "function anonymous(" + parameters + ") {\n" + actions + "\n}";

    function buildProduction (handle) {
        var r, rhs, i;
        if (handle.constructor === Array) {
            rhs = (typeof handle[0] === 'string') ?
                      handle[0].trim().split(' ') :
                      handle[0].slice(0);

            for (i=0; i<rhs.length; i++) {
                if (rhs[i] === 'error') her = true;
                if (!symbols_[rhs[i]]) {
                    addSymbol(rhs[i]);
                }
            }

            if (typeof handle[1] === 'string' || handle.length == 3) {
                // semantic action specified
                var label = 'case ' + (productions.length+1) + ':', action = handle[1];

                // replace named semantic values ($nonterminal)
                if (action.match(/[$@][a-zA-Z][a-zA-Z0-9_]*/)) {
                    var count = {},
                        names = {};
                    for (i=0;i<rhs.length;i++) {
                        // check for aliased names, e.g., id[alias]
                        var rhs_i = rhs[i].match(/\[[a-zA-Z][a-zA-Z0-9_-]*\]/);
                        if (rhs_i) {
                            rhs_i = rhs_i[0].substr(1, rhs_i[0].length-2);
                            rhs[i] = rhs[i].substr(0, rhs[i].indexOf('['));
                        } else {
                            rhs_i = rhs[i];
                        }

                        if (names[rhs_i]) {
                            names[rhs_i + (++count[rhs_i])] = i+1;
                        } else {
                            names[rhs_i] = i+1;
                            names[rhs_i + "1"] = i+1;
                            count[rhs_i] = 1;
                        }
                    }
                    action = action.replace(/\$([a-zA-Z][a-zA-Z0-9_]*)/g, function (str, pl) {
                            return names[pl] ? '$'+names[pl] : str;
                        }).replace(/@([a-zA-Z][a-zA-Z0-9_]*)/g, function (str, pl) {
                            return names[pl] ? '@'+names[pl] : str;
                        });
                }
                action = action
                    // replace references to $$ with this.$, and @$ with this._$
                    .replace(/([^'"])\$\$|^\$\$/g, '$1this.$').replace(/@[0$]/g, "this._$")

                    // replace semantic value references ($n) with stack value (stack[n])
                    .replace(/\$(-?\d+)/g, function (_, n) {
                        return "$$[$0" + (parseInt(n, 10) - rhs.length || '') + "]";
                    })
                    // same as above for location references (@n)
                    .replace(/@(-?\d+)/g, function (_, n) {
                        return "_$[$0" + (n - rhs.length || '') + "]";
                    });
                if (action in actionGroups) actionGroups[action].push(label);
                else actionGroups[action] = [label];

                // done with aliases; strip them.
                rhs = rhs.map(function(e,i) { return e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '') });
                r = new Production(symbol, rhs, productions.length+1);
                // precedence specified also
                if (handle[2] && operators[handle[2].prec]) {
                    r.precedence = operators[handle[2].prec].precedence;
                }
            } else {
                // no action -> don't care about aliases; strip them.
                rhs = rhs.map(function(e,i) { return e.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '') });
                // only precedence specified
                r = new Production(symbol, rhs, productions.length+1);
                if (operators[handle[1].prec]) {
                    r.precedence = operators[handle[1].prec].precedence;
                }
            }
        } else {
            // no action -> don't care about aliases; strip them.
            handle = handle.replace(/\[[a-zA-Z_][a-zA-Z0-9_-]*\]/g, '');
            rhs = handle.trim().split(' ');
            for (i=0; i<rhs.length; i++) {
                if (rhs[i] === 'error') her = true;
                if (!symbols_[rhs[i]]) {
                    addSymbol(rhs[i]);
                }
            }
            r = new Production(symbol, rhs, productions.length+1);
        }
        if (r.precedence === 0) {
            // set precedence
            for (i=r.handle.length-1; i>=0; i--) {
                if (!(r.handle[i] in nonterminals) && r.handle[i] in operators) {
                    r.precedence = operators[r.handle[i]].precedence;
                }
            }
        }

        productions.push(r);
        productions_.push([symbols_[r.symbol], r.handle[0] === '' ? 0 : r.handle.length]);
        nonterminals[symbol].productions.push(r);
    }
};



generator.createParser = function createParser () {
    throw new Error('Calling abstract method.');
};

// noop. implemented in debug mixin
generator.trace = function trace () { };

generator.warn = function warn () {
    var args = Array.prototype.slice.call(arguments,0);
    Jison.print.call(null,args.join(""));
};

generator.error = function error (msg) {
    throw new Error(msg);
};

// Generator debug mixin

var generatorDebug = {
    trace: function trace () {
        Jison.print.apply(null, arguments);
    },
    beforeprocessGrammar: function () {
        this.trace("Processing grammar.");
    },
    afteraugmentGrammar: function () {
        var trace = this.trace;
        each(this.symbols, function (sym, i) {
            trace(sym+"("+i+")");
        });
    }
};



/*
 * Mixin for common behaviors of lookahead parsers
 * */
var lookaheadMixin = {};

lookaheadMixin.computeLookaheads = function computeLookaheads () {
    if (this.DEBUG) this.mix(lookaheadDebug); // mixin debug methods

    this.computeLookaheads = function () {};
    this.nullableSets();
    this.firstSets();
    this.followSets();
};

// calculate follow sets typald on first and nullable
lookaheadMixin.followSets = function followSets () {
    var productions = this.productions,
        nonterminals = this.nonterminals,
        self = this,
        cont = true;

    // loop until no further changes have been made
    while(cont) {
        cont = false;

        productions.forEach(function Follow_prod_forEach (production, k) {
            //self.trace(production.symbol,nonterminals[production.symbol].follows);
            // q is used in Simple LALR algorithm determine follows in context
            var q;
            var ctx = !!self.go_;

            var set = [],oldcount;
            for (var i=0,t;t=production.handle[i];++i) {
                if (!nonterminals[t]) continue;

                // for Simple LALR algorithm, self.go_ checks if
                if (ctx)
                    q = self.go_(production.symbol, production.handle.slice(0, i));
                var bool = !ctx || q === parseInt(self.nterms_[t], 10);

                if (i === production.handle.length+1 && bool) {
                    set = nonterminals[production.symbol].follows;
                } else {
                    var part = production.handle.slice(i+1);

                    set = self.first(part);
                    if (self.nullable(part) && bool) {
                        set.push.apply(set, nonterminals[production.symbol].follows);
                    }
                }
                oldcount = nonterminals[t].follows.length;
                Set.union(nonterminals[t].follows, set);
                if (oldcount !== nonterminals[t].follows.length) {
                    cont = true;
                }
            }
        });
    }
};

// return the FIRST set of a symbol or series of symbols
lookaheadMixin.first = function first (symbol) {
    // epsilon
    if (symbol === '') {
        return [];
    // RHS
    } else if (symbol instanceof Array) {
        var firsts = [];
        for (var i=0,t;t=symbol[i];++i) {
            if (!this.nonterminals[t]) {
                if (firsts.indexOf(t) === -1)
                    firsts.push(t);
            } else {
                Set.union(firsts, this.nonterminals[t].first);
            }
            if (!this.nullable(t))
                break;
        }
        return firsts;
    // terminal
    } else if (!this.nonterminals[symbol]) {
        return [symbol];
    // nonterminal
    } else {
        return this.nonterminals[symbol].first;
    }
};

// fixed-point calculation of FIRST sets
lookaheadMixin.firstSets = function firstSets () {
    var productions = this.productions,
        nonterminals = this.nonterminals,
        self = this,
        cont = true,
        symbol,firsts;

    // loop until no further changes have been made
    while(cont) {
        cont = false;

        productions.forEach(function FirstSets_forEach (production, k) {
            var firsts = self.first(production.handle);
            if (firsts.length !== production.first.length) {
                production.first = firsts;
                cont=true;
            }
        });

        for (symbol in nonterminals) {
            firsts = [];
            nonterminals[symbol].productions.forEach(function (production) {
                Set.union(firsts, production.first);
            });
            if (firsts.length !== nonterminals[symbol].first.length) {
                nonterminals[symbol].first = firsts;
                cont=true;
            }
        }
    }
};

// fixed-point calculation of NULLABLE
lookaheadMixin.nullableSets = function nullableSets () {
    var firsts = this.firsts = {},
        nonterminals = this.nonterminals,
        self = this,
        cont = true;

    // loop until no further changes have been made
    while(cont) {
        cont = false;

        // check if each production is nullable
        this.productions.forEach(function (production, k) {
            if (!production.nullable) {
                for (var i=0,n=0,t;t=production.handle[i];++i) {
                    if (self.nullable(t)) n++;
                }
                if (n===i) { // production is nullable if all tokens are nullable
                    production.nullable = cont = true;
                }
            }
        });

        //check if each symbol is nullable
        for (var symbol in nonterminals) {
            if (!this.nullable(symbol)) {
                for (var i=0,production;production=nonterminals[symbol].productions.item(i);i++) {
                    if (production.nullable)
                        nonterminals[symbol].nullable = cont = true;
                }
            }
        }
    }
};

// check if a token or series of tokens is nullable
lookaheadMixin.nullable = function nullable (symbol) {
    // epsilon
    if (symbol === '') {
        return true;
    // RHS
    } else if (symbol instanceof Array) {
        for (var i=0,t;t=symbol[i];++i) {
            if (!this.nullable(t))
                return false;
        }
        return true;
    // terminal
    } else if (!this.nonterminals[symbol]) {
        return false;
    // nonterminal
    } else {
        return this.nonterminals[symbol].nullable;
    }
};


// lookahead debug mixin
var lookaheadDebug = {
    beforenullableSets: function () {
        this.trace("Computing Nullable sets.");
    },
    beforefirstSets: function () {
        this.trace("Computing First sets.");
    },
    beforefollowSets: function () {
        this.trace("Computing Follow sets.");
    },
    afterfollowSets: function () {
        var trace = this.trace;
        each(this.nonterminals, function (nt, t) {
            trace(nt, '\n');
        });
    }
};

/*
 * Mixin for common LR parser behavior
 * */
var lrGeneratorMixin = {};

lrGeneratorMixin.buildTable = function buildTable () {
    if (this.DEBUG) this.mix(lrGeneratorDebug); // mixin debug methods

    this.states = this.canonicalCollection();
    this.table = this.parseTable(this.states);
    this.defaultActions = findDefaults(this.table);
};

lrGeneratorMixin.Item = typal.construct({
    constructor: function Item(production, dot, f, predecessor) {
        this.production = production;
        this.dotPosition = dot || 0;
        this.follows = f || [];
        this.predecessor = predecessor;
        this.id = parseInt(production.id+'a'+this.dotPosition, 36);
        this.markedSymbol = this.production.handle[this.dotPosition];
    },
    remainingHandle: function () {
        return this.production.handle.slice(this.dotPosition+1);
    },
    eq: function (e) {
        return e.id === this.id;
    },
    handleToString: function () {
        var handle = this.production.handle.slice(0);
        handle[this.dotPosition] = '.'+(handle[this.dotPosition]||'');
        return handle.join(' ');
    },
    toString: function () {
        var temp = this.production.handle.slice(0);
        temp[this.dotPosition] = '.'+(temp[this.dotPosition]||'');
        return this.production.symbol+" -> "+temp.join(' ') +
            (this.follows.length === 0 ? "" : " #lookaheads= "+this.follows.join(' '));
    }
});

lrGeneratorMixin.ItemSet = Set.prototype.construct({
    afterconstructor: function () {
        this.reductions = [];
        this.goes = {};
        this.edges = {};
        this.shifts = false;
        this.inadequate = false;
        this.hash_ = {};
        for (var i=this._items.length-1;i >=0;i--) {
            this.hash_[this._items[i].id] = true; //i;
        }
    },
    concat: function concat (set) {
        var a = set._items || set;
        for (var i=a.length-1;i >=0;i--) {
            this.hash_[a[i].id] = true; //i;
        }
        this._items.push.apply(this._items, a);
        return this;
    },
    push: function (item) {
        this.hash_[item.id] = true;
        return this._items.push(item);
    },
    contains: function (item) {
        return this.hash_[item.id];
    },
    valueOf: function toValue () {
        var v = this._items.map(function (a) {return a.id;}).sort().join('|');
        this.valueOf = function toValue_inner() {return v;};
        return v;
    }
});

lrGeneratorMixin.closureOperation = function closureOperation (itemSet /*, closureSet*/) {
    var closureSet = new this.ItemSet();
    var self = this;

    var set = itemSet,
        itemQueue, syms = {};

    do {
    itemQueue = new Set();
    closureSet.concat(set);
    set.forEach(function CO_set_forEach (item) {
        var symbol = item.markedSymbol;

        // if token is a non-terminal, recursively add closures
        if (symbol && self.nonterminals[symbol]) {
            if(!syms[symbol]) {
                self.nonterminals[symbol].productions.forEach(function CO_nt_forEach (production) {
                    var newItem = new self.Item(production, 0);
                    if(!closureSet.contains(newItem))
                        itemQueue.push(newItem);
                });
                syms[symbol] = true;
            }
        } else if (!symbol) {
            // reduction
            closureSet.reductions.push(item);
            closureSet.inadequate = closureSet.reductions.length > 1 || closureSet.shifts;
        } else {
            // shift
            closureSet.shifts = true;
            closureSet.inadequate = closureSet.reductions.length > 0;
        }
    });

    set = itemQueue;

    } while (!itemQueue.isEmpty());

    return closureSet;
};

lrGeneratorMixin.gotoOperation = function gotoOperation (itemSet, symbol) {
    var gotoSet = new this.ItemSet(),
        self = this;

    itemSet.forEach(function goto_forEach(item, n) {
        if (item.markedSymbol === symbol) {
            gotoSet.push(new self.Item(item.production, item.dotPosition+1, item.follows, n));
        }
    });

    return gotoSet.isEmpty() ? gotoSet : this.closureOperation(gotoSet);
};

/* Create unique set of item sets
 * */
lrGeneratorMixin.canonicalCollection = function canonicalCollection () {
    var item1 = new this.Item(this.productions[0], 0, [this.EOF]);
    var firstState = this.closureOperation(new this.ItemSet(item1)),
        states = new Set(firstState),
        marked = 0,
        self = this,
        itemSet;

    states.has = {};
    states.has[firstState] = 0;

    while (marked !== states.size()) {
        itemSet = states.item(marked); marked++;
        itemSet.forEach(function CC_itemSet_forEach (item) {
            if (item.markedSymbol && item.markedSymbol !== self.EOF)
                self.canonicalCollectionInsert(item.markedSymbol, itemSet, states, marked-1);
        });
    }

    return states;
};

// Pushes a unique state into the que. Some parsing algorithms may perform additional operations
lrGeneratorMixin.canonicalCollectionInsert = function canonicalCollectionInsert (symbol, itemSet, states, stateNum) {
    var g = this.gotoOperation(itemSet, symbol);
    if (!g.predecessors)
        g.predecessors = {};
    // add g to que if not empty or duplicate
    if (!g.isEmpty()) {
        var gv = g.valueOf(),
            i = states.has[gv];
        if (i === -1 || typeof i === 'undefined') {
            states.has[gv] = states.size();
            itemSet.edges[symbol] = states.size(); // store goto transition for table
            states.push(g);
            g.predecessors[symbol] = [stateNum];
        } else {
            itemSet.edges[symbol] = i; // store goto transition for table
            states.item(i).predecessors[symbol].push(stateNum);
        }
    }
};

var NONASSOC = 0;
lrGeneratorMixin.parseTable = function parseTable (itemSets) {
    var states = [],
        nonterminals = this.nonterminals,
        operators = this.operators,
        conflictedStates = {}, // array of [state, token] tuples
        self = this,
        s = 1, // shift
        r = 2, // reduce
        a = 3; // accept

    // for each item set
    itemSets.forEach(function (itemSet, k) {
        var state = states[k] = {};
        var action, stackSymbol;

        // set shift and goto actions
        for (stackSymbol in itemSet.edges) {
            itemSet.forEach(function (item, j) {
                // find shift and goto actions
                if (item.markedSymbol == stackSymbol) {
                    var gotoState = itemSet.edges[stackSymbol];
                    if (nonterminals[stackSymbol]) {
                        // store state to go to after a reduce
                        //self.trace(k, stackSymbol, 'g'+gotoState);
                        state[self.symbols_[stackSymbol]] = gotoState;
                    } else {
                        //self.trace(k, stackSymbol, 's'+gotoState);
                        state[self.symbols_[stackSymbol]] = [s,gotoState];
                    }
                }
            });
        }

        // set accept action
        itemSet.forEach(function (item, j) {
            if (item.markedSymbol == self.EOF) {
                // accept
                state[self.symbols_[self.EOF]] = [a];
                //self.trace(k, self.EOF, state[self.EOF]);
            }
        });

        var allterms = self.lookAheads ? false : self.terminals;

        // set reductions and resolve potential conflicts
        itemSet.reductions.forEach(function (item, j) {
            // if parser uses lookahead, only enumerate those terminals
            var terminals = allterms || self.lookAheads(itemSet, item);

            terminals.forEach(function (stackSymbol) {
                action = state[self.symbols_[stackSymbol]];
                var op = operators[stackSymbol];

                // Reading a terminal and current position is at the end of a production, try to reduce
                if (action || action && action.length) {
                    var sol = resolveConflict(item.production, op, [r,item.production.id], action[0] instanceof Array ? action[0] : action);
                    self.resolutions.push([k,stackSymbol,sol]);
                    if (sol.bydefault) {
                        self.conflicts++;
                        if (!self.DEBUG) {
                            self.warn('Conflict in grammar: multiple actions possible when lookahead token is ',stackSymbol,' in state ',k, "\n- ", printAction(sol.r, self), "\n- ", printAction(sol.s, self));
                            conflictedStates[k] = true;
                        }
                        if (self.options.noDefaultResolve) {
                            if (!(action[0] instanceof Array))
                                action = [action];
                            action.push(sol.r);
                        }
                    } else {
                        action = sol.action;
                    }
                } else {
                    action = [r,item.production.id];
                }
                if (action && action.length) {
                    state[self.symbols_[stackSymbol]] = action;
                } else if (action === NONASSOC) {
                    state[self.symbols_[stackSymbol]] = undefined;
                }
            });
        });

    });

    if (!self.DEBUG && self.conflicts > 0) {
        self.warn("\nStates with conflicts:");
        each(conflictedStates, function (val, state) {
            self.warn('State '+state);
            self.warn('  ',itemSets.item(state).join("\n  "));
        });
    }

    return states;
};

// find states with only one action, a reduction
function findDefaults (states) {
    var defaults = {};
    states.forEach(function (state, k) {
        var i = 0;
        for (var act in state) {
             if ({}.hasOwnProperty.call(state, act)) i++;
        }

        if (i === 1 && state[act][0] === 2) {
            // only one action in state and it's a reduction
            defaults[k] = state[act];
        }
    });

    return defaults;
}

// resolves shift-reduce and reduce-reduce conflicts
function resolveConflict (production, op, reduce, shift) {
    var sln = {production: production, operator: op, r: reduce, s: shift},
        s = 1, // shift
        r = 2, // reduce
        a = 3; // accept

    if (shift[0] === r) {
        sln.msg = "Resolve R/R conflict (use first production declared in grammar.)";
        sln.action = shift[1] < reduce[1] ? shift : reduce;
        if (shift[1] !== reduce[1]) sln.bydefault = true;
        return sln;
    }

    if (production.precedence === 0 || !op) {
        sln.msg = "Resolve S/R conflict (shift by default.)";
        sln.bydefault = true;
        sln.action = shift;
    } else if (production.precedence < op.precedence ) {
        sln.msg = "Resolve S/R conflict (shift for higher precedent operator.)";
        sln.action = shift;
    } else if (production.precedence === op.precedence) {
        if (op.assoc === "right" ) {
            sln.msg = "Resolve S/R conflict (shift for right associative operator.)";
            sln.action = shift;
        } else if (op.assoc === "left" ) {
            sln.msg = "Resolve S/R conflict (reduce for left associative operator.)";
            sln.action = reduce;
        } else if (op.assoc === "nonassoc" ) {
            sln.msg = "Resolve S/R conflict (no action for non-associative operator.)";
            sln.action = NONASSOC;
        }
    } else {
        sln.msg = "Resolve conflict (reduce for higher precedent production.)";
        sln.action = reduce;
    }

    return sln;
}

lrGeneratorMixin.generate = function parser_generate (opt) {
    opt = typal.mix.call({}, this.options, opt);
    var code = "";

    // check for illegal identifier
    if (!opt.moduleName || !opt.moduleName.match(/^[A-Za-z_$][A-Za-z0-9_$]*$/)) {
        opt.moduleName = "parser";
    }
    switch (opt.moduleType) {
        case "js":
            code = this.generateModule(opt);
            break;
        case "amd":
            code = this.generateAMDModule(opt);
            break;
        default:
            code = this.generateCommonJSModule(opt);
            break;
    }

    return code;
};

lrGeneratorMixin.generateAMDModule = function generateAMDModule(opt){
    opt = typal.mix.call({}, this.options, opt);
    var module = this.generateModule_();
    var out = '\n\ndefine(function(require){\n'
        + module.commonCode
        + '\nvar parser = '+ module.moduleCode
        + "\n"+this.moduleInclude
        + (this.lexer && this.lexer.generateModule ?
          '\n' + this.lexer.generateModule() +
          '\nparser.lexer = lexer;' : '')
        + '\nreturn parser;'
        + '\n});'
    return out;
};

lrGeneratorMixin.generateCommonJSModule = function generateCommonJSModule (opt) {
    opt = typal.mix.call({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    var out = this.generateModule(opt)
        + "\n\n\nif (typeof require !== 'undefined' && typeof exports !== 'undefined') {"
        + "\nexports.parser = "+moduleName+";"
        + "\nexports.Parser = "+moduleName+".Parser;"
        + "\nexports.parse = function () { return "+moduleName+".parse.apply("+moduleName+", arguments); };"
        + "\nexports.main = "+ String(opt.moduleMain || commonjsMain) + ";"
        + "\nif (typeof module !== 'undefined' && require.main === module) {\n"
        + "  exports.main(process.argv.slice(1));\n}"
        + "\n}";

    return out;
};

lrGeneratorMixin.generateModule = function generateModule (opt) {
    opt = typal.mix.call({}, this.options, opt);
    var moduleName = opt.moduleName || "parser";
    var out = "/* parser generated by jison " + version + " */\n"
        + "/*\n"
        + "  Returns a Parser object of the following structure:\n"
        + "\n"
        + "  Parser: {\n"
        + "    yy: {}\n"
        + "  }\n"
        + "\n"
        + "  Parser.prototype: {\n"
        + "    yy: {},\n"
        + "    trace: function(),\n"
        + "    symbols_: {associative list: name ==> number},\n"
        + "    terminals_: {associative list: number ==> name},\n"
        + "    productions_: [...],\n"
        + "    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),\n"
        + "    table: [...],\n"
        + "    defaultActions: {...},\n"
        + "    parseError: function(str, hash),\n"
        + "    parse: function(input),\n"
        + "\n"
        + "    lexer: {\n"
        + "        EOF: 1,\n"
        + "        parseError: function(str, hash),\n"
        + "        setInput: function(input),\n"
        + "        input: function(),\n"
        + "        unput: function(str),\n"
        + "        more: function(),\n"
        + "        less: function(n),\n"
        + "        pastInput: function(),\n"
        + "        upcomingInput: function(),\n"
        + "        showPosition: function(),\n"
        + "        test_match: function(regex_match_array, rule_index),\n"
        + "        next: function(),\n"
        + "        lex: function(),\n"
        + "        begin: function(condition),\n"
        + "        popState: function(),\n"
        + "        _currentRules: function(),\n"
        + "        topState: function(),\n"
        + "        pushState: function(condition),\n"
        + "\n"
        + "        options: {\n"
        + "            ranges: boolean           (optional: true ==> token location info will include a .range[] member)\n"
        + "            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)\n"
        + "            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)\n"
        + "        },\n"
        + "\n"
        + "        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),\n"
        + "        rules: [...],\n"
        + "        conditions: {associative list: name ==> set},\n"
        + "    }\n"
        + "  }\n"
        + "\n"
        + "\n"
        + "  token location info (@$, _$, etc.): {\n"
        + "    first_line: n,\n"
        + "    last_line: n,\n"
        + "    first_column: n,\n"
        + "    last_column: n,\n"
        + "    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)\n"
        + "  }\n"
        + "\n"
        + "\n"
        + "  the parseError function receives a 'hash' object with these members for lexer and parser errors: {\n"
        + "    text:        (matched text)\n"
        + "    token:       (the produced terminal token, if any)\n"
        + "    line:        (yylineno)\n"
        + "  }\n"
        + "  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {\n"
        + "    loc:         (yylloc)\n"
        + "    expected:    (string describing the set of expected tokens)\n"
        + "    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)\n"
        + "  }\n"
        + "*/\n";
    out += (moduleName.match(/\./) ? moduleName : "var "+moduleName) +
            " = " + this.generateModuleExpr();

    return out;
};


lrGeneratorMixin.generateModuleExpr = function generateModuleExpr () {
    var out = '';
    var module = this.generateModule_();

    out += "(function(){\n";
    out += module.commonCode;
    out += "\nvar parser = "+module.moduleCode;
    out += "\n"+this.moduleInclude;
    if (this.lexer && this.lexer.generateModule) {
        out += this.lexer.generateModule();
        out += "\nparser.lexer = lexer;";
    }
    out += "\nfunction Parser () {\n  this.yy = {};\n}\n"
        + "Parser.prototype = parser;"
        + "parser.Parser = Parser;"
        + "\nreturn new Parser;\n})();";

    return out;
};

function addTokenStack (fn) {
    var parseFn = fn;
    try {
        var ast = esprima.parse(parseFn);
        var stackAst = esprima.parse(String(tokenStackLex)).body[0];
        stackAst.id.name = 'lex';

        var labeled = JSONSelect.match(':has(:root > .label > .name:val("_token_stack"))', ast);

        labeled[0].body = stackAst;

        return escodegen.generate(ast).replace(/_token_stack:\s?/,"").replace(/\\\\n/g,"\\n");
    } catch (e) {
        return parseFn;
    }
}

// lex function that supports token stacks
function tokenStackLex() {
    var token;
    token = tstack.pop() || lexer.lex() || EOF;
    // if token isn't its numeric value, convert
    if (typeof token !== 'number') {
        if (token instanceof Array) {
            tstack = token;
            token = tstack.pop();
        }
        token = self.symbols_[token] || token;
    }
    return token;
}

// returns parse function without error recovery code
function removeErrorRecovery (fn) {
    var parseFn = fn;
    try {
        var ast = esprima.parse(parseFn);

        var labeled = JSONSelect.match(':has(:root > .label > .name:val("_handle_error"))', ast);
        var reduced_code = labeled[0].body.consequent.body[3].consequent.body;
        reduced_code[0] = labeled[0].body.consequent.body[1];     // remove the line: error_rule_depth = locateNearestErrorRecoveryRule(state);
        reduced_code[4].expression.arguments[1].properties.pop(); // remove the line: 'recoverable: error_rule_depth !== false'
        labeled[0].body.consequent.body = reduced_code;

        return escodegen.generate(ast).replace(/_handle_error:\s?/,"").replace(/\\\\n/g,"\\n");
    } catch (e) {
        return parseFn;
    }
}

// Generates the code of the parser module, which consists of two parts:
// - module.commonCode: initialization code that should be placed before the module
// - module.moduleCode: code that creates the module object
lrGeneratorMixin.generateModule_ = function generateModule_ () {
    var parseFn = String(parser.parse);
    if (!this.hasErrorRecovery) {
      parseFn = removeErrorRecovery(parseFn);
    }

    if (this.options['token-stack']) {
      parseFn = addTokenStack(parseFn);
    }

    // Generate code with fresh variable names
    nextVariableId = 0;
    var tableCode = this.generateTableCode(this.table);

    // Generate the initialization code
    var commonCode = tableCode.commonCode;

    // Generate the module creation code
    var moduleCode = "{";
    moduleCode += [
        "trace: " + String(this.trace || parser.trace),
        "yy: {}",
        "symbols_: " + JSON.stringify(this.symbols_),
        "terminals_: " + JSON.stringify(this.terminals_).replace(/"([0-9]+)":/g,"$1:"),
        "productions_: " + JSON.stringify(this.productions_),
        "performAction: " + String(this.performAction),
        "table: " + tableCode.moduleCode,
        "defaultActions: " + JSON.stringify(this.defaultActions).replace(/"([0-9]+)":/g,"$1:"),
        "parseError: " + String(this.parseError || (this.hasErrorRecovery ? traceParseError : parser.parseError)),
        "parse: " + parseFn
        ].join(",\n");
    moduleCode += "};";

    return { commonCode: commonCode, moduleCode: moduleCode }
};

// Generate code that represents the specified parser table
lrGeneratorMixin.generateTableCode = function (table) {
    var moduleCode = JSON.stringify(table);
    var variables = [createObjectCode];

    // Don't surround numerical property name numbers in quotes
    moduleCode = moduleCode.replace(/"([0-9]+)"(?=:)/g, "$1");

    // Replace objects with several identical values by function calls
    // e.g., { 1: [6, 7]; 3: [6, 7], 4: [6, 7], 5: 8 } = o([1, 3, 4], [6, 7], { 5: 8 })
    moduleCode = moduleCode.replace(/\{\d+:[^\}]+,\d+:[^\}]+\}/g, function (object) {
        // Find the value that occurs with the highest number of keys
        var value, frequentValue, key, keys = {}, keyCount, maxKeyCount = 0,
            keyValue, keyValues = [], keyValueMatcher = /(\d+):([^:]+)(?=,\d+:|\})/g;

        while ((keyValue = keyValueMatcher.exec(object))) {
            // For each value, store the keys where that value occurs
            key = keyValue[1];
            value = keyValue[2];
            keyCount = 1;

            if (!(value in keys)) {
                keys[value] = [key];
            } else {
                keyCount = keys[value].push(key);
            }
            // Remember this value if it is the most frequent one
            if (keyCount > maxKeyCount) {
                maxKeyCount = keyCount;
                frequentValue = value;
            }
        }
        // Construct the object with a function call if the most frequent value occurs multiple times
        if (maxKeyCount > 1) {
            // Collect all non-frequent values into a remainder object
            for (value in keys) {
                if (value !== frequentValue) {
                    for (var k = keys[value], i = 0, l = k.length; i < l; i++) {
                        keyValues.push(k[i] + ':' + value);
                    }
                }
            }
            keyValues = keyValues.length ? ',{' + keyValues.join(',') + '}' : '';
            // Create the function call `o(keys, value, remainder)`
            object = 'o([' + keys[frequentValue].join(',') + '],' + frequentValue + keyValues + ')';
        }
        return object;
    });

    // Count occurrences of number lists
    var list;
    var lists = {};
    var listMatcher = /\[[0-9,]+\]/g;

    while (list = listMatcher.exec(moduleCode)) {
        lists[list] = (lists[list] || 0) + 1;
    }

    // Replace frequently occurring number lists with variables
    moduleCode = moduleCode.replace(listMatcher, function (list) {
        var listId = lists[list];
        // If listId is a number, it represents the list's occurrence frequency
        if (typeof listId === 'number') {
            // If the list does not occur frequently, represent it by the list
            if (listId === 1) {
                lists[list] = listId = list;
            // If the list occurs frequently, represent it by a newly assigned variable
            } else {
                lists[list] = listId = createVariable();
                variables.push(listId + '=' + list);
            }
        }
        return listId;
    });

    // Return the variable initialization code and the table code
    return {
        commonCode: 'var ' + variables.join(',') + ';',
        moduleCode: moduleCode
    };
};
// Function that extends an object with the given value for all given keys
// e.g., o([1, 3, 4], [6, 7], { x: 1, y: 2 }) = { 1: [6, 7]; 3: [6, 7], 4: [6, 7], x: 1, y: 2 }
var createObjectCode = 'o=function(k,v,o,l){' +
    'for(o=o||{},l=k.length;l--;o[k[l]]=v);' +
    'return o}';

// Creates a variable with a unique name
function createVariable() {
    var id = nextVariableId++;
    var name = '$V';

    do {
        name += variableTokens[id % variableTokensLength];
        id = ~~(id / variableTokensLength);
    } while (id !== 0);

    return name;
}

var nextVariableId = 0;
var variableTokens = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';
var variableTokensLength = variableTokens.length;

// default main method for generated commonjs modules
function commonjsMain (args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
}

// debug mixin for LR parser generators

function printAction (a, gen) {
    var s = a[0] == 1 ? 'shift token (then go to state '+a[1]+')' :
        a[0] == 2 ? 'reduce by rule: '+gen.productions[a[1]] :
                    'accept' ;

    return s;
}

var lrGeneratorDebug = {
    beforeparseTable: function () {
        this.trace("Building parse table.");
    },
    afterparseTable: function () {
        var self = this;
        if (this.conflicts > 0) {
            this.resolutions.forEach(function (r, i) {
                if (r[2].bydefault) {
                    self.warn('Conflict at state: ',r[0], ', token: ',r[1], "\n  ", printAction(r[2].r, self), "\n  ", printAction(r[2].s, self));
                }
            });
            this.trace("\n"+this.conflicts+" Conflict(s) found in grammar.");
        }
        this.trace("Done.");
    },
    aftercanonicalCollection: function (states) {
        var trace = this.trace;
        trace("\nItem sets\n------");

        states.forEach(function (state, i) {
            trace("\nitem set",i,"\n"+state.join("\n"), '\ntransitions -> ', JSON.stringify(state.edges));
        });
    }
};

var parser = typal.beget();

lrGeneratorMixin.createParser = function createParser () {

    var p = eval(this.generateModuleExpr());

    // for debugging
    p.productions = this.productions;

    var self = this;
    function bind(method) {
        return function() {
            self.lexer = p.lexer;
            return self[method].apply(self, arguments);
        };
    }

    // backwards compatability
    p.lexer = this.lexer;
    p.generate = bind('generate');
    p.generateAMDModule = bind('generateAMDModule');
    p.generateModule = bind('generateModule');
    p.generateCommonJSModule = bind('generateCommonJSModule');

    return p;
};

parser.trace = generator.trace;
parser.warn = generator.warn;
parser.error = generator.error;

function traceParseError (err, hash) {
    this.trace(err);
}

function parseError (str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        function _parseError (msg, hash) {
            this.message = msg;
            this.hash = hash;
        }
        _parseError.prototype = Error;

        throw new _parseError(str, hash);
    }
}

parser.parseError = lrGeneratorMixin.parseError = parseError;

parser.parse = function parse (input) {
    var self = this,
        stack = [0],
        tstack = [], // token stack
        vstack = [null], // semantic value stack
        lstack = [], // location stack
        table = this.table,
        yytext = '',
        yylineno = 0,
        yyleng = 0,
        recovering = 0,
        TERROR = 2,
        EOF = 1;

    var args = lstack.slice.call(arguments, 1);

    //this.reductionCount = this.shiftCount = 0;

    var lexer = Object.create(this.lexer);
    var sharedState = { yy: {} };
    // copy state
    for (var k in this.yy) {
      if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
        sharedState.yy[k] = this.yy[k];
      }
    }

    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;
    if (typeof lexer.yylloc == 'undefined') {
        lexer.yylloc = {};
    }
    var yyloc = lexer.yylloc;
    lstack.push(yyloc);

    var ranges = lexer.options && lexer.options.ranges;

    if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }

    function popStack (n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }

_token_stack:
    var lex = function () {
        var token;
        token = lexer.lex() || EOF;
        // if token isn't its numeric value, convert
        if (typeof token !== 'number') {
            token = self.symbols_[token] || token;
        }
        return token;
    }

    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        // retreive state number from top of stack
        state = stack[stack.length - 1];

        // use default actions if available
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            // read action for current state and first input
            action = table[state] && table[state][symbol];
        }

_handle_error:
        // handle parse error
        if (typeof action === 'undefined' || !action.length || !action[0]) {
            var error_rule_depth;
            var errStr = '';

            // Return the rule stack depth where the nearest error rule can be found.
            // Return FALSE when no error recovery rule was found.
            function locateNearestErrorRecoveryRule(state) {
                var stack_probe = stack.length - 1;
                var depth = 0;

                // try to recover from error
                for(;;) {
                    // check for error recovery rule in this state
                    if ((TERROR.toString()) in table[state]) {
                        return depth;
                    }
                    if (state === 0 || stack_probe < 2) {
                        return false; // No suitable error recovery rule available.
                    }
                    stack_probe -= 2; // popStack(1): [symbol, action]
                    state = stack[stack_probe];
                    ++depth;
                }
            }

            if (!recovering) {
                // first see if there's any chance at hitting an error recovery rule:
                error_rule_depth = locateNearestErrorRecoveryRule(state);

                // Report error
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push("'"+this.terminals_[p]+"'");
                    }
                }
                if (lexer.showPosition) {
                    errStr = 'Parse error on line '+(yylineno+1)+":\n"+lexer.showPosition()+"\nExpecting "+expected.join(', ') + ", got '" + (this.terminals_[symbol] || symbol)+ "'";
                } else {
                    errStr = 'Parse error on line '+(yylineno+1)+": Unexpected " +
                                  (symbol == EOF ? "end of input" :
                                              ("'"+(this.terminals_[symbol] || symbol)+"'"));
                }
                this.parseError(errStr, {
                    text: lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: lexer.yylineno,
                    loc: yyloc,
                    expected: expected,
                    recoverable: (error_rule_depth !== false)
                });
            } else if (preErrorSymbol !== EOF) {
                error_rule_depth = locateNearestErrorRecoveryRule(state);
            }

            // just recovered from another error
            if (recovering == 3) {
                if (symbol === EOF || preErrorSymbol === EOF) {
                    throw new Error(errStr || 'Parsing halted while starting to recover from another error.');
                }

                // discard current lookahead and grab another
                yyleng = lexer.yyleng;
                yytext = lexer.yytext;
                yylineno = lexer.yylineno;
                yyloc = lexer.yylloc;
                symbol = lex();
            }

            // try to recover from error
            if (error_rule_depth === false) {
                throw new Error(errStr || 'Parsing halted. No suitable error recovery rule available.');
            }
            popStack(error_rule_depth);

            preErrorSymbol = (symbol == TERROR ? null : symbol); // save the lookahead token
            symbol = TERROR;         // insert generic error symbol as new lookahead
            state = stack[stack.length-1];
            action = table[state] && table[state][TERROR];
            recovering = 3; // allow 3 real symbols to be shifted before reporting a new error
        }

        // this shouldn't happen, unless resolve defaults are off
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: '+state+', token: '+symbol);
        }

        switch (action[0]) {
            case 1: // shift
                //this.shiftCount++;

                stack.push(symbol);
                vstack.push(lexer.yytext);
                lstack.push(lexer.yylloc);
                stack.push(action[1]); // push state
                symbol = null;
                if (!preErrorSymbol) { // normal execution/no error
                    yyleng = lexer.yyleng;
                    yytext = lexer.yytext;
                    yylineno = lexer.yylineno;
                    yyloc = lexer.yylloc;
                    if (recovering > 0) {
                        recovering--;
                    }
                } else {
                    // error just occurred, resume old lookahead f/ before error
                    symbol = preErrorSymbol;
                    preErrorSymbol = null;
                }
                break;

            case 2:
                // reduce
                //this.reductionCount++;

                len = this.productions_[action[1]][1];

                // perform semantic action
                yyval.$ = vstack[vstack.length-len]; // default to $$ = $1
                // default location, uses first token for firsts, last for lasts
                yyval._$ = {
                    first_line: lstack[lstack.length-(len||1)].first_line,
                    last_line: lstack[lstack.length-1].last_line,
                    first_column: lstack[lstack.length-(len||1)].first_column,
                    last_column: lstack[lstack.length-1].last_column
                };
                if (ranges) {
                  yyval._$.range = [lstack[lstack.length-(len||1)].range[0], lstack[lstack.length-1].range[1]];
                }
                r = this.performAction.apply(yyval, [yytext, yyleng, yylineno, sharedState.yy, action[1], vstack, lstack].concat(args));

                if (typeof r !== 'undefined') {
                    return r;
                }

                // pop off stack
                if (len) {
                    stack = stack.slice(0,-1*len*2);
                    vstack = vstack.slice(0, -1*len);
                    lstack = lstack.slice(0, -1*len);
                }

                stack.push(this.productions_[action[1]][0]);    // push nonterminal (reduce)
                vstack.push(yyval.$);
                lstack.push(yyval._$);
                // goto new state = table[STATE][NONTERMINAL]
                newState = table[stack[stack.length-2]][stack[stack.length-1]];
                stack.push(newState);
                break;

            case 3:
                // accept
                return true;
        }

    }

    return true;
};

parser.init = function parser_init (dict) {
    this.table = dict.table;
    this.defaultActions = dict.defaultActions;
    this.performAction = dict.performAction;
    this.productions_ = dict.productions_;
    this.symbols_ = dict.symbols_;
    this.terminals_ = dict.terminals_;
};

/*
 * LR(0) Parser
 * */

var lr0 = generator.beget(lookaheadMixin, lrGeneratorMixin, {
    type: "LR(0)",
    afterconstructor: function lr0_afterconstructor () {
        this.buildTable();
    }
});

var LR0Generator = exports.LR0Generator = lr0.construct();

/*
 * Simple LALR(1)
 * */

var lalr = generator.beget(lookaheadMixin, lrGeneratorMixin, {
    type: "LALR(1)",

    afterconstructor: function (grammar, options) {
        if (this.DEBUG) this.mix(lrGeneratorDebug, lalrGeneratorDebug); // mixin debug methods

        options = options || {};
        this.states = this.canonicalCollection();
        this.terms_ = {};

        var newg = this.newg = typal.beget(lookaheadMixin,{
            oldg: this,
            trace: this.trace,
            nterms_: {},
            DEBUG: false,
            go_: function (r, B) {
                r = r.split(":")[0]; // grab state #
                B = B.map(function (b) { return b.slice(b.indexOf(":")+1); });
                return this.oldg.go(r, B);
            }
        });
        newg.nonterminals = {};
        newg.productions = [];

        this.inadequateStates = [];

        // if true, only lookaheads in inadequate states are computed (faster, larger table)
        // if false, lookaheads for all reductions will be computed (slower, smaller table)
        this.onDemandLookahead = options.onDemandLookahead || false;

        this.buildNewGrammar();
        newg.computeLookaheads();
        this.unionLookaheads();

        this.table = this.parseTable(this.states);
        this.defaultActions = findDefaults(this.table);
    },

    lookAheads: function LALR_lookaheads (state, item) {
        return (!!this.onDemandLookahead && !state.inadequate) ? this.terminals : item.follows;
    },
    go: function LALR_go (p, w) {
        var q = parseInt(p, 10);
        for (var i=0;i<w.length;i++) {
            q = this.states.item(q).edges[w[i]] || q;
        }
        return q;
    },
    goPath: function LALR_goPath (p, w) {
        var q = parseInt(p, 10),t,
            path = [];
        for (var i=0;i<w.length;i++) {
            t = w[i] ? q+":"+w[i] : '';
            if (t) this.newg.nterms_[t] = q;
            path.push(t);
            q = this.states.item(q).edges[w[i]] || q;
            this.terms_[t] = w[i];
        }
        return {path: path, endState: q};
    },
    // every disjoint reduction of a nonterminal becomes a produciton in G'
    buildNewGrammar: function LALR_buildNewGrammar () {
        var self = this,
            newg = this.newg;

        this.states.forEach(function (state, i) {
            state.forEach(function (item) {
                if (item.dotPosition === 0) {
                    // new symbols are a combination of state and transition symbol
                    var symbol = i+":"+item.production.symbol;
                    self.terms_[symbol] = item.production.symbol;
                    newg.nterms_[symbol] = i;
                    if (!newg.nonterminals[symbol])
                        newg.nonterminals[symbol] = new Nonterminal(symbol);
                    var pathInfo = self.goPath(i, item.production.handle);
                    var p = new Production(symbol, pathInfo.path, newg.productions.length);
                    newg.productions.push(p);
                    newg.nonterminals[symbol].productions.push(p);

                    // store the transition that get's 'backed up to' after reduction on path
                    var handle = item.production.handle.join(' ');
                    var goes = self.states.item(pathInfo.endState).goes;
                    if (!goes[handle])
                        goes[handle] = [];
                    goes[handle].push(symbol);

                    //self.trace('new production:',p);
                }
            });
            if (state.inadequate)
                self.inadequateStates.push(i);
        });
    },
    unionLookaheads: function LALR_unionLookaheads () {
        var self = this,
            newg = this.newg,
            states = !!this.onDemandLookahead ? this.inadequateStates : this.states;

        states.forEach(function union_states_forEach (i) {
            var state = typeof i === 'number' ? self.states.item(i) : i,
                follows = [];
            if (state.reductions.length)
            state.reductions.forEach(function union_reduction_forEach (item) {
                var follows = {};
                for (var k=0;k<item.follows.length;k++) {
                    follows[item.follows[k]] = true;
                }
                state.goes[item.production.handle.join(' ')].forEach(function reduction_goes_forEach (symbol) {
                    newg.nonterminals[symbol].follows.forEach(function goes_follows_forEach (symbol) {
                        var terminal = self.terms_[symbol];
                        if (!follows[terminal]) {
                            follows[terminal]=true;
                            item.follows.push(terminal);
                        }
                    });
                });
                //self.trace('unioned item', item);
            });
        });
    }
});

var LALRGenerator = exports.LALRGenerator = lalr.construct();

// LALR generator debug mixin

var lalrGeneratorDebug = {
    trace: function trace () {
        Jison.print.apply(null, arguments);
    },
    beforebuildNewGrammar: function () {
        this.trace(this.states.size()+" states.");
        this.trace("Building lookahead grammar.");
    },
    beforeunionLookaheads: function () {
        this.trace("Computing lookaheads.");
    }
};

/*
 * Lookahead parser definitions
 *
 * Define base type
 * */
var lrLookaheadGenerator = generator.beget(lookaheadMixin, lrGeneratorMixin, {
    afterconstructor: function lr_aftercontructor () {
        this.computeLookaheads();
        this.buildTable();
    }
});

/*
 * SLR Parser
 * */
var SLRGenerator = exports.SLRGenerator = lrLookaheadGenerator.construct({
    type: "SLR(1)",

    lookAheads: function SLR_lookAhead (state, item) {
        return this.nonterminals[item.production.symbol].follows;
    }
});


/*
 * LR(1) Parser
 * */
var lr1 = lrLookaheadGenerator.beget({
    type: "Canonical LR(1)",

    lookAheads: function LR_lookAheads (state, item) {
        return item.follows;
    },
    Item: lrGeneratorMixin.Item.prototype.construct({
        afterconstructor: function () {
            this.id = this.production.id+'a'+this.dotPosition+'a'+this.follows.sort().join(',');
        },
        eq: function (e) {
            return e.id === this.id;
        }
    }),

    closureOperation: function LR_ClosureOperation (itemSet /*, closureSet*/) {
        var closureSet = new this.ItemSet();
        var self = this;

        var set = itemSet,
            itemQueue, syms = {};

        do {
        itemQueue = new Set();
        closureSet.concat(set);
        set.forEach(function (item) {
            var symbol = item.markedSymbol;
            var b, r;

            // if token is a nonterminal, recursively add closures
            if (symbol && self.nonterminals[symbol]) {
                r = item.remainingHandle();
                b = self.first(item.remainingHandle());
                if (b.length === 0 || item.production.nullable || self.nullable(r)) {
                    b = b.concat(item.follows);
                }
                self.nonterminals[symbol].productions.forEach(function (production) {
                    var newItem = new self.Item(production, 0, b);
                    if(!closureSet.contains(newItem) && !itemQueue.contains(newItem)) {
                        itemQueue.push(newItem);
                    }
                });
            } else if (!symbol) {
                // reduction
                closureSet.reductions.push(item);
            }
        });

        set = itemQueue;
        } while (!itemQueue.isEmpty());

        return closureSet;
    }
});

var LR1Generator = exports.LR1Generator = lr1.construct();

/*
 * LL Parser
 * */
var ll = generator.beget(lookaheadMixin, {
    type: "LL(1)",

    afterconstructor: function ll_aftercontructor () {
        this.computeLookaheads();
        this.table = this.parseTable(this.productions);
    },
    parseTable: function llParseTable (productions) {
        var table = {},
            self = this;
        productions.forEach(function (production, i) {
            var row = table[production.symbol] || {};
            var tokens = production.first;
            if (self.nullable(production.handle)) {
                Set.union(tokens, self.nonterminals[production.symbol].follows);
            }
            tokens.forEach(function (token) {
                if (row[token]) {
                    row[token].push(i);
                    self.conflicts++;
                } else {
                    row[token] = [i];
                }
            });
            table[production.symbol] = row;
        });

        return table;
    }
});

var LLGenerator = exports.LLGenerator = ll.construct();

Jison.Generator = function Jison_Generator (g, options) {
    var opt = typal.mix.call({}, g.options, options);
    switch (opt.type) {
        case 'lr0':
            return new LR0Generator(g, opt);
        case 'slr':
            return new SLRGenerator(g, opt);
        case 'lr':
            return new LR1Generator(g, opt);
        case 'll':
            return new LLGenerator(g, opt);
        default:
            return new LALRGenerator(g, opt);
    }
};

return function Parser (g, options) {
        var gen = Jison.Generator(g, options);
        return gen.createParser();
    };

})();

}).call(this,require('_process'))
},{"../package.json":28,"./util/set":26,"./util/typal":27,"JSONSelect":2,"_process":33,"ebnf-parser":9,"escodegen":13,"esprima":15,"fs":7,"jison-lex":24,"path":32}],26:[function(require,module,exports){
// Set class to wrap arrays

var typal = require("./typal").typal;

var setMixin = {
    constructor: function Set_constructor (set, raw) {
        this._items = [];
        if (set && set.constructor === Array)
            this._items = raw ? set: set.slice(0);
        else if(arguments.length)
            this._items = [].slice.call(arguments,0);
    },
    concat: function concat (setB) {
        this._items.push.apply(this._items, setB._items || setB); 
        return this;
    },
    eq: function eq (set) {
        return this._items.length === set._items.length && this.subset(set); 
    },
    indexOf: function indexOf (item) {
        if(item && item.eq) {
            for(var k=0; k<this._items.length;k++)
                if(item.eq(this._items[k]))
                    return k;
            return -1;
        }
        return this._items.indexOf(item);
    },
    union: function union (set) {
        return (new Set(this._items)).concat(this.complement(set));
    },
    intersection: function intersection (set) {
    return this.filter(function (elm) {
            return set.contains(elm);
        });
    },
    complement: function complement (set) {
        var that = this;
        return set.filter(function sub_complement (elm) {
            return !that.contains(elm);
        });
    },
    subset: function subset (set) {
        var cont = true;
        for (var i=0; i<this._items.length && cont;i++) {
            cont = cont && set.contains(this._items[i]);
        }
        return cont;
    },
    superset: function superset (set) {
        return set.subset(this);
    },
    joinSet: function joinSet (set) {
        return this.concat(this.complement(set));
    },
    contains: function contains (item) { return this.indexOf(item) !== -1; },
    item: function item (v, val) { return this._items[v]; },
    i: function i (v, val) { return this._items[v]; },
    first: function first () { return this._items[0]; },
    last: function last () { return this._items[this._items.length-1]; },
    size: function size () { return this._items.length; },
    isEmpty: function isEmpty () { return this._items.length === 0; },
    copy: function copy () { return new Set(this._items); },
    toString: function toString () { return this._items.toString(); }
};

"push shift unshift forEach some every join sort".split(' ').forEach(function (e,i) {
    setMixin[e] = function () { return Array.prototype[e].apply(this._items, arguments); };
    setMixin[e].name = e;
});
"filter slice map".split(' ').forEach(function (e,i) {
    setMixin[e] = function () { return new Set(Array.prototype[e].apply(this._items, arguments), true); };
    setMixin[e].name = e;
});

var Set = typal.construct(setMixin).mix({
    union: function (a, b) {
        var ar = {};
        for (var k=a.length-1;k >=0;--k) {
            ar[a[k]] = true;
        }
        for (var i=b.length-1;i >= 0;--i) {
            if (!ar[b[i]]) {
                a.push(b[i]);
            }
        }
        return a;
    }
});

if (typeof exports !== 'undefined')
    exports.Set = Set;


},{"./typal":27}],27:[function(require,module,exports){
/*
 * Introduces a typal object to make classical/prototypal patterns easier
 * Plus some AOP sugar
 *
 * By Zachary Carter <zach@carter.name>
 * MIT Licensed
 * */

var typal = (function () {

var create = Object.create || function (o) { function F(){} F.prototype = o; return new F(); };
var position = /^(before|after)/;

// basic method layering
// always returns original method's return value
function layerMethod(k, fun) {
    var pos = k.match(position)[0],
        key = k.replace(position, ''),
        prop = this[key];

    if (pos === 'after') {
        this[key] = function () {
            var ret = prop.apply(this, arguments);
            var args = [].slice.call(arguments);
            args.splice(0, 0, ret);
            fun.apply(this, args);
            return ret;
        };
    } else if (pos === 'before') {
        this[key] = function () {
            fun.apply(this, arguments);
            var ret = prop.apply(this, arguments);
            return ret;
        };
    }
}

// mixes each argument's own properties into calling object,
// overwriting them or layering them. i.e. an object method 'meth' is
// layered by mixin methods 'beforemeth' or 'aftermeth'
function typal_mix() {
    var self = this;
    for(var i=0,o,k; i<arguments.length; i++) {
        o=arguments[i];
        if (!o) continue;
        if (Object.prototype.hasOwnProperty.call(o,'constructor'))
            this.constructor = o.constructor;
        if (Object.prototype.hasOwnProperty.call(o,'toString'))
            this.toString = o.toString;
        for(k in o) {
            if (Object.prototype.hasOwnProperty.call(o, k)) {
                if(k.match(position) && typeof this[k.replace(position, '')] === 'function')
                    layerMethod.call(this, k, o[k]);
                else
                    this[k] = o[k];
            }
        }
    }
    return this;
}

return {
    // extend object with own typalperties of each argument
    mix: typal_mix,

    // sugar for object begetting and mixing
    // - Object.create(typal).mix(etc, etc);
    // + typal.beget(etc, etc);
    beget: function typal_beget() {
        return arguments.length ? typal_mix.apply(create(this), arguments) : create(this);
    },

    // Creates a new Class function based on an object with a constructor method
    construct: function typal_construct() {
        var o = typal_mix.apply(create(this), arguments);
        var constructor = o.constructor;
        var Klass = o.constructor = function () { return constructor.apply(this, arguments); };
        Klass.prototype = o;
        Klass.mix = typal_mix; // allow for easy singleton property extension
        return Klass;
    },

    // no op
    constructor: function typal_constructor() { return this; }
};

})();

if (typeof exports !== 'undefined')
    exports.typal = typal;

},{}],28:[function(require,module,exports){
module.exports={
  "_args": [
    [
      {
        "raw": "jison@^0.4.17",
        "scope": null,
        "escapedName": "jison",
        "name": "jison",
        "rawSpec": "^0.4.17",
        "spec": ">=0.4.17 <0.5.0",
        "type": "range"
      },
      "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm"
    ]
  ],
  "_from": "jison@>=0.4.17 <0.5.0",
  "_id": "jison@0.4.17",
  "_inCache": true,
  "_location": "/jison",
  "_nodeVersion": "4.2.3",
  "_npmUser": {
    "name": "zaach",
    "email": "zack.carter@gmail.com"
  },
  "_npmVersion": "2.14.7",
  "_phantomChildren": {},
  "_requested": {
    "raw": "jison@^0.4.17",
    "scope": null,
    "escapedName": "jison",
    "name": "jison",
    "rawSpec": "^0.4.17",
    "spec": ">=0.4.17 <0.5.0",
    "type": "range"
  },
  "_requiredBy": [
    "/",
    "/jisonify"
  ],
  "_resolved": "https://registry.npmjs.org/jison/-/jison-0.4.17.tgz",
  "_shasum": "bc12d46c5845e6fee89ccf35bd2a8cc73eba17f3",
  "_shrinkwrap": null,
  "_spec": "jison@^0.4.17",
  "_where": "/Users/albert/Dropbox/upc/fib/q8/TFG/cmm",
  "author": {
    "name": "Zach Carter",
    "email": "zach@carter.name",
    "url": "http://zaa.ch"
  },
  "bin": {
    "jison": "lib/cli.js"
  },
  "bugs": {
    "url": "http://github.com/zaach/jison/issues",
    "email": "jison@librelist.com"
  },
  "dependencies": {
    "JSONSelect": "0.4.0",
    "cjson": "0.3.0",
    "ebnf-parser": "0.1.10",
    "escodegen": "1.3.x",
    "esprima": "1.1.x",
    "jison-lex": "0.3.x",
    "lex-parser": "~0.1.3",
    "nomnom": "1.5.2"
  },
  "description": "A parser generator with Bison's API",
  "devDependencies": {
    "browserify": "2.x.x",
    "jison": "0.4.x",
    "test": "0.6.x",
    "uglify-js": "~2.4.0"
  },
  "directories": {},
  "dist": {
    "shasum": "bc12d46c5845e6fee89ccf35bd2a8cc73eba17f3",
    "tarball": "https://registry.npmjs.org/jison/-/jison-0.4.17.tgz"
  },
  "engines": {
    "node": ">=0.4"
  },
  "gitHead": "9f2f188419f7790a46a5e9a6c882834d0fa16314",
  "homepage": "http://jison.org",
  "keywords": [
    "jison",
    "bison",
    "yacc",
    "parser",
    "generator",
    "lexer",
    "flex",
    "tokenizer",
    "compiler"
  ],
  "license": "MIT",
  "main": "lib/jison",
  "maintainers": [
    {
      "name": "zaach",
      "email": "zack.carter@gmail.com"
    }
  ],
  "name": "jison",
  "optionalDependencies": {},
  "preferGlobal": true,
  "readme": "ERROR: No README data found!",
  "repository": {
    "type": "git",
    "url": "git://github.com/zaach/jison.git"
  },
  "scripts": {
    "test": "node tests/all-tests.js"
  },
  "version": "0.4.17"
}

},{}],29:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.6 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var lex = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"lex":3,"definitions":4,"%%":5,"rules":6,"epilogue":7,"EOF":8,"CODE":9,"definition":10,"ACTION":11,"NAME":12,"regex":13,"START_INC":14,"names_inclusive":15,"START_EXC":16,"names_exclusive":17,"START_COND":18,"rule":19,"start_conditions":20,"action":21,"{":22,"action_body":23,"}":24,"action_comments_body":25,"ACTION_BODY":26,"<":27,"name_list":28,">":29,"*":30,",":31,"regex_list":32,"|":33,"regex_concat":34,"regex_base":35,"(":36,")":37,"SPECIAL_GROUP":38,"+":39,"?":40,"/":41,"/!":42,"name_expansion":43,"range_regex":44,"any_group_regex":45,".":46,"^":47,"$":48,"string":49,"escape_char":50,"NAME_BRACE":51,"ANY_GROUP_REGEX":52,"ESCAPE_CHAR":53,"RANGE_REGEX":54,"STRING_LIT":55,"CHARACTER_LIT":56,"$accept":0,"$end":1},
terminals_: {2:"error",5:"%%",8:"EOF",9:"CODE",11:"ACTION",12:"NAME",14:"START_INC",16:"START_EXC",18:"START_COND",22:"{",24:"}",26:"ACTION_BODY",27:"<",29:">",30:"*",31:",",33:"|",36:"(",37:")",38:"SPECIAL_GROUP",39:"+",40:"?",41:"/",42:"/!",46:".",47:"^",48:"$",51:"NAME_BRACE",52:"ANY_GROUP_REGEX",53:"ESCAPE_CHAR",54:"RANGE_REGEX",55:"STRING_LIT",56:"CHARACTER_LIT"},
productions_: [0,[3,4],[7,1],[7,2],[7,3],[4,2],[4,2],[4,0],[10,2],[10,2],[10,2],[15,1],[15,2],[17,1],[17,2],[6,2],[6,1],[19,3],[21,3],[21,1],[23,0],[23,1],[23,5],[23,4],[25,1],[25,2],[20,3],[20,3],[20,0],[28,1],[28,3],[13,1],[32,3],[32,2],[32,1],[32,0],[34,2],[34,1],[35,3],[35,3],[35,2],[35,2],[35,2],[35,2],[35,2],[35,1],[35,2],[35,1],[35,1],[35,1],[35,1],[35,1],[35,1],[43,1],[45,1],[50,1],[44,1],[49,1],[49,1]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1: 
          this.$ = { rules: $$[$0-1] };
          if ($$[$0-3][0]) this.$.macros = $$[$0-3][0];
          if ($$[$0-3][1]) this.$.startConditions = $$[$0-3][1];
          if ($$[$0]) this.$.moduleInclude = $$[$0];
          if (yy.options) this.$.options = yy.options;
          if (yy.actionInclude) this.$.actionInclude = yy.actionInclude;
          delete yy.options;
          delete yy.actionInclude;
          return this.$; 
        
break;
case 2: this.$ = null; 
break;
case 3: this.$ = null; 
break;
case 4: this.$ = $$[$0-1]; 
break;
case 5:
          this.$ = $$[$0];
          if ('length' in $$[$0-1]) {
            this.$[0] = this.$[0] || {};
            this.$[0][$$[$0-1][0]] = $$[$0-1][1];
          } else {
            this.$[1] = this.$[1] || {};
            for (var name in $$[$0-1]) {
              this.$[1][name] = $$[$0-1][name];
            }
          }
        
break;
case 6: yy.actionInclude += $$[$0-1]; this.$ = $$[$0]; 
break;
case 7: yy.actionInclude = ''; this.$ = [null,null]; 
break;
case 8: this.$ = [$$[$0-1], $$[$0]]; 
break;
case 9: this.$ = $$[$0]; 
break;
case 10: this.$ = $$[$0]; 
break;
case 11: this.$ = {}; this.$[$$[$0]] = 0; 
break;
case 12: this.$ = $$[$0-1]; this.$[$$[$0]] = 0; 
break;
case 13: this.$ = {}; this.$[$$[$0]] = 1; 
break;
case 14: this.$ = $$[$0-1]; this.$[$$[$0]] = 1; 
break;
case 15: this.$ = $$[$0-1]; this.$.push($$[$0]); 
break;
case 16: this.$ = [$$[$0]]; 
break;
case 17: this.$ = $$[$0-2] ? [$$[$0-2], $$[$0-1], $$[$0]] : [$$[$0-1],$$[$0]]; 
break;
case 18:this.$ = $$[$0-1];
break;
case 19:this.$ = $$[$0];
break;
case 20:this.$ = '';
break;
case 21:this.$ = $$[$0];
break;
case 22:this.$ = $$[$0-4]+$$[$0-3]+$$[$0-2]+$$[$0-1]+$$[$0];
break;
case 23:this.$ = $$[$0-3] + $$[$0-2] + $$[$0-1] + $$[$0];
break;
case 24: this.$ = yytext; 
break;
case 25: this.$ = $$[$0-1]+$$[$0]; 
break;
case 26: this.$ = $$[$0-1]; 
break;
case 27: this.$ = ['*']; 
break;
case 29: this.$ = [$$[$0]]; 
break;
case 30: this.$ = $$[$0-2]; this.$.push($$[$0]); 
break;
case 31:
          this.$ = $$[$0];
          if (!(yy.options && yy.options.flex) && this.$.match(/[\w\d]$/) && !this.$.match(/\\(r|f|n|t|v|s|b|c[A-Z]|x[0-9A-F]{2}|u[a-fA-F0-9]{4}|[0-7]{1,3})$/)) {
              this.$ += "\\b";
          }
        
break;
case 32: this.$ = $$[$0-2] + '|' + $$[$0]; 
break;
case 33: this.$ = $$[$0-1] + '|'; 
break;
case 35: this.$ = '' 
break;
case 36: this.$ = $$[$0-1] + $$[$0]; 
break;
case 38: this.$ = '(' + $$[$0-1] + ')'; 
break;
case 39: this.$ = $$[$0-2] + $$[$0-1] + ')'; 
break;
case 40: this.$ = $$[$0-1] + '+'; 
break;
case 41: this.$ = $$[$0-1] + '*'; 
break;
case 42: this.$ = $$[$0-1] + '?'; 
break;
case 43: this.$ = '(?=' + $$[$0] + ')'; 
break;
case 44: this.$ = '(?!' + $$[$0] + ')'; 
break;
case 46: this.$ = $$[$0-1] + $$[$0]; 
break;
case 48: this.$ = '.'; 
break;
case 49: this.$ = '^'; 
break;
case 50: this.$ = '$'; 
break;
case 54: this.$ = yytext; 
break;
case 55: this.$ = yytext; 
break;
case 56: this.$ = yytext; 
break;
case 57: this.$ = prepareString(yytext.substr(1, yytext.length - 2)); 
break;
}
},
table: [{3:1,4:2,5:[2,7],10:3,11:[1,4],12:[1,5],14:[1,6],16:[1,7]},{1:[3]},{5:[1,8]},{4:9,5:[2,7],10:3,11:[1,4],12:[1,5],14:[1,6],16:[1,7]},{4:10,5:[2,7],10:3,11:[1,4],12:[1,5],14:[1,6],16:[1,7]},{5:[2,35],11:[2,35],12:[2,35],13:11,14:[2,35],16:[2,35],32:12,33:[2,35],34:13,35:14,36:[1,15],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{15:31,18:[1,32]},{17:33,18:[1,34]},{6:35,11:[2,28],19:36,20:37,22:[2,28],27:[1,38],33:[2,28],36:[2,28],38:[2,28],41:[2,28],42:[2,28],46:[2,28],47:[2,28],48:[2,28],51:[2,28],52:[2,28],53:[2,28],55:[2,28],56:[2,28]},{5:[2,5]},{5:[2,6]},{5:[2,8],11:[2,8],12:[2,8],14:[2,8],16:[2,8]},{5:[2,31],11:[2,31],12:[2,31],14:[2,31],16:[2,31],22:[2,31],33:[1,39]},{5:[2,34],11:[2,34],12:[2,34],14:[2,34],16:[2,34],22:[2,34],33:[2,34],35:40,36:[1,15],37:[2,34],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{5:[2,37],11:[2,37],12:[2,37],14:[2,37],16:[2,37],22:[2,37],30:[1,42],33:[2,37],36:[2,37],37:[2,37],38:[2,37],39:[1,41],40:[1,43],41:[2,37],42:[2,37],44:44,46:[2,37],47:[2,37],48:[2,37],51:[2,37],52:[2,37],53:[2,37],54:[1,45],55:[2,37],56:[2,37]},{32:46,33:[2,35],34:13,35:14,36:[1,15],37:[2,35],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{32:47,33:[2,35],34:13,35:14,36:[1,15],37:[2,35],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{35:48,36:[1,15],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{35:49,36:[1,15],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{5:[2,45],11:[2,45],12:[2,45],14:[2,45],16:[2,45],22:[2,45],30:[2,45],33:[2,45],36:[2,45],37:[2,45],38:[2,45],39:[2,45],40:[2,45],41:[2,45],42:[2,45],46:[2,45],47:[2,45],48:[2,45],51:[2,45],52:[2,45],53:[2,45],54:[2,45],55:[2,45],56:[2,45]},{5:[2,47],11:[2,47],12:[2,47],14:[2,47],16:[2,47],22:[2,47],30:[2,47],33:[2,47],36:[2,47],37:[2,47],38:[2,47],39:[2,47],40:[2,47],41:[2,47],42:[2,47],46:[2,47],47:[2,47],48:[2,47],51:[2,47],52:[2,47],53:[2,47],54:[2,47],55:[2,47],56:[2,47]},{5:[2,48],11:[2,48],12:[2,48],14:[2,48],16:[2,48],22:[2,48],30:[2,48],33:[2,48],36:[2,48],37:[2,48],38:[2,48],39:[2,48],40:[2,48],41:[2,48],42:[2,48],46:[2,48],47:[2,48],48:[2,48],51:[2,48],52:[2,48],53:[2,48],54:[2,48],55:[2,48],56:[2,48]},{5:[2,49],11:[2,49],12:[2,49],14:[2,49],16:[2,49],22:[2,49],30:[2,49],33:[2,49],36:[2,49],37:[2,49],38:[2,49],39:[2,49],40:[2,49],41:[2,49],42:[2,49],46:[2,49],47:[2,49],48:[2,49],51:[2,49],52:[2,49],53:[2,49],54:[2,49],55:[2,49],56:[2,49]},{5:[2,50],11:[2,50],12:[2,50],14:[2,50],16:[2,50],22:[2,50],30:[2,50],33:[2,50],36:[2,50],37:[2,50],38:[2,50],39:[2,50],40:[2,50],41:[2,50],42:[2,50],46:[2,50],47:[2,50],48:[2,50],51:[2,50],52:[2,50],53:[2,50],54:[2,50],55:[2,50],56:[2,50]},{5:[2,51],11:[2,51],12:[2,51],14:[2,51],16:[2,51],22:[2,51],30:[2,51],33:[2,51],36:[2,51],37:[2,51],38:[2,51],39:[2,51],40:[2,51],41:[2,51],42:[2,51],46:[2,51],47:[2,51],48:[2,51],51:[2,51],52:[2,51],53:[2,51],54:[2,51],55:[2,51],56:[2,51]},{5:[2,52],11:[2,52],12:[2,52],14:[2,52],16:[2,52],22:[2,52],30:[2,52],33:[2,52],36:[2,52],37:[2,52],38:[2,52],39:[2,52],40:[2,52],41:[2,52],42:[2,52],46:[2,52],47:[2,52],48:[2,52],51:[2,52],52:[2,52],53:[2,52],54:[2,52],55:[2,52],56:[2,52]},{5:[2,53],11:[2,53],12:[2,53],14:[2,53],16:[2,53],22:[2,53],30:[2,53],33:[2,53],36:[2,53],37:[2,53],38:[2,53],39:[2,53],40:[2,53],41:[2,53],42:[2,53],46:[2,53],47:[2,53],48:[2,53],51:[2,53],52:[2,53],53:[2,53],54:[2,53],55:[2,53],56:[2,53]},{5:[2,54],11:[2,54],12:[2,54],14:[2,54],16:[2,54],22:[2,54],30:[2,54],33:[2,54],36:[2,54],37:[2,54],38:[2,54],39:[2,54],40:[2,54],41:[2,54],42:[2,54],46:[2,54],47:[2,54],48:[2,54],51:[2,54],52:[2,54],53:[2,54],54:[2,54],55:[2,54],56:[2,54]},{5:[2,57],11:[2,57],12:[2,57],14:[2,57],16:[2,57],22:[2,57],30:[2,57],33:[2,57],36:[2,57],37:[2,57],38:[2,57],39:[2,57],40:[2,57],41:[2,57],42:[2,57],46:[2,57],47:[2,57],48:[2,57],51:[2,57],52:[2,57],53:[2,57],54:[2,57],55:[2,57],56:[2,57]},{5:[2,58],11:[2,58],12:[2,58],14:[2,58],16:[2,58],22:[2,58],30:[2,58],33:[2,58],36:[2,58],37:[2,58],38:[2,58],39:[2,58],40:[2,58],41:[2,58],42:[2,58],46:[2,58],47:[2,58],48:[2,58],51:[2,58],52:[2,58],53:[2,58],54:[2,58],55:[2,58],56:[2,58]},{5:[2,55],11:[2,55],12:[2,55],14:[2,55],16:[2,55],22:[2,55],30:[2,55],33:[2,55],36:[2,55],37:[2,55],38:[2,55],39:[2,55],40:[2,55],41:[2,55],42:[2,55],46:[2,55],47:[2,55],48:[2,55],51:[2,55],52:[2,55],53:[2,55],54:[2,55],55:[2,55],56:[2,55]},{5:[2,9],11:[2,9],12:[2,9],14:[2,9],16:[2,9],18:[1,50]},{5:[2,11],11:[2,11],12:[2,11],14:[2,11],16:[2,11],18:[2,11]},{5:[2,10],11:[2,10],12:[2,10],14:[2,10],16:[2,10],18:[1,51]},{5:[2,13],11:[2,13],12:[2,13],14:[2,13],16:[2,13],18:[2,13]},{5:[1,55],7:52,8:[1,54],11:[2,28],19:53,20:37,22:[2,28],27:[1,38],33:[2,28],36:[2,28],38:[2,28],41:[2,28],42:[2,28],46:[2,28],47:[2,28],48:[2,28],51:[2,28],52:[2,28],53:[2,28],55:[2,28],56:[2,28]},{5:[2,16],8:[2,16],11:[2,16],22:[2,16],27:[2,16],33:[2,16],36:[2,16],38:[2,16],41:[2,16],42:[2,16],46:[2,16],47:[2,16],48:[2,16],51:[2,16],52:[2,16],53:[2,16],55:[2,16],56:[2,16]},{11:[2,35],13:56,22:[2,35],32:12,33:[2,35],34:13,35:14,36:[1,15],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{12:[1,59],28:57,30:[1,58]},{5:[2,33],11:[2,33],12:[2,33],14:[2,33],16:[2,33],22:[2,33],33:[2,33],34:60,35:14,36:[1,15],37:[2,33],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{5:[2,36],11:[2,36],12:[2,36],14:[2,36],16:[2,36],22:[2,36],30:[1,42],33:[2,36],36:[2,36],37:[2,36],38:[2,36],39:[1,41],40:[1,43],41:[2,36],42:[2,36],44:44,46:[2,36],47:[2,36],48:[2,36],51:[2,36],52:[2,36],53:[2,36],54:[1,45],55:[2,36],56:[2,36]},{5:[2,40],11:[2,40],12:[2,40],14:[2,40],16:[2,40],22:[2,40],30:[2,40],33:[2,40],36:[2,40],37:[2,40],38:[2,40],39:[2,40],40:[2,40],41:[2,40],42:[2,40],46:[2,40],47:[2,40],48:[2,40],51:[2,40],52:[2,40],53:[2,40],54:[2,40],55:[2,40],56:[2,40]},{5:[2,41],11:[2,41],12:[2,41],14:[2,41],16:[2,41],22:[2,41],30:[2,41],33:[2,41],36:[2,41],37:[2,41],38:[2,41],39:[2,41],40:[2,41],41:[2,41],42:[2,41],46:[2,41],47:[2,41],48:[2,41],51:[2,41],52:[2,41],53:[2,41],54:[2,41],55:[2,41],56:[2,41]},{5:[2,42],11:[2,42],12:[2,42],14:[2,42],16:[2,42],22:[2,42],30:[2,42],33:[2,42],36:[2,42],37:[2,42],38:[2,42],39:[2,42],40:[2,42],41:[2,42],42:[2,42],46:[2,42],47:[2,42],48:[2,42],51:[2,42],52:[2,42],53:[2,42],54:[2,42],55:[2,42],56:[2,42]},{5:[2,46],11:[2,46],12:[2,46],14:[2,46],16:[2,46],22:[2,46],30:[2,46],33:[2,46],36:[2,46],37:[2,46],38:[2,46],39:[2,46],40:[2,46],41:[2,46],42:[2,46],46:[2,46],47:[2,46],48:[2,46],51:[2,46],52:[2,46],53:[2,46],54:[2,46],55:[2,46],56:[2,46]},{5:[2,56],11:[2,56],12:[2,56],14:[2,56],16:[2,56],22:[2,56],30:[2,56],33:[2,56],36:[2,56],37:[2,56],38:[2,56],39:[2,56],40:[2,56],41:[2,56],42:[2,56],46:[2,56],47:[2,56],48:[2,56],51:[2,56],52:[2,56],53:[2,56],54:[2,56],55:[2,56],56:[2,56]},{33:[1,39],37:[1,61]},{33:[1,39],37:[1,62]},{5:[2,43],11:[2,43],12:[2,43],14:[2,43],16:[2,43],22:[2,43],30:[1,42],33:[2,43],36:[2,43],37:[2,43],38:[2,43],39:[1,41],40:[1,43],41:[2,43],42:[2,43],44:44,46:[2,43],47:[2,43],48:[2,43],51:[2,43],52:[2,43],53:[2,43],54:[1,45],55:[2,43],56:[2,43]},{5:[2,44],11:[2,44],12:[2,44],14:[2,44],16:[2,44],22:[2,44],30:[1,42],33:[2,44],36:[2,44],37:[2,44],38:[2,44],39:[1,41],40:[1,43],41:[2,44],42:[2,44],44:44,46:[2,44],47:[2,44],48:[2,44],51:[2,44],52:[2,44],53:[2,44],54:[1,45],55:[2,44],56:[2,44]},{5:[2,12],11:[2,12],12:[2,12],14:[2,12],16:[2,12],18:[2,12]},{5:[2,14],11:[2,14],12:[2,14],14:[2,14],16:[2,14],18:[2,14]},{1:[2,1]},{5:[2,15],8:[2,15],11:[2,15],22:[2,15],27:[2,15],33:[2,15],36:[2,15],38:[2,15],41:[2,15],42:[2,15],46:[2,15],47:[2,15],48:[2,15],51:[2,15],52:[2,15],53:[2,15],55:[2,15],56:[2,15]},{1:[2,2]},{8:[1,63],9:[1,64]},{11:[1,67],21:65,22:[1,66]},{29:[1,68],31:[1,69]},{29:[1,70]},{29:[2,29],31:[2,29]},{5:[2,32],11:[2,32],12:[2,32],14:[2,32],16:[2,32],22:[2,32],33:[2,32],35:40,36:[1,15],37:[2,32],38:[1,16],41:[1,17],42:[1,18],43:19,45:20,46:[1,21],47:[1,22],48:[1,23],49:24,50:25,51:[1,26],52:[1,27],53:[1,30],55:[1,28],56:[1,29]},{5:[2,38],11:[2,38],12:[2,38],14:[2,38],16:[2,38],22:[2,38],30:[2,38],33:[2,38],36:[2,38],37:[2,38],38:[2,38],39:[2,38],40:[2,38],41:[2,38],42:[2,38],46:[2,38],47:[2,38],48:[2,38],51:[2,38],52:[2,38],53:[2,38],54:[2,38],55:[2,38],56:[2,38]},{5:[2,39],11:[2,39],12:[2,39],14:[2,39],16:[2,39],22:[2,39],30:[2,39],33:[2,39],36:[2,39],37:[2,39],38:[2,39],39:[2,39],40:[2,39],41:[2,39],42:[2,39],46:[2,39],47:[2,39],48:[2,39],51:[2,39],52:[2,39],53:[2,39],54:[2,39],55:[2,39],56:[2,39]},{1:[2,3]},{8:[1,71]},{5:[2,17],8:[2,17],11:[2,17],22:[2,17],27:[2,17],33:[2,17],36:[2,17],38:[2,17],41:[2,17],42:[2,17],46:[2,17],47:[2,17],48:[2,17],51:[2,17],52:[2,17],53:[2,17],55:[2,17],56:[2,17]},{22:[2,20],23:72,24:[2,20],25:73,26:[1,74]},{5:[2,19],8:[2,19],11:[2,19],22:[2,19],27:[2,19],33:[2,19],36:[2,19],38:[2,19],41:[2,19],42:[2,19],46:[2,19],47:[2,19],48:[2,19],51:[2,19],52:[2,19],53:[2,19],55:[2,19],56:[2,19]},{11:[2,26],22:[2,26],33:[2,26],36:[2,26],38:[2,26],41:[2,26],42:[2,26],46:[2,26],47:[2,26],48:[2,26],51:[2,26],52:[2,26],53:[2,26],55:[2,26],56:[2,26]},{12:[1,75]},{11:[2,27],22:[2,27],33:[2,27],36:[2,27],38:[2,27],41:[2,27],42:[2,27],46:[2,27],47:[2,27],48:[2,27],51:[2,27],52:[2,27],53:[2,27],55:[2,27],56:[2,27]},{1:[2,4]},{22:[1,77],24:[1,76]},{22:[2,21],24:[2,21],26:[1,78]},{22:[2,24],24:[2,24],26:[2,24]},{29:[2,30],31:[2,30]},{5:[2,18],8:[2,18],11:[2,18],22:[2,18],27:[2,18],33:[2,18],36:[2,18],38:[2,18],41:[2,18],42:[2,18],46:[2,18],47:[2,18],48:[2,18],51:[2,18],52:[2,18],53:[2,18],55:[2,18],56:[2,18]},{22:[2,20],23:79,24:[2,20],25:73,26:[1,74]},{22:[2,25],24:[2,25],26:[2,25]},{22:[1,77],24:[1,80]},{22:[2,23],24:[2,23],25:81,26:[1,74]},{22:[2,22],24:[2,22],26:[1,78]}],
defaultActions: {9:[2,5],10:[2,6],52:[2,1],54:[2,2],63:[2,3],71:[2,4]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        throw new Error(str);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == 'undefined') {
        this.lexer.yylloc = {};
    }
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === 'function') {
        this.parseError = this.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || EOF;
        if (typeof token !== 'number') {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (this.lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + this.lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: this.lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: this.lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};


function encodeRE (s) {
    return s.replace(/([.*+?^${}()|[\]\/\\])/g, '\\$1').replace(/\\\\u([a-fA-F0-9]{4})/g,'\\u$1');
}

function prepareString (s) {
    // unescape slashes
    s = s.replace(/\\\\/g, "\\");
    s = encodeRE(s);
    return s;
};

/* generated by jison-lex 0.2.1 */
var lexer = (function(){
var lexer = {

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input) {
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len - 1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:return 26;
break;
case 1:return 26;
break;
case 2:return 26; // regexp with braces or quotes (and no spaces)
break;
case 3:return 26;
break;
case 4:return 26;
break;
case 5:return 26;
break;
case 6:return 26;
break;
case 7:yy.depth++; return 22
break;
case 8:yy.depth == 0 ? this.begin('trail') : yy.depth--; return 24
break;
case 9:return 12;
break;
case 10:this.popState(); return 29;
break;
case 11:return 31;
break;
case 12:return 30;
break;
case 13:/* */
break;
case 14:/* */
break;
case 15:this.begin('indented')
break;
case 16:this.begin('code'); return 5
break;
case 17:return 56
break;
case 18:yy.options[yy_.yytext] = true
break;
case 19:this.begin('INITIAL')
break;
case 20:this.begin('INITIAL')
break;
case 21:/* empty */
break;
case 22:return 18
break;
case 23:this.begin('INITIAL')
break;
case 24:this.begin('INITIAL')
break;
case 25:/* empty */
break;
case 26:this.begin('rules')
break;
case 27:yy.depth = 0; this.begin('action'); return 22
break;
case 28:this.begin('trail'); yy_.yytext = yy_.yytext.substr(2, yy_.yytext.length-4);return 11
break;
case 29:yy_.yytext = yy_.yytext.substr(2, yy_.yytext.length-4); return 11
break;
case 30:this.begin('rules'); return 11
break;
case 31:/* ignore */
break;
case 32:/* ignore */
break;
case 33:/* */
break;
case 34:/* */
break;
case 35:return 12;
break;
case 36:yy_.yytext = yy_.yytext.replace(/\\"/g,'"'); return 55;
break;
case 37:yy_.yytext = yy_.yytext.replace(/\\'/g,"'"); return 55;
break;
case 38:return 33;
break;
case 39:return 52;
break;
case 40:return 38;
break;
case 41:return 38;
break;
case 42:return 38;
break;
case 43:return 36;
break;
case 44:return 37;
break;
case 45:return 39;
break;
case 46:return 30;
break;
case 47:return 40;
break;
case 48:return 47;
break;
case 49:return 31;
break;
case 50:return 48;
break;
case 51:this.begin('conditions'); return 27;
break;
case 52:return 42;
break;
case 53:return 41;
break;
case 54:return 53;
break;
case 55:yy_.yytext = yy_.yytext.replace(/^\\/g,''); return 53;
break;
case 56:return 48;
break;
case 57:return 46;
break;
case 58:yy.options = {}; this.begin('options');
break;
case 59:this.begin('start_condition'); return 14;
break;
case 60:this.begin('start_condition'); return 16;
break;
case 61:this.begin('rules'); return 5;
break;
case 62:return 54;
break;
case 63:return 51;
break;
case 64:return 22;
break;
case 65:return 24;
break;
case 66:/* ignore bad characters */
break;
case 67:return 8;
break;
case 68:return 9;
break;
}
},
rules: [/^(?:\/\*(.|\n|\r)*?\*\/)/,/^(?:\/\/.*)/,/^(?:\/[^ /]*?['"{}'][^ ]*?\/)/,/^(?:"(\\\\|\\"|[^"])*")/,/^(?:'(\\\\|\\'|[^'])*')/,/^(?:[/"'][^{}/"']+)/,/^(?:[^{}/"']+)/,/^(?:\{)/,/^(?:\})/,/^(?:([a-zA-Z_][a-zA-Z0-9_-]*))/,/^(?:>)/,/^(?:,)/,/^(?:\*)/,/^(?:(\r\n|\n|\r)+)/,/^(?:\s+(\r\n|\n|\r)+)/,/^(?:\s+)/,/^(?:%%)/,/^(?:[a-zA-Z0-9_]+)/,/^(?:([a-zA-Z_][a-zA-Z0-9_-]*))/,/^(?:(\r\n|\n|\r)+)/,/^(?:\s+(\r\n|\n|\r)+)/,/^(?:\s+)/,/^(?:([a-zA-Z_][a-zA-Z0-9_-]*))/,/^(?:(\r\n|\n|\r)+)/,/^(?:\s+(\r\n|\n|\r)+)/,/^(?:\s+)/,/^(?:.*(\r\n|\n|\r)+)/,/^(?:\{)/,/^(?:%\{(.|(\r\n|\n|\r))*?%\})/,/^(?:%\{(.|(\r\n|\n|\r))*?%\})/,/^(?:.+)/,/^(?:\/\*(.|\n|\r)*?\*\/)/,/^(?:\/\/.*)/,/^(?:(\r\n|\n|\r)+)/,/^(?:\s+)/,/^(?:([a-zA-Z_][a-zA-Z0-9_-]*))/,/^(?:"(\\\\|\\"|[^"])*")/,/^(?:'(\\\\|\\'|[^'])*')/,/^(?:\|)/,/^(?:\[(\\\\|\\\]|[^\]])*\])/,/^(?:\(\?:)/,/^(?:\(\?=)/,/^(?:\(\?!)/,/^(?:\()/,/^(?:\))/,/^(?:\+)/,/^(?:\*)/,/^(?:\?)/,/^(?:\^)/,/^(?:,)/,/^(?:<<EOF>>)/,/^(?:<)/,/^(?:\/!)/,/^(?:\/)/,/^(?:\\([0-7]{1,3}|[rfntvsSbBwWdD\\*+()${}|[\]\/.^?]|c[A-Z]|x[0-9A-F]{2}|u[a-fA-F0-9]{4}))/,/^(?:\\.)/,/^(?:\$)/,/^(?:\.)/,/^(?:%options\b)/,/^(?:%s\b)/,/^(?:%x\b)/,/^(?:%%)/,/^(?:\{\d+(,\s?\d+|,)?\})/,/^(?:\{([a-zA-Z_][a-zA-Z0-9_-]*)\})/,/^(?:\{)/,/^(?:\})/,/^(?:.)/,/^(?:$)/,/^(?:(.|(\r\n|\n|\r))+)/],
conditions: {"code":{"rules":[67,68],"inclusive":false},"start_condition":{"rules":[22,23,24,25,67],"inclusive":false},"options":{"rules":[18,19,20,21,67],"inclusive":false},"conditions":{"rules":[9,10,11,12,67],"inclusive":false},"action":{"rules":[0,1,2,3,4,5,6,7,8,67],"inclusive":false},"indented":{"rules":[27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67],"inclusive":true},"trail":{"rules":[26,29,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67],"inclusive":true},"rules":{"rules":[13,14,15,16,17,29,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67],"inclusive":true},"INITIAL":{"rules":[29,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67],"inclusive":true}}
};
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = lex;
exports.Parser = lex.Parser;
exports.parse = function () { return lex.parse.apply(lex, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require('_process'))
},{"_process":33,"fs":7,"path":32}],30:[function(require,module,exports){
module.exports = require('./lib').default;
},{"./lib":31}],31:[function(require,module,exports){
(function (Buffer){
'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.prepare = prepare;
exports.verifyHeader = verifyHeader;
exports.checkListIntegrity = checkListIntegrity;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var POINTER_SIZE_IN_BYTES = 4;
var MAX_HEIGHT = 32;

var HEADER_SIZE_IN_QUADS = 1 + MAX_HEIGHT * 2;
var HEADER_OFFSET_IN_QUADS = 1;

var HEIGHT_OFFSET_IN_QUADS = 0;
var PREV_OFFSET_IN_QUADS = 1;
var NEXT_OFFSET_IN_QUADS = 2;

var POINTER_SIZE_IN_QUADS = 1;
var POINTER_OVERHEAD_IN_QUADS = 2;

var MIN_FREEABLE_SIZE_IN_QUADS = 3;
var FIRST_BLOCK_OFFSET_IN_QUADS = HEADER_OFFSET_IN_QUADS + HEADER_SIZE_IN_QUADS + POINTER_OVERHEAD_IN_QUADS;

var MIN_FREEABLE_SIZE_IN_BYTES = 16;
var FIRST_BLOCK_OFFSET_IN_BYTES = FIRST_BLOCK_OFFSET_IN_QUADS * POINTER_SIZE_IN_BYTES;
var OVERHEAD_IN_BYTES = (FIRST_BLOCK_OFFSET_IN_QUADS + 1) * POINTER_SIZE_IN_BYTES;

var ALIGNMENT_IN_BYTES = 8;
var ALIGNMENT_MASK = ALIGNMENT_IN_BYTES - 1;

var UPDATES = new Int32Array(MAX_HEIGHT).fill(HEADER_OFFSET_IN_QUADS);

var Allocator = function () {

  /**
   * Initialize the allocator from the given Buffer or ArrayBuffer.
   */

  function Allocator(buffer) {
    var byteOffset = arguments.length <= 1 || arguments[1] === undefined ? 0 : arguments[1];
    var byteLength = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];

    _classCallCheck(this, Allocator);

    if (buffer instanceof Buffer) {
      this.buffer = buffer.buffer;
      this.byteOffset = buffer.byteOffset + byteOffset;
      this.byteLength = byteLength === 0 ? buffer.length : byteLength;
    } else if (buffer instanceof ArrayBuffer) {
      this.buffer = buffer;
      this.byteOffset = byteOffset;
      this.byteLength = byteLength === 0 ? buffer.byteLength - byteOffset : byteLength;
    } else {
      throw new TypeError('Expected buffer to be an instance of Buffer or ArrayBuffer');
    }

    this.int32Array = prepare(new Int32Array(this.buffer, this.byteOffset, bytesToQuads(this.byteLength)));
    checkListIntegrity(this.int32Array);
  }

  /**
   * Allocate a given number of bytes and return the offset.
   * If allocation fails, returns 0.
   */

  _createClass(Allocator, [{
    key: 'alloc',
    value: function alloc(numberOfBytes) {

      numberOfBytes = align(numberOfBytes);

      if (numberOfBytes < MIN_FREEABLE_SIZE_IN_BYTES) {
        numberOfBytes = MIN_FREEABLE_SIZE_IN_BYTES;
      } else if (numberOfBytes > this.byteLength) {
        throw new RangeError('Allocation size must be between ' + MIN_FREEABLE_SIZE_IN_BYTES + ' bytes and ' + (this.byteLength - OVERHEAD_IN_BYTES) + ' bytes');
      }

      var minimumSize = bytesToQuads(numberOfBytes);
      var int32Array = this.int32Array;
      var block = findFreeBlock(int32Array, minimumSize);
      if (block <= HEADER_OFFSET_IN_QUADS) {
        return 0;
      }
      var blockSize = readSize(int32Array, block);

      if (blockSize - (minimumSize + POINTER_OVERHEAD_IN_QUADS) >= MIN_FREEABLE_SIZE_IN_QUADS) {
        split(int32Array, block, minimumSize, blockSize);
      } else {
        remove(int32Array, block, blockSize);
      }

      return quadsToBytes(block);
    }

    /**
     * Allocate and clear the given number of bytes and return the offset.
     * If allocation fails, returns 0.
     */

  }, {
    key: 'calloc',
    value: function calloc(numberOfBytes) {

      if (numberOfBytes < MIN_FREEABLE_SIZE_IN_BYTES) {
        numberOfBytes = MIN_FREEABLE_SIZE_IN_BYTES;
      } else {
        numberOfBytes = align(numberOfBytes);
      }

      var address = this.alloc(numberOfBytes);
      if (address === 0) {
        // Not enough space
        return 0;
      }
      var int32Array = this.int32Array;
      var offset = bytesToQuads(address);
      var limit = numberOfBytes / 4;
      for (var i = 0; i < limit; i++) {
        int32Array[offset + i] = 0;
      }
      return address;
    }

    /**
     * Free a number of bytes from the given address.
     */

  }, {
    key: 'free',
    value: function free(address) {

      if ((address & ALIGNMENT_MASK) !== 0) {
        throw new RangeError('Address must be a multiple of (' + ALIGNMENT_IN_BYTES + ').');
      }

      if (address < FIRST_BLOCK_OFFSET_IN_BYTES || address > this.byteLength) {
        throw new RangeError('Address must be between ' + FIRST_BLOCK_OFFSET_IN_BYTES + ' and ' + (this.byteLength - OVERHEAD_IN_BYTES));
      }

      var int32Array = this.int32Array;
      var block = bytesToQuads(address);

      var blockSize = readSize(int32Array, block);

      /* istanbul ignore if  */
      if (blockSize < MIN_FREEABLE_SIZE_IN_QUADS || blockSize > (this.byteLength - OVERHEAD_IN_BYTES) / 4) {
        throw new RangeError('Invalid block: ' + block + ', got block size: ' + quadsToBytes(blockSize));
      }

      var preceding = getFreeBlockBefore(int32Array, block);
      var trailing = getFreeBlockAfter(int32Array, block);
      if (preceding !== 0) {
        if (trailing !== 0) {
          return quadsToBytes(insertMiddle(int32Array, preceding, block, blockSize, trailing));
        } else {
          return quadsToBytes(insertAfter(int32Array, preceding, block, blockSize));
        }
      } else if (trailing !== 0) {
        return quadsToBytes(insertBefore(int32Array, trailing, block, blockSize));
      } else {
        return quadsToBytes(insert(int32Array, block, blockSize));
      }
    }

    /**
     * Return the size of the block at the given address.
     */

  }, {
    key: 'sizeOf',
    value: function sizeOf(address) {
      if (address < FIRST_BLOCK_OFFSET_IN_BYTES || address > this.byteLength || typeof address !== 'number' || isNaN(address)) {
        throw new RangeError('Address must be between ' + FIRST_BLOCK_OFFSET_IN_BYTES + ' and ' + (this.byteLength - OVERHEAD_IN_BYTES));
      }

      if ((address & ALIGNMENT_MASK) !== 0) {
        throw new RangeError('Address must be a multiple of the pointer size (' + POINTER_SIZE_IN_BYTES + ').');
      }

      return quadsToBytes(readSize(this.int32Array, bytesToQuads(address)));
    }

    /**
     * Inspect the instance.
     */

  }, {
    key: 'inspect',
    value: function inspect() {
      return _inspect(this.int32Array);
    }
  }]);

  return Allocator;
}();

/**
 * Prepare the given int32Array and ensure it contains a valid header.
 */

exports.default = Allocator;
function prepare(int32Array) {
  if (!verifyHeader(int32Array)) {
    writeInitialHeader(int32Array);
  }
  return int32Array;
}

/**
 * Verify that the int32Array contains a valid header.
 */
function verifyHeader(int32Array) {
  return int32Array[HEADER_OFFSET_IN_QUADS - 1] === HEADER_SIZE_IN_QUADS && int32Array[HEADER_OFFSET_IN_QUADS + HEADER_SIZE_IN_QUADS] === HEADER_SIZE_IN_QUADS;
}

/**
 * Write the initial header for an empty int32Array.
 */
function writeInitialHeader(int32Array) {
  var header = HEADER_OFFSET_IN_QUADS;
  var headerSize = HEADER_SIZE_IN_QUADS;
  var block = FIRST_BLOCK_OFFSET_IN_QUADS;
  var blockSize = int32Array.length - (header + headerSize + POINTER_OVERHEAD_IN_QUADS + POINTER_SIZE_IN_QUADS);

  writeFreeBlockSize(int32Array, headerSize, header);
  int32Array[header + HEIGHT_OFFSET_IN_QUADS] = 1;
  int32Array[header + NEXT_OFFSET_IN_QUADS] = block;
  for (var _height = 1; _height < MAX_HEIGHT; _height++) {
    int32Array[header + NEXT_OFFSET_IN_QUADS + _height] = HEADER_OFFSET_IN_QUADS;
  }

  writeFreeBlockSize(int32Array, blockSize, block);
  int32Array[block + HEIGHT_OFFSET_IN_QUADS] = 1;
  int32Array[block + NEXT_OFFSET_IN_QUADS] = header;
}

/**
 * Check the integrity of the freelist in the given array.
 */
function checkListIntegrity(int32Array) {
  var block = FIRST_BLOCK_OFFSET_IN_QUADS;
  while (block < int32Array.length - POINTER_SIZE_IN_QUADS) {
    var _size = readSize(int32Array, block);
    /* istanbul ignore if  */
    if (_size < POINTER_OVERHEAD_IN_QUADS || _size >= int32Array.length - FIRST_BLOCK_OFFSET_IN_QUADS) {
      throw new Error('Got invalid sized chunk at ' + quadsToBytes(block) + ' (' + quadsToBytes(_size) + ' bytes).');
    } else if (isFree(int32Array, block)) {
      checkFreeBlockIntegrity(int32Array, block, _size);
    } else {
      checkUsedBlockIntegrity(int32Array, block, _size);
    }
    block += _size + POINTER_OVERHEAD_IN_QUADS;
  }
  return true;
}

function checkFreeBlockIntegrity(int32Array, block, blockSize) {
  /* istanbul ignore if  */
  if (int32Array[block - 1] !== int32Array[block + blockSize]) {
    throw new Error('Block length header does not match footer (' + quadsToBytes(int32Array[block - 1]) + ' vs ' + quadsToBytes(int32Array[block + blockSize]) + ').');
  }
  var height = int32Array[block + HEIGHT_OFFSET_IN_QUADS];
  /* istanbul ignore if  */
  if (height < 1 || height > MAX_HEIGHT) {
    throw new Error('Block ' + quadsToBytes(block) + ' height must be between 1 and ' + MAX_HEIGHT + ', got ' + height + '.');
  }
  for (var i = 0; i < height; i++) {
    var pointer = int32Array[block + NEXT_OFFSET_IN_QUADS + i];
    /* istanbul ignore if  */
    if (pointer >= FIRST_BLOCK_OFFSET_IN_QUADS && !isFree(int32Array, pointer)) {
      throw new Error('Block ' + quadsToBytes(block) + ' has a pointer to a non-free block (' + quadsToBytes(pointer) + ').');
    }
  }
  return true;
}

function checkUsedBlockIntegrity(int32Array, block, blockSize) {
  /* istanbul ignore if  */
  if (int32Array[block - 1] !== int32Array[block + blockSize]) {
    throw new Error('Block length header does not match footer (' + quadsToBytes(int32Array[block - 1]) + ' vs ' + quadsToBytes(int32Array[block + blockSize]) + ').');
  } else {
    return true;
  }
}

/**
 * Inspect the freelist in the given array.
 */
function _inspect(int32Array) {
  var blocks = [];
  var header = readListNode(int32Array, HEADER_OFFSET_IN_QUADS);
  var block = FIRST_BLOCK_OFFSET_IN_QUADS;
  while (block < int32Array.length - POINTER_SIZE_IN_QUADS) {
    var _size2 = readSize(int32Array, block);
    /* istanbul ignore if  */
    if (_size2 < POINTER_OVERHEAD_IN_QUADS || _size2 >= int32Array.length) {
      throw new Error('Got invalid sized chunk at ' + quadsToBytes(block) + ' (' + quadsToBytes(_size2) + ')');
    }
    if (isFree(int32Array, block)) {
      // Issue todo
      blocks.push(readListNode(int32Array, block));
    } else {
      blocks.push({
        type: 'used',
        offset: quadsToBytes(block),
        size: quadsToBytes(_size2)
      });
    }
    block += _size2 + POINTER_OVERHEAD_IN_QUADS;
  }
  return { header: header, blocks: blocks };
}

/**
 * Convert quads to bytes.
 */
exports.inspect = _inspect;
function quadsToBytes(num) {
  return num * POINTER_SIZE_IN_BYTES;
}

/**
 * Convert bytes to quads.
 */
function bytesToQuads(num) {
  return Math.ceil(num / POINTER_SIZE_IN_BYTES);
}

/**
 * Align the given value to 8 bytes.
 */
function align(value) {
  return value + ALIGNMENT_MASK & ~ALIGNMENT_MASK;
}

/**
 * Read the list pointers for a given block.
 */
function readListNode(int32Array, block) {

  var height = int32Array[block + HEIGHT_OFFSET_IN_QUADS];
  var pointers = [];
  for (var i = 0; i < height; i++) {
    pointers.push(quadsToBytes(int32Array[block + NEXT_OFFSET_IN_QUADS + i]));
  }

  return {
    type: 'free',
    offset: quadsToBytes(block),
    height: height,
    pointers: pointers,
    size: quadsToBytes(int32Array[block - 1])
  };
}

/**
 * Read the size (in quads) of the block at the given address.
 */
function readSize(int32Array, block) {
  return Math.abs(int32Array[block - 1]);
}

/**
 * Write the size of the block at the given address.
 * Note: This ONLY works for free blocks, not blocks in use.
 */
function writeFreeBlockSize(int32Array, size, block) {

  int32Array[block - 1] = size;
  int32Array[block + size] = size;
}

/**
 * Populate the `UPDATES` array with the offset of the last item in each
 * list level, *before* a node of at least the given size.
 */
function findPredecessors(int32Array, minimumSize) {

  var listHeight = int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS];

  var node = HEADER_OFFSET_IN_QUADS;

  for (var _height2 = listHeight; _height2 > 0; _height2--) {
    var next = node + NEXT_OFFSET_IN_QUADS + (_height2 - 1);
    while (int32Array[next] >= FIRST_BLOCK_OFFSET_IN_QUADS && int32Array[int32Array[next] - 1] < minimumSize) {
      node = int32Array[next];
      next = node + NEXT_OFFSET_IN_QUADS + (_height2 - 1);
    }
    UPDATES[_height2 - 1] = node;
  }
}

/**
 * Find a free block with at least the given size and return its offset in quads.
 */
function findFreeBlock(int32Array, minimumSize) {

  var block = HEADER_OFFSET_IN_QUADS;

  for (var _height3 = int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS]; _height3 > 0; _height3--) {
    var next = int32Array[block + NEXT_OFFSET_IN_QUADS + (_height3 - 1)];

    while (next !== HEADER_OFFSET_IN_QUADS && int32Array[next - 1] < minimumSize) {
      block = next;
      next = int32Array[block + NEXT_OFFSET_IN_QUADS + (_height3 - 1)];
    }
  }

  block = int32Array[block + NEXT_OFFSET_IN_QUADS];
  if (block === HEADER_OFFSET_IN_QUADS) {
    return block;
  } else {
    return block;
  }
}

/**
 * Split the given block after a certain number of bytes and add the second half to the freelist.
 */
function split(int32Array, block, firstSize, blockSize) {

  var second = block + firstSize + POINTER_OVERHEAD_IN_QUADS;
  var secondSize = blockSize - (second - block);

  remove(int32Array, block, blockSize);

  int32Array[block - 1] = -firstSize;
  int32Array[block + firstSize] = -firstSize;

  int32Array[second - 1] = -secondSize;
  int32Array[second + secondSize] = -secondSize;

  insert(int32Array, second, secondSize);
}

/**
 * Remove the given block from the freelist and mark it as allocated.
 */
function remove(int32Array, block, blockSize) {
  findPredecessors(int32Array, blockSize);

  var node = int32Array[UPDATES[0] + NEXT_OFFSET_IN_QUADS];

  while (node !== block && node !== HEADER_OFFSET_IN_QUADS && int32Array[node - 1] <= blockSize) {
    for (var _height4 = int32Array[node + HEIGHT_OFFSET_IN_QUADS] - 1; _height4 >= 0; _height4--) {
      if (int32Array[node + NEXT_OFFSET_IN_QUADS + _height4] === block) {
        UPDATES[_height4] = node;
      }
    }
    node = int32Array[node + NEXT_OFFSET_IN_QUADS];
  }

  /* istanbul ignore if  */
  if (node !== block) {
    throw new Error('Could not find block to remove.');
  }

  var listHeight = int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS];
  for (var _height5 = 0; _height5 < listHeight; _height5++) {
    var next = int32Array[UPDATES[_height5] + NEXT_OFFSET_IN_QUADS + _height5];
    if (next !== block) {
      break;
    }
    int32Array[UPDATES[_height5] + NEXT_OFFSET_IN_QUADS + _height5] = int32Array[block + NEXT_OFFSET_IN_QUADS + _height5];
  }

  while (listHeight > 0 && int32Array[HEADER_OFFSET_IN_QUADS + NEXT_OFFSET_IN_QUADS + (listHeight - 1)] === HEADER_OFFSET_IN_QUADS) {
    listHeight--;
    int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS] = listHeight;
  }
  // invert the size sign to signify an allocated block
  int32Array[block - 1] = -blockSize;
  int32Array[block + blockSize] = -blockSize;
}

/**
 * Iterate all of the free blocks in the list, looking for pointers to the given block.
 */
function hasPointersTo(int32Array, block) {
  var next = FIRST_BLOCK_OFFSET_IN_QUADS;

  while (next < int32Array.length - POINTER_SIZE_IN_QUADS) {
    if (isFree(int32Array, next)) {
      for (var _height6 = int32Array[next + HEIGHT_OFFSET_IN_QUADS] - 1; _height6 >= 0; _height6--) {
        var pointer = int32Array[next + NEXT_OFFSET_IN_QUADS + _height6];
        /* istanbul ignore if  */
        if (pointer === block) {
          return true;
        }
      }
    }
    next += readSize(int32Array, next) + POINTER_OVERHEAD_IN_QUADS;
  }
  return false;
}

/**
 * Determine whether the block at the given address is free or not.
 */
function isFree(int32Array, block) {

  /* istanbul ignore if  */
  if (block < HEADER_SIZE_IN_QUADS) {
    return false;
  }

  var size = int32Array[block - POINTER_SIZE_IN_QUADS];

  if (size < 0) {
    return false;
  } else {
    return true;
  }
}

/**
 * Get the address of the block before the given one and return the address *if it is free*,
 * otherwise 0.
 */
function getFreeBlockBefore(int32Array, block) {

  if (block <= FIRST_BLOCK_OFFSET_IN_QUADS) {
    return 0;
  }
  var beforeSize = int32Array[block - POINTER_OVERHEAD_IN_QUADS];

  if (beforeSize < POINTER_OVERHEAD_IN_QUADS) {
    return 0;
  }
  return block - (POINTER_OVERHEAD_IN_QUADS + beforeSize);
}

/**
 * Get the address of the block after the given one and return its address *if it is free*,
 * otherwise 0.
 */
function getFreeBlockAfter(int32Array, block) {

  var blockSize = readSize(int32Array, block);
  if (block + blockSize + POINTER_OVERHEAD_IN_QUADS >= int32Array.length - 2) {
    // Block is the last in the list.
    return 0;
  }
  var next = block + blockSize + POINTER_OVERHEAD_IN_QUADS;
  var nextSize = int32Array[next - POINTER_SIZE_IN_QUADS];

  if (nextSize < POINTER_OVERHEAD_IN_QUADS) {
    return 0;
  }
  return next;
}

/**
 * Insert the given block into the freelist and return the number of bytes that were freed.
 */
function insert(int32Array, block, blockSize) {

  findPredecessors(int32Array, blockSize);

  var blockHeight = generateHeight(int32Array, block, blockSize);
  var listHeight = int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS];

  for (var _height7 = 1; _height7 <= blockHeight; _height7++) {
    var update = UPDATES[_height7 - 1] + NEXT_OFFSET_IN_QUADS + (_height7 - 1);

    int32Array[block + NEXT_OFFSET_IN_QUADS + (_height7 - 1)] = int32Array[update];
    int32Array[update] = block;
    UPDATES[_height7 - 1] = HEADER_OFFSET_IN_QUADS;
  }

  int32Array[block - 1] = blockSize;
  int32Array[block + blockSize] = blockSize;
  return blockSize;
}

/**
 * Insert the given block into the freelist before the given free block,
 * joining them together, returning the number of bytes which were freed.
 */
function insertBefore(int32Array, trailing, block, blockSize) {

  var trailingSize = readSize(int32Array, trailing);

  remove(int32Array, trailing, trailingSize);
  var size = blockSize + trailingSize + POINTER_OVERHEAD_IN_QUADS;
  int32Array[block - POINTER_SIZE_IN_QUADS] = -size;
  int32Array[trailing + trailingSize] = -size;
  insert(int32Array, block, size);
  return blockSize;
}

/**
 * Insert the given block into the freelist in between the given free blocks,
 * joining them together, returning the number of bytes which were freed.
 */
function insertMiddle(int32Array, preceding, block, blockSize, trailing) {

  var precedingSize = readSize(int32Array, preceding);
  var trailingSize = readSize(int32Array, trailing);
  var size = trailing - preceding + trailingSize;

  remove(int32Array, preceding, precedingSize);
  remove(int32Array, trailing, trailingSize);
  int32Array[preceding - POINTER_SIZE_IN_QUADS] = -size;
  int32Array[trailing + trailingSize] = -size;
  insert(int32Array, preceding, size);
  return blockSize;
}

/**
 * Insert the given block into the freelist after the given free block,
 * joining them together, returning the number of bytes which were freed.
 */
function insertAfter(int32Array, preceding, block, blockSize) {

  var precedingSize = block - preceding - POINTER_OVERHEAD_IN_QUADS;

  var size = block - preceding + blockSize;
  remove(int32Array, preceding, precedingSize);
  int32Array[preceding - POINTER_SIZE_IN_QUADS] = -size;
  int32Array[block + blockSize] = -size;
  insert(int32Array, preceding, size);
  return blockSize;
}

/**
 * Generate a random height for a block, growing the list height by 1 if required.
 */
function generateHeight(int32Array, block, blockSize) {

  var listHeight = int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS];
  var height = randomHeight();

  if (blockSize - 1 < height + 1) {
    height = blockSize - 2;
  }

  if (height > listHeight) {
    var newHeight = listHeight + 1;

    int32Array[HEADER_OFFSET_IN_QUADS + HEIGHT_OFFSET_IN_QUADS] = newHeight;
    int32Array[HEADER_OFFSET_IN_QUADS + NEXT_OFFSET_IN_QUADS + (newHeight - 1)] = HEADER_OFFSET_IN_QUADS;
    UPDATES[newHeight] = HEADER_OFFSET_IN_QUADS;
    int32Array[block + HEIGHT_OFFSET_IN_QUADS] = newHeight;
    return newHeight;
  } else {
    int32Array[block + HEIGHT_OFFSET_IN_QUADS] = height;
    return height;
  }
}

/**
 * Generate a random height for a new block.
 */
function randomHeight() {
  var height = 1;
  for (var r = Math.ceil(Math.random() * 2147483648); (r & 1) === 1 && height < MAX_HEIGHT; r >>= 1) {
    height++;
    Math.ceil(Math.random() * 2147483648);
  }
  return height;
}
}).call(this,require("buffer").Buffer)
},{"buffer":8}],32:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// Split a filename into [root, dir, basename, ext], unix version
// 'root' is just a slash, or nothing.
var splitPathRe =
    /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
var splitPath = function(filename) {
  return splitPathRe.exec(filename).slice(1);
};

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function(path) {
  var result = splitPath(path),
      root = result[0],
      dir = result[1];

  if (!root && !dir) {
    // No dirname whatsoever
    return '.';
  }

  if (dir) {
    // It has a dirname, strip trailing slash
    dir = dir.substr(0, dir.length - 1);
  }

  return root + dir;
};


exports.basename = function(path, ext) {
  var f = splitPath(path)[2];
  // TODO: make this comparison case-insensitive on windows?
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};


exports.extname = function(path) {
  return splitPath(path)[3];
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))
},{"_process":33}],33:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],34:[function(require,module,exports){
/*
 * Copyright 2009-2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE.txt or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
exports.SourceMapGenerator = require('./source-map/source-map-generator').SourceMapGenerator;
exports.SourceMapConsumer = require('./source-map/source-map-consumer').SourceMapConsumer;
exports.SourceNode = require('./source-map/source-node').SourceNode;

},{"./source-map/source-map-consumer":40,"./source-map/source-map-generator":41,"./source-map/source-node":42}],35:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * A data structure which is a combination of an array and a set. Adding a new
   * member is O(1), testing for membership is O(1), and finding the index of an
   * element is O(1). Removing elements from the set is not supported. Only
   * strings are supported for membership.
   */
  function ArraySet() {
    this._array = [];
    this._set = {};
  }

  /**
   * Static method for creating ArraySet instances from an existing array.
   */
  ArraySet.fromArray = function ArraySet_fromArray(aArray, aAllowDuplicates) {
    var set = new ArraySet();
    for (var i = 0, len = aArray.length; i < len; i++) {
      set.add(aArray[i], aAllowDuplicates);
    }
    return set;
  };

  /**
   * Add the given string to this set.
   *
   * @param String aStr
   */
  ArraySet.prototype.add = function ArraySet_add(aStr, aAllowDuplicates) {
    var isDuplicate = this.has(aStr);
    var idx = this._array.length;
    if (!isDuplicate || aAllowDuplicates) {
      this._array.push(aStr);
    }
    if (!isDuplicate) {
      this._set[util.toSetString(aStr)] = idx;
    }
  };

  /**
   * Is the given string a member of this set?
   *
   * @param String aStr
   */
  ArraySet.prototype.has = function ArraySet_has(aStr) {
    return Object.prototype.hasOwnProperty.call(this._set,
                                                util.toSetString(aStr));
  };

  /**
   * What is the index of the given string in the array?
   *
   * @param String aStr
   */
  ArraySet.prototype.indexOf = function ArraySet_indexOf(aStr) {
    if (this.has(aStr)) {
      return this._set[util.toSetString(aStr)];
    }
    throw new Error('"' + aStr + '" is not in the set.');
  };

  /**
   * What is the element at the given index?
   *
   * @param Number aIdx
   */
  ArraySet.prototype.at = function ArraySet_at(aIdx) {
    if (aIdx >= 0 && aIdx < this._array.length) {
      return this._array[aIdx];
    }
    throw new Error('No element indexed by ' + aIdx);
  };

  /**
   * Returns the array representation of this set (which has the proper indices
   * indicated by indexOf). Note that this is a copy of the internal array used
   * for storing the members so that no one can mess with internal state.
   */
  ArraySet.prototype.toArray = function ArraySet_toArray() {
    return this._array.slice();
  };

  exports.ArraySet = ArraySet;

});

},{"./util":43,"amdefine":3}],36:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 *
 * Based on the Base 64 VLQ implementation in Closure Compiler:
 * https://code.google.com/p/closure-compiler/source/browse/trunk/src/com/google/debugging/sourcemap/Base64VLQ.java
 *
 * Copyright 2011 The Closure Compiler Authors. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided
 *    with the distribution.
 *  * Neither the name of Google Inc. nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64 = require('./base64');

  // A single base 64 digit can contain 6 bits of data. For the base 64 variable
  // length quantities we use in the source map spec, the first bit is the sign,
  // the next four bits are the actual value, and the 6th bit is the
  // continuation bit. The continuation bit tells us whether there are more
  // digits in this value following this digit.
  //
  //   Continuation
  //   |    Sign
  //   |    |
  //   V    V
  //   101011

  var VLQ_BASE_SHIFT = 5;

  // binary: 100000
  var VLQ_BASE = 1 << VLQ_BASE_SHIFT;

  // binary: 011111
  var VLQ_BASE_MASK = VLQ_BASE - 1;

  // binary: 100000
  var VLQ_CONTINUATION_BIT = VLQ_BASE;

  /**
   * Converts from a two-complement value to a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   1 becomes 2 (10 binary), -1 becomes 3 (11 binary)
   *   2 becomes 4 (100 binary), -2 becomes 5 (101 binary)
   */
  function toVLQSigned(aValue) {
    return aValue < 0
      ? ((-aValue) << 1) + 1
      : (aValue << 1) + 0;
  }

  /**
   * Converts to a two-complement value from a value where the sign bit is
   * placed in the least significant bit.  For example, as decimals:
   *   2 (10 binary) becomes 1, 3 (11 binary) becomes -1
   *   4 (100 binary) becomes 2, 5 (101 binary) becomes -2
   */
  function fromVLQSigned(aValue) {
    var isNegative = (aValue & 1) === 1;
    var shifted = aValue >> 1;
    return isNegative
      ? -shifted
      : shifted;
  }

  /**
   * Returns the base 64 VLQ encoded value.
   */
  exports.encode = function base64VLQ_encode(aValue) {
    var encoded = "";
    var digit;

    var vlq = toVLQSigned(aValue);

    do {
      digit = vlq & VLQ_BASE_MASK;
      vlq >>>= VLQ_BASE_SHIFT;
      if (vlq > 0) {
        // There are still more digits in this value, so we must make sure the
        // continuation bit is marked.
        digit |= VLQ_CONTINUATION_BIT;
      }
      encoded += base64.encode(digit);
    } while (vlq > 0);

    return encoded;
  };

  /**
   * Decodes the next base 64 VLQ value from the given string and returns the
   * value and the rest of the string via the out parameter.
   */
  exports.decode = function base64VLQ_decode(aStr, aOutParam) {
    var i = 0;
    var strLen = aStr.length;
    var result = 0;
    var shift = 0;
    var continuation, digit;

    do {
      if (i >= strLen) {
        throw new Error("Expected more digits in base 64 VLQ value.");
      }
      digit = base64.decode(aStr.charAt(i++));
      continuation = !!(digit & VLQ_CONTINUATION_BIT);
      digit &= VLQ_BASE_MASK;
      result = result + (digit << shift);
      shift += VLQ_BASE_SHIFT;
    } while (continuation);

    aOutParam.value = fromVLQSigned(result);
    aOutParam.rest = aStr.slice(i);
  };

});

},{"./base64":37,"amdefine":3}],37:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var charToIntMap = {};
  var intToCharMap = {};

  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    .split('')
    .forEach(function (ch, index) {
      charToIntMap[ch] = index;
      intToCharMap[index] = ch;
    });

  /**
   * Encode an integer in the range of 0 to 63 to a single base 64 digit.
   */
  exports.encode = function base64_encode(aNumber) {
    if (aNumber in intToCharMap) {
      return intToCharMap[aNumber];
    }
    throw new TypeError("Must be between 0 and 63: " + aNumber);
  };

  /**
   * Decode a single base 64 digit to an integer.
   */
  exports.decode = function base64_decode(aChar) {
    if (aChar in charToIntMap) {
      return charToIntMap[aChar];
    }
    throw new TypeError("Not a valid base 64 digit: " + aChar);
  };

});

},{"amdefine":3}],38:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * Recursive implementation of binary search.
   *
   * @param aLow Indices here and lower do not contain the needle.
   * @param aHigh Indices here and higher do not contain the needle.
   * @param aNeedle The element being searched for.
   * @param aHaystack The non-empty array being searched.
   * @param aCompare Function which takes two elements and returns -1, 0, or 1.
   */
  function recursiveSearch(aLow, aHigh, aNeedle, aHaystack, aCompare) {
    // This function terminates when one of the following is true:
    //
    //   1. We find the exact element we are looking for.
    //
    //   2. We did not find the exact element, but we can return the index of
    //      the next closest element that is less than that element.
    //
    //   3. We did not find the exact element, and there is no next-closest
    //      element which is less than the one we are searching for, so we
    //      return -1.
    var mid = Math.floor((aHigh - aLow) / 2) + aLow;
    var cmp = aCompare(aNeedle, aHaystack[mid], true);
    if (cmp === 0) {
      // Found the element we are looking for.
      return mid;
    }
    else if (cmp > 0) {
      // aHaystack[mid] is greater than our needle.
      if (aHigh - mid > 1) {
        // The element is in the upper half.
        return recursiveSearch(mid, aHigh, aNeedle, aHaystack, aCompare);
      }
      // We did not find an exact match, return the next closest one
      // (termination case 2).
      return mid;
    }
    else {
      // aHaystack[mid] is less than our needle.
      if (mid - aLow > 1) {
        // The element is in the lower half.
        return recursiveSearch(aLow, mid, aNeedle, aHaystack, aCompare);
      }
      // The exact needle element was not found in this haystack. Determine if
      // we are in termination case (2) or (3) and return the appropriate thing.
      return aLow < 0 ? -1 : aLow;
    }
  }

  /**
   * This is an implementation of binary search which will always try and return
   * the index of next lowest value checked if there is no exact hit. This is
   * because mappings between original and generated line/col pairs are single
   * points, and there is an implicit region between each of them, so a miss
   * just means that you aren't on the very start of a region.
   *
   * @param aNeedle The element you are looking for.
   * @param aHaystack The array that is being searched.
   * @param aCompare A function which takes the needle and an element in the
   *     array and returns -1, 0, or 1 depending on whether the needle is less
   *     than, equal to, or greater than the element, respectively.
   */
  exports.search = function search(aNeedle, aHaystack, aCompare) {
    if (aHaystack.length === 0) {
      return -1;
    }
    return recursiveSearch(-1, aHaystack.length, aNeedle, aHaystack, aCompare)
  };

});

},{"amdefine":3}],39:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2014 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');

  /**
   * Determine whether mappingB is after mappingA with respect to generated
   * position.
   */
  function generatedPositionAfter(mappingA, mappingB) {
    // Optimized for most common case
    var lineA = mappingA.generatedLine;
    var lineB = mappingB.generatedLine;
    var columnA = mappingA.generatedColumn;
    var columnB = mappingB.generatedColumn;
    return lineB > lineA || lineB == lineA && columnB >= columnA ||
           util.compareByGeneratedPositions(mappingA, mappingB) <= 0;
  }

  /**
   * A data structure to provide a sorted view of accumulated mappings in a
   * performance conscious manner. It trades a neglibable overhead in general
   * case for a large speedup in case of mappings being added in order.
   */
  function MappingList() {
    this._array = [];
    this._sorted = true;
    // Serves as infimum
    this._last = {generatedLine: -1, generatedColumn: 0};
  }

  /**
   * Iterate through internal items. This method takes the same arguments that
   * `Array.prototype.forEach` takes.
   *
   * NOTE: The order of the mappings is NOT guaranteed.
   */
  MappingList.prototype.unsortedForEach =
    function MappingList_forEach(aCallback, aThisArg) {
      this._array.forEach(aCallback, aThisArg);
    };

  /**
   * Add the given source mapping.
   *
   * @param Object aMapping
   */
  MappingList.prototype.add = function MappingList_add(aMapping) {
    var mapping;
    if (generatedPositionAfter(this._last, aMapping)) {
      this._last = aMapping;
      this._array.push(aMapping);
    } else {
      this._sorted = false;
      this._array.push(aMapping);
    }
  };

  /**
   * Returns the flat, sorted array of mappings. The mappings are sorted by
   * generated position.
   *
   * WARNING: This method returns internal data without copying, for
   * performance. The return value must NOT be mutated, and should be treated as
   * an immutable borrow. If you want to take ownership, you must make your own
   * copy.
   */
  MappingList.prototype.toArray = function MappingList_toArray() {
    if (!this._sorted) {
      this._array.sort(util.compareByGeneratedPositions);
      this._sorted = true;
    }
    return this._array;
  };

  exports.MappingList = MappingList;

});

},{"./util":43,"amdefine":3}],40:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var util = require('./util');
  var binarySearch = require('./binary-search');
  var ArraySet = require('./array-set').ArraySet;
  var base64VLQ = require('./base64-vlq');

  /**
   * A SourceMapConsumer instance represents a parsed source map which we can
   * query for information about the original file positions by giving it a file
   * position in the generated source.
   *
   * The only parameter is the raw source map (either as a JSON string, or
   * already parsed to an object). According to the spec, source maps have the
   * following attributes:
   *
   *   - version: Which version of the source map spec this map is following.
   *   - sources: An array of URLs to the original source files.
   *   - names: An array of identifiers which can be referrenced by individual mappings.
   *   - sourceRoot: Optional. The URL root from which all sources are relative.
   *   - sourcesContent: Optional. An array of contents of the original source files.
   *   - mappings: A string of base64 VLQs which contain the actual mappings.
   *   - file: Optional. The generated file this source map is associated with.
   *
   * Here is an example source map, taken from the source map spec[0]:
   *
   *     {
   *       version : 3,
   *       file: "out.js",
   *       sourceRoot : "",
   *       sources: ["foo.js", "bar.js"],
   *       names: ["src", "maps", "are", "fun"],
   *       mappings: "AA,AB;;ABCDE;"
   *     }
   *
   * [0]: https://docs.google.com/document/d/1U1RGAehQwRypUTovF1KRlpiOFze0b-_2gc6fAH0KY0k/edit?pli=1#
   */
  function SourceMapConsumer(aSourceMap) {
    var sourceMap = aSourceMap;
    if (typeof aSourceMap === 'string') {
      sourceMap = JSON.parse(aSourceMap.replace(/^\)\]\}'/, ''));
    }

    var version = util.getArg(sourceMap, 'version');
    var sources = util.getArg(sourceMap, 'sources');
    // Sass 3.3 leaves out the 'names' array, so we deviate from the spec (which
    // requires the array) to play nice here.
    var names = util.getArg(sourceMap, 'names', []);
    var sourceRoot = util.getArg(sourceMap, 'sourceRoot', null);
    var sourcesContent = util.getArg(sourceMap, 'sourcesContent', null);
    var mappings = util.getArg(sourceMap, 'mappings');
    var file = util.getArg(sourceMap, 'file', null);

    // Once again, Sass deviates from the spec and supplies the version as a
    // string rather than a number, so we use loose equality checking here.
    if (version != this._version) {
      throw new Error('Unsupported version: ' + version);
    }

    // Some source maps produce relative source paths like "./foo.js" instead of
    // "foo.js".  Normalize these first so that future comparisons will succeed.
    // See bugzil.la/1090768.
    sources = sources.map(util.normalize);

    // Pass `true` below to allow duplicate names and sources. While source maps
    // are intended to be compressed and deduplicated, the TypeScript compiler
    // sometimes generates source maps with duplicates in them. See Github issue
    // #72 and bugzil.la/889492.
    this._names = ArraySet.fromArray(names, true);
    this._sources = ArraySet.fromArray(sources, true);

    this.sourceRoot = sourceRoot;
    this.sourcesContent = sourcesContent;
    this._mappings = mappings;
    this.file = file;
  }

  /**
   * Create a SourceMapConsumer from a SourceMapGenerator.
   *
   * @param SourceMapGenerator aSourceMap
   *        The source map that will be consumed.
   * @returns SourceMapConsumer
   */
  SourceMapConsumer.fromSourceMap =
    function SourceMapConsumer_fromSourceMap(aSourceMap) {
      var smc = Object.create(SourceMapConsumer.prototype);

      smc._names = ArraySet.fromArray(aSourceMap._names.toArray(), true);
      smc._sources = ArraySet.fromArray(aSourceMap._sources.toArray(), true);
      smc.sourceRoot = aSourceMap._sourceRoot;
      smc.sourcesContent = aSourceMap._generateSourcesContent(smc._sources.toArray(),
                                                              smc.sourceRoot);
      smc.file = aSourceMap._file;

      smc.__generatedMappings = aSourceMap._mappings.toArray().slice();
      smc.__originalMappings = aSourceMap._mappings.toArray().slice()
        .sort(util.compareByOriginalPositions);

      return smc;
    };

  /**
   * The version of the source mapping spec that we are consuming.
   */
  SourceMapConsumer.prototype._version = 3;

  /**
   * The list of original sources.
   */
  Object.defineProperty(SourceMapConsumer.prototype, 'sources', {
    get: function () {
      return this._sources.toArray().map(function (s) {
        return this.sourceRoot != null ? util.join(this.sourceRoot, s) : s;
      }, this);
    }
  });

  // `__generatedMappings` and `__originalMappings` are arrays that hold the
  // parsed mapping coordinates from the source map's "mappings" attribute. They
  // are lazily instantiated, accessed via the `_generatedMappings` and
  // `_originalMappings` getters respectively, and we only parse the mappings
  // and create these arrays once queried for a source location. We jump through
  // these hoops because there can be many thousands of mappings, and parsing
  // them is expensive, so we only want to do it if we must.
  //
  // Each object in the arrays is of the form:
  //
  //     {
  //       generatedLine: The line number in the generated code,
  //       generatedColumn: The column number in the generated code,
  //       source: The path to the original source file that generated this
  //               chunk of code,
  //       originalLine: The line number in the original source that
  //                     corresponds to this chunk of generated code,
  //       originalColumn: The column number in the original source that
  //                       corresponds to this chunk of generated code,
  //       name: The name of the original symbol which generated this chunk of
  //             code.
  //     }
  //
  // All properties except for `generatedLine` and `generatedColumn` can be
  // `null`.
  //
  // `_generatedMappings` is ordered by the generated positions.
  //
  // `_originalMappings` is ordered by the original positions.

  SourceMapConsumer.prototype.__generatedMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_generatedMappings', {
    get: function () {
      if (!this.__generatedMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__generatedMappings;
    }
  });

  SourceMapConsumer.prototype.__originalMappings = null;
  Object.defineProperty(SourceMapConsumer.prototype, '_originalMappings', {
    get: function () {
      if (!this.__originalMappings) {
        this.__generatedMappings = [];
        this.__originalMappings = [];
        this._parseMappings(this._mappings, this.sourceRoot);
      }

      return this.__originalMappings;
    }
  });

  SourceMapConsumer.prototype._nextCharIsMappingSeparator =
    function SourceMapConsumer_nextCharIsMappingSeparator(aStr) {
      var c = aStr.charAt(0);
      return c === ";" || c === ",";
    };

  /**
   * Parse the mappings in a string in to a data structure which we can easily
   * query (the ordered arrays in the `this.__generatedMappings` and
   * `this.__originalMappings` properties).
   */
  SourceMapConsumer.prototype._parseMappings =
    function SourceMapConsumer_parseMappings(aStr, aSourceRoot) {
      var generatedLine = 1;
      var previousGeneratedColumn = 0;
      var previousOriginalLine = 0;
      var previousOriginalColumn = 0;
      var previousSource = 0;
      var previousName = 0;
      var str = aStr;
      var temp = {};
      var mapping;

      while (str.length > 0) {
        if (str.charAt(0) === ';') {
          generatedLine++;
          str = str.slice(1);
          previousGeneratedColumn = 0;
        }
        else if (str.charAt(0) === ',') {
          str = str.slice(1);
        }
        else {
          mapping = {};
          mapping.generatedLine = generatedLine;

          // Generated column.
          base64VLQ.decode(str, temp);
          mapping.generatedColumn = previousGeneratedColumn + temp.value;
          previousGeneratedColumn = mapping.generatedColumn;
          str = temp.rest;

          if (str.length > 0 && !this._nextCharIsMappingSeparator(str)) {
            // Original source.
            base64VLQ.decode(str, temp);
            mapping.source = this._sources.at(previousSource + temp.value);
            previousSource += temp.value;
            str = temp.rest;
            if (str.length === 0 || this._nextCharIsMappingSeparator(str)) {
              throw new Error('Found a source, but no line and column');
            }

            // Original line.
            base64VLQ.decode(str, temp);
            mapping.originalLine = previousOriginalLine + temp.value;
            previousOriginalLine = mapping.originalLine;
            // Lines are stored 0-based
            mapping.originalLine += 1;
            str = temp.rest;
            if (str.length === 0 || this._nextCharIsMappingSeparator(str)) {
              throw new Error('Found a source and line, but no column');
            }

            // Original column.
            base64VLQ.decode(str, temp);
            mapping.originalColumn = previousOriginalColumn + temp.value;
            previousOriginalColumn = mapping.originalColumn;
            str = temp.rest;

            if (str.length > 0 && !this._nextCharIsMappingSeparator(str)) {
              // Original name.
              base64VLQ.decode(str, temp);
              mapping.name = this._names.at(previousName + temp.value);
              previousName += temp.value;
              str = temp.rest;
            }
          }

          this.__generatedMappings.push(mapping);
          if (typeof mapping.originalLine === 'number') {
            this.__originalMappings.push(mapping);
          }
        }
      }

      this.__generatedMappings.sort(util.compareByGeneratedPositions);
      this.__originalMappings.sort(util.compareByOriginalPositions);
    };

  /**
   * Find the mapping that best matches the hypothetical "needle" mapping that
   * we are searching for in the given "haystack" of mappings.
   */
  SourceMapConsumer.prototype._findMapping =
    function SourceMapConsumer_findMapping(aNeedle, aMappings, aLineName,
                                           aColumnName, aComparator) {
      // To return the position we are searching for, we must first find the
      // mapping for the given position and then return the opposite position it
      // points to. Because the mappings are sorted, we can use binary search to
      // find the best mapping.

      if (aNeedle[aLineName] <= 0) {
        throw new TypeError('Line must be greater than or equal to 1, got '
                            + aNeedle[aLineName]);
      }
      if (aNeedle[aColumnName] < 0) {
        throw new TypeError('Column must be greater than or equal to 0, got '
                            + aNeedle[aColumnName]);
      }

      return binarySearch.search(aNeedle, aMappings, aComparator);
    };

  /**
   * Compute the last column for each generated mapping. The last column is
   * inclusive.
   */
  SourceMapConsumer.prototype.computeColumnSpans =
    function SourceMapConsumer_computeColumnSpans() {
      for (var index = 0; index < this._generatedMappings.length; ++index) {
        var mapping = this._generatedMappings[index];

        // Mappings do not contain a field for the last generated columnt. We
        // can come up with an optimistic estimate, however, by assuming that
        // mappings are contiguous (i.e. given two consecutive mappings, the
        // first mapping ends where the second one starts).
        if (index + 1 < this._generatedMappings.length) {
          var nextMapping = this._generatedMappings[index + 1];

          if (mapping.generatedLine === nextMapping.generatedLine) {
            mapping.lastGeneratedColumn = nextMapping.generatedColumn - 1;
            continue;
          }
        }

        // The last mapping for each line spans the entire line.
        mapping.lastGeneratedColumn = Infinity;
      }
    };

  /**
   * Returns the original source, line, and column information for the generated
   * source's line and column positions provided. The only argument is an object
   * with the following properties:
   *
   *   - line: The line number in the generated source.
   *   - column: The column number in the generated source.
   *
   * and an object is returned with the following properties:
   *
   *   - source: The original source file, or null.
   *   - line: The line number in the original source, or null.
   *   - column: The column number in the original source, or null.
   *   - name: The original identifier, or null.
   */
  SourceMapConsumer.prototype.originalPositionFor =
    function SourceMapConsumer_originalPositionFor(aArgs) {
      var needle = {
        generatedLine: util.getArg(aArgs, 'line'),
        generatedColumn: util.getArg(aArgs, 'column')
      };

      var index = this._findMapping(needle,
                                    this._generatedMappings,
                                    "generatedLine",
                                    "generatedColumn",
                                    util.compareByGeneratedPositions);

      if (index >= 0) {
        var mapping = this._generatedMappings[index];

        if (mapping.generatedLine === needle.generatedLine) {
          var source = util.getArg(mapping, 'source', null);
          if (source != null && this.sourceRoot != null) {
            source = util.join(this.sourceRoot, source);
          }
          return {
            source: source,
            line: util.getArg(mapping, 'originalLine', null),
            column: util.getArg(mapping, 'originalColumn', null),
            name: util.getArg(mapping, 'name', null)
          };
        }
      }

      return {
        source: null,
        line: null,
        column: null,
        name: null
      };
    };

  /**
   * Returns the original source content. The only argument is the url of the
   * original source file. Returns null if no original source content is
   * availible.
   */
  SourceMapConsumer.prototype.sourceContentFor =
    function SourceMapConsumer_sourceContentFor(aSource) {
      if (!this.sourcesContent) {
        return null;
      }

      if (this.sourceRoot != null) {
        aSource = util.relative(this.sourceRoot, aSource);
      }

      if (this._sources.has(aSource)) {
        return this.sourcesContent[this._sources.indexOf(aSource)];
      }

      var url;
      if (this.sourceRoot != null
          && (url = util.urlParse(this.sourceRoot))) {
        // XXX: file:// URIs and absolute paths lead to unexpected behavior for
        // many users. We can help them out when they expect file:// URIs to
        // behave like it would if they were running a local HTTP server. See
        // https://bugzilla.mozilla.org/show_bug.cgi?id=885597.
        var fileUriAbsPath = aSource.replace(/^file:\/\//, "");
        if (url.scheme == "file"
            && this._sources.has(fileUriAbsPath)) {
          return this.sourcesContent[this._sources.indexOf(fileUriAbsPath)]
        }

        if ((!url.path || url.path == "/")
            && this._sources.has("/" + aSource)) {
          return this.sourcesContent[this._sources.indexOf("/" + aSource)];
        }
      }

      throw new Error('"' + aSource + '" is not in the SourceMap.');
    };

  /**
   * Returns the generated line and column information for the original source,
   * line, and column positions provided. The only argument is an object with
   * the following properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *   - column: The column number in the original source.
   *
   * and an object is returned with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.generatedPositionFor =
    function SourceMapConsumer_generatedPositionFor(aArgs) {
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: util.getArg(aArgs, 'column')
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions);

      if (index >= 0) {
        var mapping = this._originalMappings[index];

        return {
          line: util.getArg(mapping, 'generatedLine', null),
          column: util.getArg(mapping, 'generatedColumn', null),
          lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
        };
      }

      return {
        line: null,
        column: null,
        lastColumn: null
      };
    };

  /**
   * Returns all generated line and column information for the original source
   * and line provided. The only argument is an object with the following
   * properties:
   *
   *   - source: The filename of the original source.
   *   - line: The line number in the original source.
   *
   * and an array of objects is returned, each with the following properties:
   *
   *   - line: The line number in the generated source, or null.
   *   - column: The column number in the generated source, or null.
   */
  SourceMapConsumer.prototype.allGeneratedPositionsFor =
    function SourceMapConsumer_allGeneratedPositionsFor(aArgs) {
      // When there is no exact match, SourceMapConsumer.prototype._findMapping
      // returns the index of the closest mapping less than the needle. By
      // setting needle.originalColumn to Infinity, we thus find the last
      // mapping for the given line, provided such a mapping exists.
      var needle = {
        source: util.getArg(aArgs, 'source'),
        originalLine: util.getArg(aArgs, 'line'),
        originalColumn: Infinity
      };

      if (this.sourceRoot != null) {
        needle.source = util.relative(this.sourceRoot, needle.source);
      }

      var mappings = [];

      var index = this._findMapping(needle,
                                    this._originalMappings,
                                    "originalLine",
                                    "originalColumn",
                                    util.compareByOriginalPositions);
      if (index >= 0) {
        var mapping = this._originalMappings[index];

        while (mapping && mapping.originalLine === needle.originalLine) {
          mappings.push({
            line: util.getArg(mapping, 'generatedLine', null),
            column: util.getArg(mapping, 'generatedColumn', null),
            lastColumn: util.getArg(mapping, 'lastGeneratedColumn', null)
          });

          mapping = this._originalMappings[--index];
        }
      }

      return mappings.reverse();
    };

  SourceMapConsumer.GENERATED_ORDER = 1;
  SourceMapConsumer.ORIGINAL_ORDER = 2;

  /**
   * Iterate over each mapping between an original source/line/column and a
   * generated line/column in this source map.
   *
   * @param Function aCallback
   *        The function that is called with each mapping.
   * @param Object aContext
   *        Optional. If specified, this object will be the value of `this` every
   *        time that `aCallback` is called.
   * @param aOrder
   *        Either `SourceMapConsumer.GENERATED_ORDER` or
   *        `SourceMapConsumer.ORIGINAL_ORDER`. Specifies whether you want to
   *        iterate over the mappings sorted by the generated file's line/column
   *        order or the original's source/line/column order, respectively. Defaults to
   *        `SourceMapConsumer.GENERATED_ORDER`.
   */
  SourceMapConsumer.prototype.eachMapping =
    function SourceMapConsumer_eachMapping(aCallback, aContext, aOrder) {
      var context = aContext || null;
      var order = aOrder || SourceMapConsumer.GENERATED_ORDER;

      var mappings;
      switch (order) {
      case SourceMapConsumer.GENERATED_ORDER:
        mappings = this._generatedMappings;
        break;
      case SourceMapConsumer.ORIGINAL_ORDER:
        mappings = this._originalMappings;
        break;
      default:
        throw new Error("Unknown order of iteration.");
      }

      var sourceRoot = this.sourceRoot;
      mappings.map(function (mapping) {
        var source = mapping.source;
        if (source != null && sourceRoot != null) {
          source = util.join(sourceRoot, source);
        }
        return {
          source: source,
          generatedLine: mapping.generatedLine,
          generatedColumn: mapping.generatedColumn,
          originalLine: mapping.originalLine,
          originalColumn: mapping.originalColumn,
          name: mapping.name
        };
      }).forEach(aCallback, context);
    };

  exports.SourceMapConsumer = SourceMapConsumer;

});

},{"./array-set":35,"./base64-vlq":36,"./binary-search":38,"./util":43,"amdefine":3}],41:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var base64VLQ = require('./base64-vlq');
  var util = require('./util');
  var ArraySet = require('./array-set').ArraySet;
  var MappingList = require('./mapping-list').MappingList;

  /**
   * An instance of the SourceMapGenerator represents a source map which is
   * being built incrementally. You may pass an object with the following
   * properties:
   *
   *   - file: The filename of the generated source.
   *   - sourceRoot: A root for all relative URLs in this source map.
   */
  function SourceMapGenerator(aArgs) {
    if (!aArgs) {
      aArgs = {};
    }
    this._file = util.getArg(aArgs, 'file', null);
    this._sourceRoot = util.getArg(aArgs, 'sourceRoot', null);
    this._skipValidation = util.getArg(aArgs, 'skipValidation', false);
    this._sources = new ArraySet();
    this._names = new ArraySet();
    this._mappings = new MappingList();
    this._sourcesContents = null;
  }

  SourceMapGenerator.prototype._version = 3;

  /**
   * Creates a new SourceMapGenerator based on a SourceMapConsumer
   *
   * @param aSourceMapConsumer The SourceMap.
   */
  SourceMapGenerator.fromSourceMap =
    function SourceMapGenerator_fromSourceMap(aSourceMapConsumer) {
      var sourceRoot = aSourceMapConsumer.sourceRoot;
      var generator = new SourceMapGenerator({
        file: aSourceMapConsumer.file,
        sourceRoot: sourceRoot
      });
      aSourceMapConsumer.eachMapping(function (mapping) {
        var newMapping = {
          generated: {
            line: mapping.generatedLine,
            column: mapping.generatedColumn
          }
        };

        if (mapping.source != null) {
          newMapping.source = mapping.source;
          if (sourceRoot != null) {
            newMapping.source = util.relative(sourceRoot, newMapping.source);
          }

          newMapping.original = {
            line: mapping.originalLine,
            column: mapping.originalColumn
          };

          if (mapping.name != null) {
            newMapping.name = mapping.name;
          }
        }

        generator.addMapping(newMapping);
      });
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          generator.setSourceContent(sourceFile, content);
        }
      });
      return generator;
    };

  /**
   * Add a single mapping from original source line and column to the generated
   * source's line and column for this source map being created. The mapping
   * object should have the following properties:
   *
   *   - generated: An object with the generated line and column positions.
   *   - original: An object with the original line and column positions.
   *   - source: The original source file (relative to the sourceRoot).
   *   - name: An optional original token name for this mapping.
   */
  SourceMapGenerator.prototype.addMapping =
    function SourceMapGenerator_addMapping(aArgs) {
      var generated = util.getArg(aArgs, 'generated');
      var original = util.getArg(aArgs, 'original', null);
      var source = util.getArg(aArgs, 'source', null);
      var name = util.getArg(aArgs, 'name', null);

      if (!this._skipValidation) {
        this._validateMapping(generated, original, source, name);
      }

      if (source != null && !this._sources.has(source)) {
        this._sources.add(source);
      }

      if (name != null && !this._names.has(name)) {
        this._names.add(name);
      }

      this._mappings.add({
        generatedLine: generated.line,
        generatedColumn: generated.column,
        originalLine: original != null && original.line,
        originalColumn: original != null && original.column,
        source: source,
        name: name
      });
    };

  /**
   * Set the source content for a source file.
   */
  SourceMapGenerator.prototype.setSourceContent =
    function SourceMapGenerator_setSourceContent(aSourceFile, aSourceContent) {
      var source = aSourceFile;
      if (this._sourceRoot != null) {
        source = util.relative(this._sourceRoot, source);
      }

      if (aSourceContent != null) {
        // Add the source content to the _sourcesContents map.
        // Create a new _sourcesContents map if the property is null.
        if (!this._sourcesContents) {
          this._sourcesContents = {};
        }
        this._sourcesContents[util.toSetString(source)] = aSourceContent;
      } else if (this._sourcesContents) {
        // Remove the source file from the _sourcesContents map.
        // If the _sourcesContents map is empty, set the property to null.
        delete this._sourcesContents[util.toSetString(source)];
        if (Object.keys(this._sourcesContents).length === 0) {
          this._sourcesContents = null;
        }
      }
    };

  /**
   * Applies the mappings of a sub-source-map for a specific source file to the
   * source map being generated. Each mapping to the supplied source file is
   * rewritten using the supplied source map. Note: The resolution for the
   * resulting mappings is the minimium of this map and the supplied map.
   *
   * @param aSourceMapConsumer The source map to be applied.
   * @param aSourceFile Optional. The filename of the source file.
   *        If omitted, SourceMapConsumer's file property will be used.
   * @param aSourceMapPath Optional. The dirname of the path to the source map
   *        to be applied. If relative, it is relative to the SourceMapConsumer.
   *        This parameter is needed when the two source maps aren't in the same
   *        directory, and the source map to be applied contains relative source
   *        paths. If so, those relative source paths need to be rewritten
   *        relative to the SourceMapGenerator.
   */
  SourceMapGenerator.prototype.applySourceMap =
    function SourceMapGenerator_applySourceMap(aSourceMapConsumer, aSourceFile, aSourceMapPath) {
      var sourceFile = aSourceFile;
      // If aSourceFile is omitted, we will use the file property of the SourceMap
      if (aSourceFile == null) {
        if (aSourceMapConsumer.file == null) {
          throw new Error(
            'SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, ' +
            'or the source map\'s "file" property. Both were omitted.'
          );
        }
        sourceFile = aSourceMapConsumer.file;
      }
      var sourceRoot = this._sourceRoot;
      // Make "sourceFile" relative if an absolute Url is passed.
      if (sourceRoot != null) {
        sourceFile = util.relative(sourceRoot, sourceFile);
      }
      // Applying the SourceMap can add and remove items from the sources and
      // the names array.
      var newSources = new ArraySet();
      var newNames = new ArraySet();

      // Find mappings for the "sourceFile"
      this._mappings.unsortedForEach(function (mapping) {
        if (mapping.source === sourceFile && mapping.originalLine != null) {
          // Check if it can be mapped by the source map, then update the mapping.
          var original = aSourceMapConsumer.originalPositionFor({
            line: mapping.originalLine,
            column: mapping.originalColumn
          });
          if (original.source != null) {
            // Copy mapping
            mapping.source = original.source;
            if (aSourceMapPath != null) {
              mapping.source = util.join(aSourceMapPath, mapping.source)
            }
            if (sourceRoot != null) {
              mapping.source = util.relative(sourceRoot, mapping.source);
            }
            mapping.originalLine = original.line;
            mapping.originalColumn = original.column;
            if (original.name != null) {
              mapping.name = original.name;
            }
          }
        }

        var source = mapping.source;
        if (source != null && !newSources.has(source)) {
          newSources.add(source);
        }

        var name = mapping.name;
        if (name != null && !newNames.has(name)) {
          newNames.add(name);
        }

      }, this);
      this._sources = newSources;
      this._names = newNames;

      // Copy sourcesContents of applied map.
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aSourceMapPath != null) {
            sourceFile = util.join(aSourceMapPath, sourceFile);
          }
          if (sourceRoot != null) {
            sourceFile = util.relative(sourceRoot, sourceFile);
          }
          this.setSourceContent(sourceFile, content);
        }
      }, this);
    };

  /**
   * A mapping can have one of the three levels of data:
   *
   *   1. Just the generated position.
   *   2. The Generated position, original position, and original source.
   *   3. Generated and original position, original source, as well as a name
   *      token.
   *
   * To maintain consistency, we validate that any new mapping being added falls
   * in to one of these categories.
   */
  SourceMapGenerator.prototype._validateMapping =
    function SourceMapGenerator_validateMapping(aGenerated, aOriginal, aSource,
                                                aName) {
      if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
          && aGenerated.line > 0 && aGenerated.column >= 0
          && !aOriginal && !aSource && !aName) {
        // Case 1.
        return;
      }
      else if (aGenerated && 'line' in aGenerated && 'column' in aGenerated
               && aOriginal && 'line' in aOriginal && 'column' in aOriginal
               && aGenerated.line > 0 && aGenerated.column >= 0
               && aOriginal.line > 0 && aOriginal.column >= 0
               && aSource) {
        // Cases 2 and 3.
        return;
      }
      else {
        throw new Error('Invalid mapping: ' + JSON.stringify({
          generated: aGenerated,
          source: aSource,
          original: aOriginal,
          name: aName
        }));
      }
    };

  /**
   * Serialize the accumulated mappings in to the stream of base 64 VLQs
   * specified by the source map format.
   */
  SourceMapGenerator.prototype._serializeMappings =
    function SourceMapGenerator_serializeMappings() {
      var previousGeneratedColumn = 0;
      var previousGeneratedLine = 1;
      var previousOriginalColumn = 0;
      var previousOriginalLine = 0;
      var previousName = 0;
      var previousSource = 0;
      var result = '';
      var mapping;

      var mappings = this._mappings.toArray();

      for (var i = 0, len = mappings.length; i < len; i++) {
        mapping = mappings[i];

        if (mapping.generatedLine !== previousGeneratedLine) {
          previousGeneratedColumn = 0;
          while (mapping.generatedLine !== previousGeneratedLine) {
            result += ';';
            previousGeneratedLine++;
          }
        }
        else {
          if (i > 0) {
            if (!util.compareByGeneratedPositions(mapping, mappings[i - 1])) {
              continue;
            }
            result += ',';
          }
        }

        result += base64VLQ.encode(mapping.generatedColumn
                                   - previousGeneratedColumn);
        previousGeneratedColumn = mapping.generatedColumn;

        if (mapping.source != null) {
          result += base64VLQ.encode(this._sources.indexOf(mapping.source)
                                     - previousSource);
          previousSource = this._sources.indexOf(mapping.source);

          // lines are stored 0-based in SourceMap spec version 3
          result += base64VLQ.encode(mapping.originalLine - 1
                                     - previousOriginalLine);
          previousOriginalLine = mapping.originalLine - 1;

          result += base64VLQ.encode(mapping.originalColumn
                                     - previousOriginalColumn);
          previousOriginalColumn = mapping.originalColumn;

          if (mapping.name != null) {
            result += base64VLQ.encode(this._names.indexOf(mapping.name)
                                       - previousName);
            previousName = this._names.indexOf(mapping.name);
          }
        }
      }

      return result;
    };

  SourceMapGenerator.prototype._generateSourcesContent =
    function SourceMapGenerator_generateSourcesContent(aSources, aSourceRoot) {
      return aSources.map(function (source) {
        if (!this._sourcesContents) {
          return null;
        }
        if (aSourceRoot != null) {
          source = util.relative(aSourceRoot, source);
        }
        var key = util.toSetString(source);
        return Object.prototype.hasOwnProperty.call(this._sourcesContents,
                                                    key)
          ? this._sourcesContents[key]
          : null;
      }, this);
    };

  /**
   * Externalize the source map.
   */
  SourceMapGenerator.prototype.toJSON =
    function SourceMapGenerator_toJSON() {
      var map = {
        version: this._version,
        sources: this._sources.toArray(),
        names: this._names.toArray(),
        mappings: this._serializeMappings()
      };
      if (this._file != null) {
        map.file = this._file;
      }
      if (this._sourceRoot != null) {
        map.sourceRoot = this._sourceRoot;
      }
      if (this._sourcesContents) {
        map.sourcesContent = this._generateSourcesContent(map.sources, map.sourceRoot);
      }

      return map;
    };

  /**
   * Render the source map being generated to a string.
   */
  SourceMapGenerator.prototype.toString =
    function SourceMapGenerator_toString() {
      return JSON.stringify(this);
    };

  exports.SourceMapGenerator = SourceMapGenerator;

});

},{"./array-set":35,"./base64-vlq":36,"./mapping-list":39,"./util":43,"amdefine":3}],42:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  var SourceMapGenerator = require('./source-map-generator').SourceMapGenerator;
  var util = require('./util');

  // Matches a Windows-style `\r\n` newline or a `\n` newline used by all other
  // operating systems these days (capturing the result).
  var REGEX_NEWLINE = /(\r?\n)/;

  // Newline character code for charCodeAt() comparisons
  var NEWLINE_CODE = 10;

  // Private symbol for identifying `SourceNode`s when multiple versions of
  // the source-map library are loaded. This MUST NOT CHANGE across
  // versions!
  var isSourceNode = "$$$isSourceNode$$$";

  /**
   * SourceNodes provide a way to abstract over interpolating/concatenating
   * snippets of generated JavaScript source code while maintaining the line and
   * column information associated with the original source code.
   *
   * @param aLine The original line number.
   * @param aColumn The original column number.
   * @param aSource The original source's filename.
   * @param aChunks Optional. An array of strings which are snippets of
   *        generated JS, or other SourceNodes.
   * @param aName The original identifier.
   */
  function SourceNode(aLine, aColumn, aSource, aChunks, aName) {
    this.children = [];
    this.sourceContents = {};
    this.line = aLine == null ? null : aLine;
    this.column = aColumn == null ? null : aColumn;
    this.source = aSource == null ? null : aSource;
    this.name = aName == null ? null : aName;
    this[isSourceNode] = true;
    if (aChunks != null) this.add(aChunks);
  }

  /**
   * Creates a SourceNode from generated code and a SourceMapConsumer.
   *
   * @param aGeneratedCode The generated code
   * @param aSourceMapConsumer The SourceMap for the generated code
   * @param aRelativePath Optional. The path that relative sources in the
   *        SourceMapConsumer should be relative to.
   */
  SourceNode.fromStringWithSourceMap =
    function SourceNode_fromStringWithSourceMap(aGeneratedCode, aSourceMapConsumer, aRelativePath) {
      // The SourceNode we want to fill with the generated code
      // and the SourceMap
      var node = new SourceNode();

      // All even indices of this array are one line of the generated code,
      // while all odd indices are the newlines between two adjacent lines
      // (since `REGEX_NEWLINE` captures its match).
      // Processed fragments are removed from this array, by calling `shiftNextLine`.
      var remainingLines = aGeneratedCode.split(REGEX_NEWLINE);
      var shiftNextLine = function() {
        var lineContents = remainingLines.shift();
        // The last line of a file might not have a newline.
        var newLine = remainingLines.shift() || "";
        return lineContents + newLine;
      };

      // We need to remember the position of "remainingLines"
      var lastGeneratedLine = 1, lastGeneratedColumn = 0;

      // The generate SourceNodes we need a code range.
      // To extract it current and last mapping is used.
      // Here we store the last mapping.
      var lastMapping = null;

      aSourceMapConsumer.eachMapping(function (mapping) {
        if (lastMapping !== null) {
          // We add the code from "lastMapping" to "mapping":
          // First check if there is a new line in between.
          if (lastGeneratedLine < mapping.generatedLine) {
            var code = "";
            // Associate first line with "lastMapping"
            addMappingWithCode(lastMapping, shiftNextLine());
            lastGeneratedLine++;
            lastGeneratedColumn = 0;
            // The remaining code is added without mapping
          } else {
            // There is no new line in between.
            // Associate the code between "lastGeneratedColumn" and
            // "mapping.generatedColumn" with "lastMapping"
            var nextLine = remainingLines[0];
            var code = nextLine.substr(0, mapping.generatedColumn -
                                          lastGeneratedColumn);
            remainingLines[0] = nextLine.substr(mapping.generatedColumn -
                                                lastGeneratedColumn);
            lastGeneratedColumn = mapping.generatedColumn;
            addMappingWithCode(lastMapping, code);
            // No more remaining code, continue
            lastMapping = mapping;
            return;
          }
        }
        // We add the generated code until the first mapping
        // to the SourceNode without any mapping.
        // Each line is added as separate string.
        while (lastGeneratedLine < mapping.generatedLine) {
          node.add(shiftNextLine());
          lastGeneratedLine++;
        }
        if (lastGeneratedColumn < mapping.generatedColumn) {
          var nextLine = remainingLines[0];
          node.add(nextLine.substr(0, mapping.generatedColumn));
          remainingLines[0] = nextLine.substr(mapping.generatedColumn);
          lastGeneratedColumn = mapping.generatedColumn;
        }
        lastMapping = mapping;
      }, this);
      // We have processed all mappings.
      if (remainingLines.length > 0) {
        if (lastMapping) {
          // Associate the remaining code in the current line with "lastMapping"
          addMappingWithCode(lastMapping, shiftNextLine());
        }
        // and add the remaining lines without any mapping
        node.add(remainingLines.join(""));
      }

      // Copy sourcesContent into SourceNode
      aSourceMapConsumer.sources.forEach(function (sourceFile) {
        var content = aSourceMapConsumer.sourceContentFor(sourceFile);
        if (content != null) {
          if (aRelativePath != null) {
            sourceFile = util.join(aRelativePath, sourceFile);
          }
          node.setSourceContent(sourceFile, content);
        }
      });

      return node;

      function addMappingWithCode(mapping, code) {
        if (mapping === null || mapping.source === undefined) {
          node.add(code);
        } else {
          var source = aRelativePath
            ? util.join(aRelativePath, mapping.source)
            : mapping.source;
          node.add(new SourceNode(mapping.originalLine,
                                  mapping.originalColumn,
                                  source,
                                  code,
                                  mapping.name));
        }
      }
    };

  /**
   * Add a chunk of generated JS to this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.add = function SourceNode_add(aChunk) {
    if (Array.isArray(aChunk)) {
      aChunk.forEach(function (chunk) {
        this.add(chunk);
      }, this);
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      if (aChunk) {
        this.children.push(aChunk);
      }
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Add a chunk of generated JS to the beginning of this source node.
   *
   * @param aChunk A string snippet of generated JS code, another instance of
   *        SourceNode, or an array where each member is one of those things.
   */
  SourceNode.prototype.prepend = function SourceNode_prepend(aChunk) {
    if (Array.isArray(aChunk)) {
      for (var i = aChunk.length-1; i >= 0; i--) {
        this.prepend(aChunk[i]);
      }
    }
    else if (aChunk[isSourceNode] || typeof aChunk === "string") {
      this.children.unshift(aChunk);
    }
    else {
      throw new TypeError(
        "Expected a SourceNode, string, or an array of SourceNodes and strings. Got " + aChunk
      );
    }
    return this;
  };

  /**
   * Walk over the tree of JS snippets in this node and its children. The
   * walking function is called once for each snippet of JS and is passed that
   * snippet and the its original associated source's line/column location.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walk = function SourceNode_walk(aFn) {
    var chunk;
    for (var i = 0, len = this.children.length; i < len; i++) {
      chunk = this.children[i];
      if (chunk[isSourceNode]) {
        chunk.walk(aFn);
      }
      else {
        if (chunk !== '') {
          aFn(chunk, { source: this.source,
                       line: this.line,
                       column: this.column,
                       name: this.name });
        }
      }
    }
  };

  /**
   * Like `String.prototype.join` except for SourceNodes. Inserts `aStr` between
   * each of `this.children`.
   *
   * @param aSep The separator.
   */
  SourceNode.prototype.join = function SourceNode_join(aSep) {
    var newChildren;
    var i;
    var len = this.children.length;
    if (len > 0) {
      newChildren = [];
      for (i = 0; i < len-1; i++) {
        newChildren.push(this.children[i]);
        newChildren.push(aSep);
      }
      newChildren.push(this.children[i]);
      this.children = newChildren;
    }
    return this;
  };

  /**
   * Call String.prototype.replace on the very right-most source snippet. Useful
   * for trimming whitespace from the end of a source node, etc.
   *
   * @param aPattern The pattern to replace.
   * @param aReplacement The thing to replace the pattern with.
   */
  SourceNode.prototype.replaceRight = function SourceNode_replaceRight(aPattern, aReplacement) {
    var lastChild = this.children[this.children.length - 1];
    if (lastChild[isSourceNode]) {
      lastChild.replaceRight(aPattern, aReplacement);
    }
    else if (typeof lastChild === 'string') {
      this.children[this.children.length - 1] = lastChild.replace(aPattern, aReplacement);
    }
    else {
      this.children.push(''.replace(aPattern, aReplacement));
    }
    return this;
  };

  /**
   * Set the source content for a source file. This will be added to the SourceMapGenerator
   * in the sourcesContent field.
   *
   * @param aSourceFile The filename of the source file
   * @param aSourceContent The content of the source file
   */
  SourceNode.prototype.setSourceContent =
    function SourceNode_setSourceContent(aSourceFile, aSourceContent) {
      this.sourceContents[util.toSetString(aSourceFile)] = aSourceContent;
    };

  /**
   * Walk over the tree of SourceNodes. The walking function is called for each
   * source file content and is passed the filename and source content.
   *
   * @param aFn The traversal function.
   */
  SourceNode.prototype.walkSourceContents =
    function SourceNode_walkSourceContents(aFn) {
      for (var i = 0, len = this.children.length; i < len; i++) {
        if (this.children[i][isSourceNode]) {
          this.children[i].walkSourceContents(aFn);
        }
      }

      var sources = Object.keys(this.sourceContents);
      for (var i = 0, len = sources.length; i < len; i++) {
        aFn(util.fromSetString(sources[i]), this.sourceContents[sources[i]]);
      }
    };

  /**
   * Return the string representation of this source node. Walks over the tree
   * and concatenates all the various snippets together to one string.
   */
  SourceNode.prototype.toString = function SourceNode_toString() {
    var str = "";
    this.walk(function (chunk) {
      str += chunk;
    });
    return str;
  };

  /**
   * Returns the string representation of this source node along with a source
   * map.
   */
  SourceNode.prototype.toStringWithSourceMap = function SourceNode_toStringWithSourceMap(aArgs) {
    var generated = {
      code: "",
      line: 1,
      column: 0
    };
    var map = new SourceMapGenerator(aArgs);
    var sourceMappingActive = false;
    var lastOriginalSource = null;
    var lastOriginalLine = null;
    var lastOriginalColumn = null;
    var lastOriginalName = null;
    this.walk(function (chunk, original) {
      generated.code += chunk;
      if (original.source !== null
          && original.line !== null
          && original.column !== null) {
        if(lastOriginalSource !== original.source
           || lastOriginalLine !== original.line
           || lastOriginalColumn !== original.column
           || lastOriginalName !== original.name) {
          map.addMapping({
            source: original.source,
            original: {
              line: original.line,
              column: original.column
            },
            generated: {
              line: generated.line,
              column: generated.column
            },
            name: original.name
          });
        }
        lastOriginalSource = original.source;
        lastOriginalLine = original.line;
        lastOriginalColumn = original.column;
        lastOriginalName = original.name;
        sourceMappingActive = true;
      } else if (sourceMappingActive) {
        map.addMapping({
          generated: {
            line: generated.line,
            column: generated.column
          }
        });
        lastOriginalSource = null;
        sourceMappingActive = false;
      }
      for (var idx = 0, length = chunk.length; idx < length; idx++) {
        if (chunk.charCodeAt(idx) === NEWLINE_CODE) {
          generated.line++;
          generated.column = 0;
          // Mappings end at eol
          if (idx + 1 === length) {
            lastOriginalSource = null;
            sourceMappingActive = false;
          } else if (sourceMappingActive) {
            map.addMapping({
              source: original.source,
              original: {
                line: original.line,
                column: original.column
              },
              generated: {
                line: generated.line,
                column: generated.column
              },
              name: original.name
            });
          }
        } else {
          generated.column++;
        }
      }
    });
    this.walkSourceContents(function (sourceFile, sourceContent) {
      map.setSourceContent(sourceFile, sourceContent);
    });

    return { code: generated.code, map: map };
  };

  exports.SourceNode = SourceNode;

});

},{"./source-map-generator":41,"./util":43,"amdefine":3}],43:[function(require,module,exports){
/* -*- Mode: js; js-indent-level: 2; -*- */
/*
 * Copyright 2011 Mozilla Foundation and contributors
 * Licensed under the New BSD license. See LICENSE or:
 * http://opensource.org/licenses/BSD-3-Clause
 */
if (typeof define !== 'function') {
    var define = require('amdefine')(module, require);
}
define(function (require, exports, module) {

  /**
   * This is a helper function for getting values from parameter/options
   * objects.
   *
   * @param args The object we are extracting values from
   * @param name The name of the property we are getting.
   * @param defaultValue An optional value to return if the property is missing
   * from the object. If this is not specified and the property is missing, an
   * error will be thrown.
   */
  function getArg(aArgs, aName, aDefaultValue) {
    if (aName in aArgs) {
      return aArgs[aName];
    } else if (arguments.length === 3) {
      return aDefaultValue;
    } else {
      throw new Error('"' + aName + '" is a required argument.');
    }
  }
  exports.getArg = getArg;

  var urlRegexp = /^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.]*)(?::(\d+))?(\S*)$/;
  var dataUrlRegexp = /^data:.+\,.+$/;

  function urlParse(aUrl) {
    var match = aUrl.match(urlRegexp);
    if (!match) {
      return null;
    }
    return {
      scheme: match[1],
      auth: match[2],
      host: match[3],
      port: match[4],
      path: match[5]
    };
  }
  exports.urlParse = urlParse;

  function urlGenerate(aParsedUrl) {
    var url = '';
    if (aParsedUrl.scheme) {
      url += aParsedUrl.scheme + ':';
    }
    url += '//';
    if (aParsedUrl.auth) {
      url += aParsedUrl.auth + '@';
    }
    if (aParsedUrl.host) {
      url += aParsedUrl.host;
    }
    if (aParsedUrl.port) {
      url += ":" + aParsedUrl.port
    }
    if (aParsedUrl.path) {
      url += aParsedUrl.path;
    }
    return url;
  }
  exports.urlGenerate = urlGenerate;

  /**
   * Normalizes a path, or the path portion of a URL:
   *
   * - Replaces consequtive slashes with one slash.
   * - Removes unnecessary '.' parts.
   * - Removes unnecessary '<dir>/..' parts.
   *
   * Based on code in the Node.js 'path' core module.
   *
   * @param aPath The path or url to normalize.
   */
  function normalize(aPath) {
    var path = aPath;
    var url = urlParse(aPath);
    if (url) {
      if (!url.path) {
        return aPath;
      }
      path = url.path;
    }
    var isAbsolute = (path.charAt(0) === '/');

    var parts = path.split(/\/+/);
    for (var part, up = 0, i = parts.length - 1; i >= 0; i--) {
      part = parts[i];
      if (part === '.') {
        parts.splice(i, 1);
      } else if (part === '..') {
        up++;
      } else if (up > 0) {
        if (part === '') {
          // The first part is blank if the path is absolute. Trying to go
          // above the root is a no-op. Therefore we can remove all '..' parts
          // directly after the root.
          parts.splice(i + 1, up);
          up = 0;
        } else {
          parts.splice(i, 2);
          up--;
        }
      }
    }
    path = parts.join('/');

    if (path === '') {
      path = isAbsolute ? '/' : '.';
    }

    if (url) {
      url.path = path;
      return urlGenerate(url);
    }
    return path;
  }
  exports.normalize = normalize;

  /**
   * Joins two paths/URLs.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be joined with the root.
   *
   * - If aPath is a URL or a data URI, aPath is returned, unless aPath is a
   *   scheme-relative URL: Then the scheme of aRoot, if any, is prepended
   *   first.
   * - Otherwise aPath is a path. If aRoot is a URL, then its path portion
   *   is updated with the result and aRoot is returned. Otherwise the result
   *   is returned.
   *   - If aPath is absolute, the result is aPath.
   *   - Otherwise the two paths are joined with a slash.
   * - Joining for example 'http://' and 'www.example.com' is also supported.
   */
  function join(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }
    if (aPath === "") {
      aPath = ".";
    }
    var aPathUrl = urlParse(aPath);
    var aRootUrl = urlParse(aRoot);
    if (aRootUrl) {
      aRoot = aRootUrl.path || '/';
    }

    // `join(foo, '//www.example.org')`
    if (aPathUrl && !aPathUrl.scheme) {
      if (aRootUrl) {
        aPathUrl.scheme = aRootUrl.scheme;
      }
      return urlGenerate(aPathUrl);
    }

    if (aPathUrl || aPath.match(dataUrlRegexp)) {
      return aPath;
    }

    // `join('http://', 'www.example.com')`
    if (aRootUrl && !aRootUrl.host && !aRootUrl.path) {
      aRootUrl.host = aPath;
      return urlGenerate(aRootUrl);
    }

    var joined = aPath.charAt(0) === '/'
      ? aPath
      : normalize(aRoot.replace(/\/+$/, '') + '/' + aPath);

    if (aRootUrl) {
      aRootUrl.path = joined;
      return urlGenerate(aRootUrl);
    }
    return joined;
  }
  exports.join = join;

  /**
   * Make a path relative to a URL or another path.
   *
   * @param aRoot The root path or URL.
   * @param aPath The path or URL to be made relative to aRoot.
   */
  function relative(aRoot, aPath) {
    if (aRoot === "") {
      aRoot = ".";
    }

    aRoot = aRoot.replace(/\/$/, '');

    // XXX: It is possible to remove this block, and the tests still pass!
    var url = urlParse(aRoot);
    if (aPath.charAt(0) == "/" && url && url.path == "/") {
      return aPath.slice(1);
    }

    return aPath.indexOf(aRoot + '/') === 0
      ? aPath.substr(aRoot.length + 1)
      : aPath;
  }
  exports.relative = relative;

  /**
   * Because behavior goes wacky when you set `__proto__` on objects, we
   * have to prefix all the strings in our set with an arbitrary character.
   *
   * See https://github.com/mozilla/source-map/pull/31 and
   * https://github.com/mozilla/source-map/issues/30
   *
   * @param String aStr
   */
  function toSetString(aStr) {
    return '$' + aStr;
  }
  exports.toSetString = toSetString;

  function fromSetString(aStr) {
    return aStr.substr(1);
  }
  exports.fromSetString = fromSetString;

  function strcmp(aStr1, aStr2) {
    var s1 = aStr1 || "";
    var s2 = aStr2 || "";
    return (s1 > s2) - (s1 < s2);
  }

  /**
   * Comparator between two mappings where the original positions are compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same original source/line/column, but different generated
   * line and column the same. Useful when searching for a mapping with a
   * stubbed out mapping.
   */
  function compareByOriginalPositions(mappingA, mappingB, onlyCompareOriginal) {
    var cmp;

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp || onlyCompareOriginal) {
      return cmp;
    }

    cmp = strcmp(mappingA.name, mappingB.name);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    return mappingA.generatedColumn - mappingB.generatedColumn;
  };
  exports.compareByOriginalPositions = compareByOriginalPositions;

  /**
   * Comparator between two mappings where the generated positions are
   * compared.
   *
   * Optionally pass in `true` as `onlyCompareGenerated` to consider two
   * mappings with the same generated line and column, but different
   * source/name/original line and column the same. Useful when searching for a
   * mapping with a stubbed out mapping.
   */
  function compareByGeneratedPositions(mappingA, mappingB, onlyCompareGenerated) {
    var cmp;

    cmp = mappingA.generatedLine - mappingB.generatedLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.generatedColumn - mappingB.generatedColumn;
    if (cmp || onlyCompareGenerated) {
      return cmp;
    }

    cmp = strcmp(mappingA.source, mappingB.source);
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalLine - mappingB.originalLine;
    if (cmp) {
      return cmp;
    }

    cmp = mappingA.originalColumn - mappingB.originalColumn;
    if (cmp) {
      return cmp;
    }

    return strcmp(mappingA.name, mappingB.name);
  };
  exports.compareByGeneratedPositions = compareByGeneratedPositions;

});

},{"amdefine":3}],44:[function(require,module,exports){
module.exports = require('./lib/type');

},{"./lib/type":45}],45:[function(require,module,exports){
/*!
 * type-detect
 * Copyright(c) 2013 jake luer <jake@alogicalparadox.com>
 * MIT Licensed
 */

/*!
 * Primary Exports
 */

var exports = module.exports = getType;

/**
 * ### typeOf (obj)
 *
 * Use several different techniques to determine
 * the type of object being tested.
 *
 *
 * @param {Mixed} object
 * @return {String} object type
 * @api public
 */
var objectTypeRegexp = /^\[object (.*)\]$/;

function getType(obj) {
  var type = Object.prototype.toString.call(obj).match(objectTypeRegexp)[1].toLowerCase();
  // Let "new String('')" return 'object'
  if (typeof Promise === 'function' && obj instanceof Promise) return 'promise';
  // PhantomJS has type "DOMWindow" for null
  if (obj === null) return 'null';
  // PhantomJS has type "DOMWindow" for undefined
  if (obj === undefined) return 'undefined';
  return type;
}

exports.Library = Library;

/**
 * ### Library
 *
 * Create a repository for custom type detection.
 *
 * ```js
 * var lib = new type.Library;
 * ```
 *
 */

function Library() {
  if (!(this instanceof Library)) return new Library();
  this.tests = {};
}

/**
 * #### .of (obj)
 *
 * Expose replacement `typeof` detection to the library.
 *
 * ```js
 * if ('string' === lib.of('hello world')) {
 *   // ...
 * }
 * ```
 *
 * @param {Mixed} object to test
 * @return {String} type
 */

Library.prototype.of = getType;

/**
 * #### .define (type, test)
 *
 * Add a test to for the `.test()` assertion.
 *
 * Can be defined as a regular expression:
 *
 * ```js
 * lib.define('int', /^[0-9]+$/);
 * ```
 *
 * ... or as a function:
 *
 * ```js
 * lib.define('bln', function (obj) {
 *   if ('boolean' === lib.of(obj)) return true;
 *   var blns = [ 'yes', 'no', 'true', 'false', 1, 0 ];
 *   if ('string' === lib.of(obj)) obj = obj.toLowerCase();
 *   return !! ~blns.indexOf(obj);
 * });
 * ```
 *
 * @param {String} type
 * @param {RegExp|Function} test
 * @api public
 */

Library.prototype.define = function(type, test) {
  if (arguments.length === 1) return this.tests[type];
  this.tests[type] = test;
  return this;
};

/**
 * #### .test (obj, test)
 *
 * Assert that an object is of type. Will first
 * check natives, and if that does not pass it will
 * use the user defined custom tests.
 *
 * ```js
 * assert(lib.test('1', 'int'));
 * assert(lib.test('yes', 'bln'));
 * ```
 *
 * @param {Mixed} object
 * @param {String} type
 * @return {Boolean} result
 * @api public
 */

Library.prototype.test = function(obj, type) {
  if (type === getType(obj)) return true;
  var test = this.tests[type];

  if (test && 'regexp' === getType(test)) {
    return test.test(obj);
  } else if (test && 'function' === getType(test)) {
    return test(obj);
  } else {
    throw new ReferenceError('Type test "' + type + '" not defined or invalid.');
  }
};

},{}],46:[function(require,module,exports){
var AddressOf, Assign, Ast, EXPR_TYPES, PRIMITIVE_TYPES, Pointer, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), EXPR_TYPES = ref.EXPR_TYPES, PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, Pointer = ref.Pointer;

Assign = require('./assign').Assign;

module.exports = this;

this.AddressOf = AddressOf = (function(superClass) {
  extend(AddressOf, superClass);

  function AddressOf() {
    return AddressOf.__super__.constructor.apply(this, arguments);
  }

  AddressOf.prototype.name = "AddressOf";

  AddressOf.prototype.compile = function(state) {
    var exprType, instructions, isConst, ref1, result, type, valueAst, valueInstructions, valueResult, valueType;
    valueAst = this.children[0];
    ref1 = valueAst.compile(state), exprType = ref1.exprType, valueType = ref1.type, valueResult = ref1.result, valueInstructions = ref1.instructions, isConst = ref1.isConst;
    if (valueType === PRIMITIVE_TYPES.STRING) {
      this.compilationError('STRING_ADDRESSING');
    }
    if (!valueType.isReferenceable) {
      this.compilationError('ASSIGNABLE_ADDRESSING');
    }
    if (exprType !== EXPR_TYPES.LVALUE) {
      this.compilationError('LVALUE_ADDRESSING');
    }
    state.releaseTemporaries(valueResult);
    type = new Pointer(valueType, {
      isValueConst: isConst
    });
    result = state.getTemporary(type);
    if (valueType.isArray) {
      instructions = slice.call(valueInstructions).concat([new Assign(result, valueResult)]);
    } else {
      instructions = slice.call(valueInstructions).concat([new AddressOf(result, valueResult)]);
    }
    return {
      instructions: instructions,
      result: result,
      type: type,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  AddressOf.prototype.execute = function(arg) {
    var destReference, memory, ref1, reference;
    memory = arg.memory;
    ref1 = this.children, destReference = ref1[0], reference = ref1[1];
    return destReference.write(memory, reference.getAddress(memory));
  };

  return AddressOf;

})(Ast);


},{"./assign":49,"./ast":50,"./type":72}],47:[function(require,module,exports){
var ArraySubscript, Ast, EXPR_TYPES, Leal, PRIMITIVE_TYPES, Pointer, PointerMemoryReference, ensureType, ref, ref1,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), ensureType = ref.ensureType, PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, EXPR_TYPES = ref.EXPR_TYPES, Pointer = ref.Pointer;

ref1 = require('./memory-reference'), PointerMemoryReference = ref1.PointerMemoryReference, Leal = ref1.Leal;

module.exports = this;

this.ArraySubscript = ArraySubscript = (function(superClass) {
  extend(ArraySubscript, superClass);

  function ArraySubscript() {
    return ArraySubscript.__super__.constructor.apply(this, arguments);
  }

  ArraySubscript.prototype.name = "ArraySubscript";

  ArraySubscript.prototype.compile = function(state) {
    var index, indexCastInstructions, indexCastResult, indexInstructions, indexResult, indexType, instructions, isConst, lvalueId, ref2, ref3, ref4, ref5, result, type, variable, variableInstructions, variableResult;
    ref2 = this.children, variable = ref2[0], index = ref2[1];
    ref3 = variable.compile(state), type = ref3.type, lvalueId = ref3.lvalueId, variableResult = ref3.result, variableInstructions = ref3.instructions;
    ref4 = index.compile(state), indexResult = ref4.result, indexInstructions = ref4.instructions, indexType = ref4.type;
    if (!((type.isArray || type.isPointer) && indexType.isIntegral)) {
      this.compilationError('INVALID_ARRAY_SUBSCRIPT', "type", type.getSymbol(), "typeSubscript", indexType.getSymbol());
    }
    ref5 = ensureType(indexResult, indexType, PRIMITIVE_TYPES.INT, this, state), indexCastInstructions = ref5.instructions, indexCastResult = ref5.result;
    isConst = type.isValueConst;
    type = type.getElementType();
    instructions = slice.call(variableInstructions).concat(slice.call(indexInstructions), slice.call(indexCastInstructions));
    if (type.isArray) {
      state.releaseTemporaries(variableResult);
      state.releaseTemporaries(indexCastResult);
      result = state.getTemporary(new Pointer(type.getElementType()));
      instructions.push(new Leal(result, variableResult, indexCastResult, type.bytes));
    } else {
      result = new PointerMemoryReference(type, variableResult, indexCastResult);
    }
    return {
      exprType: EXPR_TYPES.LVALUE,
      lvalueId: lvalueId,
      instructions: instructions,
      result: result,
      type: type,
      isConst: isConst
    };
  };

  return ArraySubscript;

})(Ast);


},{"./ast":50,"./memory-reference":67,"./type":72}],48:[function(require,module,exports){
var Add, AddAssign, Assign, Ast, Div, DivAssign, EXPR_TYPES, IntLit, Mod, ModAssign, Mul, MulAssign, OpAssign, PRIMITIVE_TYPES, PostDec, PostInc, PostOp, PreDec, PreInc, PreOp, Sub, SubAssign, ref, ref1, utils,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, EXPR_TYPES = ref.EXPR_TYPES;

ref1 = require('./binary-op'), Add = ref1.Add, Sub = ref1.Sub, Mul = ref1.Mul, Div = ref1.Div, Mod = ref1.Mod;

IntLit = require('./literals').IntLit;

Assign = require('./assign').Assign;

utils = require('../utils');

module.exports = this;

PreOp = (function(superClass) {
  extend(PreOp, superClass);

  function PreOp() {
    return PreOp.__super__.constructor.apply(this, arguments);
  }

  PreOp.prototype.compile = function(state) {
    var addAst, assignAst, destAst, intLitAst, resultAst, resultAstAdd;
    destAst = this.children[0];
    resultAst = destAst.compile(state);
    if (typeof this.checkType === "function") {
      this.checkType(resultAst.type);
    }
    resultAstAdd = utils.clone(resultAst);
    resultAstAdd.instructions = [];
    intLitAst = new IntLit(this.incr);
    intLitAst.locations = this.locations;
    addAst = new Add({
      compile: function() {
        return resultAstAdd;
      }
    }, intLitAst);
    addAst.locations = this.locations;
    assignAst = new Assign({
      compile: function() {
        return resultAst;
      }
    }, addAst);
    assignAst.locations = this.locations;
    return assignAst.compile(state);
  };

  return PreOp;

})(Ast);

this.PreInc = PreInc = (function(superClass) {
  extend(PreInc, superClass);

  function PreInc() {
    return PreInc.__super__.constructor.apply(this, arguments);
  }

  PreInc.prototype.name = "PreInc";

  PreInc.prototype.incr = "1";

  return PreInc;

})(PreOp);

this.PreDec = PreDec = (function(superClass) {
  extend(PreDec, superClass);

  function PreDec() {
    return PreDec.__super__.constructor.apply(this, arguments);
  }

  PreDec.prototype.name = "PreDec";

  PreDec.prototype.incr = "-1";

  PreDec.prototype.checkType = function(type) {
    if (type === PRIMITIVE_TYPES.BOOL) {
      return this.compilationError('INVALID_BOOL_DEC');
    }
  };

  return PreDec;

})(PreOp);

PostOp = (function(superClass) {
  extend(PostOp, superClass);

  function PostOp() {
    return PostOp.__super__.constructor.apply(this, arguments);
  }

  PostOp.prototype.compile = function(state) {
    var addAst, assignAst, assignInstructions, assignResult, destAst, intLitAst, ref2, result, resultAst, resultAstAdd;
    destAst = this.children[0];
    resultAst = destAst.compile(state);
    if (typeof this.checkType === "function") {
      this.checkType(resultAst.type);
    }
    result = state.getTemporary(resultAst.type);
    resultAstAdd = utils.clone(resultAst);
    resultAstAdd.instructions = [];
    intLitAst = new IntLit(this.incr);
    intLitAst.locations = this.locations;
    addAst = new Add({
      compile: function() {
        return resultAstAdd;
      }
    }, intLitAst);
    addAst.locations = this.locations;
    assignAst = new Assign({
      compile: function() {
        return resultAst;
      }
    }, addAst);
    assignAst.locations = this.locations;
    ref2 = assignAst.compile(state), assignInstructions = ref2.instructions, assignResult = ref2.result;
    state.releaseTemporaries(assignResult);
    return {
      instructions: [new Assign(result, resultAst.result)].concat(slice.call(assignInstructions)),
      result: result,
      type: resultAst.type,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  return PostOp;

})(Ast);

this.PostInc = PostInc = (function(superClass) {
  extend(PostInc, superClass);

  function PostInc() {
    return PostInc.__super__.constructor.apply(this, arguments);
  }

  PostInc.prototype.name = "PostInc";

  PostInc.prototype.incr = "1";

  return PostInc;

})(PostOp);

this.PostDec = PostDec = (function(superClass) {
  extend(PostDec, superClass);

  function PostDec() {
    return PostDec.__super__.constructor.apply(this, arguments);
  }

  PostDec.prototype.name = "PostDec";

  PostDec.prototype.incr = "-1";

  PostDec.prototype.checkType = function(type) {
    if (type === PRIMITIVE_TYPES.BOOL) {
      return this.compilationError('INVALID_BOOL_DEC');
    }
  };

  return PostDec;

})(PostOp);

OpAssign = (function(superClass) {
  extend(OpAssign, superClass);

  function OpAssign() {
    return OpAssign.__super__.constructor.apply(this, arguments);
  }

  OpAssign.prototype.compile = function(state) {
    var assignAst, destAst, opAst, ref2, result, resultOp, valueAst;
    ref2 = this.children, destAst = ref2[0], valueAst = ref2[1];
    result = destAst.compile(state);
    resultOp = utils.clone(result);
    resultOp.instructions = [];
    opAst = new this.op({
      compile: function() {
        return resultOp;
      }
    }, valueAst);
    opAst.locations = this.locations;
    assignAst = new Assign({
      compile: function() {
        return result;
      }
    }, opAst);
    assignAst.locations = this.locations;
    return assignAst.compile(state);
  };

  return OpAssign;

})(Ast);

this.AddAssign = AddAssign = (function(superClass) {
  extend(AddAssign, superClass);

  function AddAssign() {
    return AddAssign.__super__.constructor.apply(this, arguments);
  }

  AddAssign.prototype.name = "AddAssign";

  AddAssign.prototype.op = Add;

  return AddAssign;

})(OpAssign);

this.SubAssign = SubAssign = (function(superClass) {
  extend(SubAssign, superClass);

  function SubAssign() {
    return SubAssign.__super__.constructor.apply(this, arguments);
  }

  SubAssign.prototype.name = "SubAssign";

  SubAssign.prototype.op = Sub;

  return SubAssign;

})(OpAssign);

this.MulAssign = MulAssign = (function(superClass) {
  extend(MulAssign, superClass);

  function MulAssign() {
    return MulAssign.__super__.constructor.apply(this, arguments);
  }

  MulAssign.prototype.name = "MulAssign";

  MulAssign.prototype.op = Mul;

  return MulAssign;

})(OpAssign);

this.DivAssign = DivAssign = (function(superClass) {
  extend(DivAssign, superClass);

  function DivAssign() {
    return DivAssign.__super__.constructor.apply(this, arguments);
  }

  DivAssign.prototype.name = "DivAssign";

  DivAssign.prototype.op = Div;

  return DivAssign;

})(OpAssign);

this.ModAssign = ModAssign = (function(superClass) {
  extend(ModAssign, superClass);

  function ModAssign() {
    return ModAssign.__super__.constructor.apply(this, arguments);
  }

  ModAssign.prototype.name = "ModAssign";

  ModAssign.prototype.op = Mod;

  return ModAssign;

})(OpAssign);


},{"../utils":96,"./assign":49,"./ast":50,"./binary-op":51,"./literals":66,"./type":72}],49:[function(require,module,exports){
var Array, Assign, Ast, EXPR_TYPES, PRIMITIVE_TYPES, ensureType, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), ensureType = ref.ensureType, EXPR_TYPES = ref.EXPR_TYPES, Array = ref.Array, PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES;

module.exports = this;

this.Assign = Assign = (function(superClass) {
  extend(Assign, superClass);

  function Assign() {
    return Assign.__super__.constructor.apply(this, arguments);
  }

  Assign.prototype.name = "Assign";

  Assign.prototype.compile = function(state, arg) {
    var castInstructions, destAst, destInstructions, destReference, destType, exprType, instructions, isConst, isFromDeclaration, lvalueId, ref1, ref2, ref3, ref4, ref5, result, valueAst, valueInstructions, valueReference, valueType;
    isFromDeclaration = (ref1 = (arg != null ? arg : {}).isFromDeclaration) != null ? ref1 : false;
    ref2 = this.children, destAst = ref2[0], valueAst = ref2[1];
    ref3 = destAst.compile(state), destType = ref3.type, destReference = ref3.result, exprType = ref3.exprType, lvalueId = ref3.lvalueId, destInstructions = ref3.instructions, isConst = ref3.isConst;
    if (destType instanceof Array) {
      this.compilationError('ASSIGN_TO_ARRAY');
    }
    if (!destType.isAssignable) {
      this.compilationError('ASSIGN_OF_NON_ASSIGNABLE', 'id', lvalueId, 'type', destType.getSymbol());
    }
    ref4 = valueAst.compile(state), valueType = ref4.type, valueInstructions = ref4.instructions, valueReference = ref4.result;
    if (valueType === PRIMITIVE_TYPES.VOID) {
      this.compilationError('VOID_NOT_IGNORED');
    }
    ref5 = ensureType(valueReference, valueType, destType, state, this, {
      onReference: destReference,
      releaseReference: false
    }), castInstructions = ref5.instructions, result = ref5.result;
    if (exprType !== EXPR_TYPES.LVALUE) {
      this.compilationError('LVALUE_ASSIGN');
    }
    if (!isFromDeclaration && isConst) {
      this.compilationError('CONST_MODIFICATION', "name", lvalueId);
    }
    state.releaseTemporaries(valueReference);
    instructions = slice.call(destInstructions).concat(slice.call(valueInstructions), slice.call(castInstructions));
    if (!castInstructions.length) {
      instructions.push(new Assign(destReference, result));
    }
    instructions.forEach((function(_this) {
      return function(x) {
        return x.locations = _this.locations;
      };
    })(this));
    return {
      type: destType,
      instructions: instructions,
      result: destReference,
      exprType: EXPR_TYPES.LVALUE,
      lvalueId: null
    };
  };

  Assign.prototype.execute = function(arg) {
    var dest, memory, ref1, src;
    memory = arg.memory;
    ref1 = this.children, dest = ref1[0], src = ref1[1];
    return dest.write(memory, src.read(memory));
  };

  return Assign;

})(Ast);


},{"./ast":50,"./type":72}],50:[function(require,module,exports){
0;
var Ast, asciitree, compilationError, utils,
  slice = [].slice;

asciitree = require('ascii-tree');

utils = require('../utils');

compilationError = require('../messages').compilationError;

module.exports = this;

this.Ast = Ast = (function() {
  function Ast() {
    var child, children;
    children = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    this.children = children;
    0;
    this.children = (function() {
      var j, len, ref, results;
      ref = this.children;
      results = [];
      for (j = 0, len = ref.length; j < len; j++) {
        child = ref[j];
        if (child !== null) {
          results.push(child);
        }
      }
      return results;
    }).call(this);
    0;
  }

  Ast.prototype.getSymbol = function() {
    return this.name;
  };

  Ast.prototype.addParent = function(ast) {
    var key, ref, results, thisCopy, value;
    thisCopy = new this.constructor();
    ref = this;
    for (key in ref) {
      value = ref[key];
      thisCopy[key] = value;
    }
    ast.addChild(thisCopy);
    results = [];
    for (key in ast) {
      value = ast[key];
      results.push(this[key] = value);
    }
    return results;
  };

  Ast.prototype.child = function() {
    return this.children[0];
  };

  Ast.prototype.left = function() {
    return this.children[0];
  };

  Ast.prototype.right = function() {
    return this.children[1];
  };

  Ast.prototype.getChild = function(i) {
    return this.children[i];
  };

  Ast.prototype.getChildren = function() {
    return this.children;
  };

  Ast.prototype.addChild = function(child) {
    if (child !== null) {
      return this.children.push(child);
    }
  };

  Ast.prototype.setChild = function(i, value) {
    return this.children[i] = value;
  };

  Ast.prototype.getChildCount = function() {
    return this.children.length;
  };

  Ast.copyOf = function(other) {
    return utils.cloneDeep(other);
  };

  Ast.prototype.compilationError = function() {
    var name, others;
    name = arguments[0], others = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    return compilationError.apply(null, [name, this.locations].concat(slice.call(others)));
  };

  Ast.prototype.toObject = function() {
    var child, i, j, l, len, len1, parent, ref, subChild;
    parent = {};
    parent[this.getSymbol()] = [];
    i = 0;
    ref = this.children;
    for (j = 0, len = ref.length; j < len; j++) {
      child = ref[j];
      if (child instanceof Ast) {
        parent[this.getSymbol()][i] = child.toObject();
        ++i;
      } else if (Array.isArray(child)) {
        for (l = 0, len1 = child.length; l < len1; l++) {
          subChild = child[l];
          if (subChild instanceof Ast) {
            parent[this.getSymbol()][i] = subChild.toObject();
          } else {
            parent[this.getSymbol()][i] = subChild;
          }
          ++i;
        }
      } else {
        parent[this.getSymbol()][i] = child;
        ++i;
      }
    }
    return parent;
  };

  Ast.prototype.toString = function() {
    var _traverse, list;
    _traverse = function(list, node, level) {
      var elem, j, len, prefix, results;
      ++level;
      prefix = Array(level + 1).join("#");
      if (node == null) {
        return list.push(prefix + node);
      } else if (Array.isArray(node)) {
        results = [];
        for (j = 0, len = node.length; j < len; j++) {
          elem = node[j];
          results.push(_traverse(list, elem, level - 1));
        }
        return results;
      } else if (typeof node === 'object') {
        return Object.keys(node).forEach(function(k) {
          list.push(prefix + k);
          return _traverse(list, node[k], level);
        });
      } else {
        return list.push(prefix + JSON.stringify(node));
      }
    };
    list = [];
    _traverse(list, this.toObject(), 0);
    return asciitree.generate(list.join('\u000d\n'));
  };

  return Ast;

})();


},{"../messages":90,"../utils":96,"ascii-tree":4}],51:[function(require,module,exports){
var Add, And, Arithmetic, Assign, Ast, BinaryOp, BranchFalse, BranchTrue, Comparison, Div, DoubleDiv, EXPR_TYPES, Eq, Gt, Gte, IntDiv, IntLit, LazyOperator, Lt, Lte, MaybePointerArithmetic, MaybePointerComparison, Mod, Mul, Neq, Or, PRIMITIVE_TYPES, SimpleArithmetic, Sub, ensureType, executionError, invalidOperands, ref1, ref2, ref3, utils,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

Ast = require('./ast').Ast;

ref1 = require('./type'), PRIMITIVE_TYPES = ref1.PRIMITIVE_TYPES, ensureType = ref1.ensureType, EXPR_TYPES = ref1.EXPR_TYPES;

ref2 = require('./branch'), BranchFalse = ref2.BranchFalse, BranchTrue = ref2.BranchTrue;

Assign = require('./assign').Assign;

IntLit = require('./literals').IntLit;

ref3 = require('../messages'), this.compilationError = ref3.compilationError, executionError = ref3.executionError;

utils = require('../utils');

module.exports = this;

invalidOperands = function(left, right, state, ast) {
  return ast.compilationError('INVALID_OPERANDS', "typel", left.type, "typer", right.type);
};

this.BinaryOp = BinaryOp = (function(superClass) {
  extend(BinaryOp, superClass);

  function BinaryOp() {
    return BinaryOp.__super__.constructor.apply(this, arguments);
  }

  BinaryOp.prototype.pointerCase = invalidOperands;

  BinaryOp.prototype.compile = function(state) {
    var castingInstructions, instructions, left, leftResult, operands, ref4, ref5, result, results, right, rightResult, type;
    ref4 = this.children.map(function(x) {
      return x.compile(state);
    }), left = ref4[0], right = ref4[1];
    if (left.type.isPointer || right.type.isPointer || left.type.isArray || right.type.isArray) {
      return this.pointerCase(left, right, state, this);
    }
    operands = [left, right];
    ref5 = this.casting(operands, state), type = ref5.type, results = ref5.results, castingInstructions = ref5.instructions;
    if (left.result !== results[0]) {
      state.releaseTemporaries(left.result);
    }
    if (right.result !== results[1]) {
      state.releaseTemporaries(right.result);
    }
    state.releaseTemporaries.apply(state, results);
    result = state.getTemporary(type);
    leftResult = results[0], rightResult = results[1];
    instructions = slice.call(left.instructions).concat(slice.call(right.instructions), slice.call(castingInstructions), [new this.constructor(result, leftResult, rightResult)]);
    return {
      instructions: instructions,
      result: result,
      type: type,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  BinaryOp.prototype.execute = function(state) {
    var memory, ref4, reference, value1, value2;
    memory = state.memory;
    ref4 = this.children, reference = ref4[0], value1 = ref4[1], value2 = ref4[2];
    return reference.write(memory, this.f(value1.read(memory), value2.read(memory), state));
  };

  return BinaryOp;

})(Ast);

Arithmetic = (function(superClass) {
  extend(Arithmetic, superClass);

  function Arithmetic() {
    return Arithmetic.__super__.constructor.apply(this, arguments);
  }

  Arithmetic.prototype.casting = function(operands, state) {
    var castingInstructions, castingResult, expectedType, i, instructions, j, len, operandResult, operandType, ref4, ref5, results;
    expectedType = this.castType(operands.map(function(x) {
      return x.type;
    }));
    results = [];
    instructions = [];
    for (i = j = 0, len = operands.length; j < len; i = ++j) {
      ref4 = operands[i], operandType = ref4.type, operandResult = ref4.result;
      ref5 = ensureType(operandResult, operandType, expectedType, state, this, {
        releaseReference: false
      }), castingResult = ref5.result, castingInstructions = ref5.instructions;
      instructions = instructions.concat(castingInstructions);
      results.push(castingResult);
    }
    return {
      type: expectedType,
      results: results,
      instructions: instructions
    };
  };

  return Arithmetic;

})(BinaryOp);

SimpleArithmetic = (function(superClass) {
  extend(SimpleArithmetic, superClass);

  function SimpleArithmetic() {
    return SimpleArithmetic.__super__.constructor.apply(this, arguments);
  }

  SimpleArithmetic.prototype.castType = function(operandTypes) {
    var ref4;
    if (ref4 = PRIMITIVE_TYPES.DOUBLE, indexOf.call(operandTypes, ref4) >= 0) {
      return PRIMITIVE_TYPES.DOUBLE;
    } else {
      return PRIMITIVE_TYPES.INT;
    }
  };

  return SimpleArithmetic;

})(Arithmetic);

MaybePointerArithmetic = (function(superClass) {
  extend(MaybePointerArithmetic, superClass);

  function MaybePointerArithmetic() {
    return MaybePointerArithmetic.__super__.constructor.apply(this, arguments);
  }

  MaybePointerArithmetic.prototype.pointerCase = function(left, right, state) {
    var bytes, elementType, instructions, intLitAst, isConst, mulAst, ref, result, type;
    ref = left.type.isPointer || left.type.isArray ? {
      pointer: left,
      left: 'pointer',
      nonPointer: right,
      right: 'nonPointer'
    } : {
      pointer: right,
      left: 'nonPointer',
      nonPointer: left,
      right: 'pointer'
    };
    if (!ref.nonPointer.type.isIntegral) {
      invalidOperands(ref[ref.left], ref[ref.right], null, this);
    }
    elementType = ref.pointer.type.getElementType();
    if (elementType.isIncomplete) {
      this.compilationError('UNALLOWED_ARITHMETIC_INCOMPLETE_TYPE', "type", elementType);
    }
    bytes = elementType.bytes;
    intLitAst = new IntLit(bytes);
    intLitAst.locations = this.locations;
    mulAst = new Mul({
      compile: function() {
        return {
          type: PRIMITIVE_TYPES.INT,
          result: ref.nonPointer.result,
          instructions: ref.nonPointer.instructions
        };
      }
    }, intLitAst);
    mulAst.locations = this.locations;
    ref.nonPointer = mulAst.compile(state);
    state.releaseTemporaries(ref[ref.left].result, ref[ref.right].result);
    type = ref.pointer.type.isArray ? ref.pointer.type.getPointerType() : ref.pointer.type;
    isConst = type.isValueConst;
    result = state.getTemporary(type);
    instructions = slice.call(ref[ref.left].instructions).concat(slice.call(ref[ref.right].instructions), [new this.constructor(result, ref[ref.left].result, ref[ref.right].result)]);
    return {
      result: result,
      instructions: instructions,
      type: type,
      lvalueId: null,
      exprType: EXPR_TYPES.LVALUE,
      isConst: isConst
    };
  };

  return MaybePointerArithmetic;

})(SimpleArithmetic);

this.Add = Add = (function(superClass) {
  extend(Add, superClass);

  function Add() {
    return Add.__super__.constructor.apply(this, arguments);
  }

  Add.prototype.name = "Add";

  Add.prototype.f = function(x, y) {
    return x + y;
  };

  return Add;

})(MaybePointerArithmetic);

this.Sub = Sub = (function(superClass) {
  extend(Sub, superClass);

  function Sub() {
    return Sub.__super__.constructor.apply(this, arguments);
  }

  Sub.prototype.name = "Sub";

  Sub.prototype.f = function(x, y) {
    return x - y;
  };

  return Sub;

})(MaybePointerArithmetic);

this.Mul = Mul = (function(superClass) {
  extend(Mul, superClass);

  function Mul() {
    return Mul.__super__.constructor.apply(this, arguments);
  }

  Mul.prototype.name = "Mul";

  Mul.prototype.f = function(x, y) {
    return x * y;
  };

  return Mul;

})(SimpleArithmetic);

IntDiv = (function(superClass) {
  extend(IntDiv, superClass);

  function IntDiv() {
    return IntDiv.__super__.constructor.apply(this, arguments);
  }

  IntDiv.prototype.name = "IntDiv";

  IntDiv.prototype.f = function(x, y, vm) {
    if (y === 0) {
      executionError(vm, 'DIVISION_BY_ZERO');
    }
    return x / y;
  };

  return IntDiv;

})(BinaryOp);

DoubleDiv = (function(superClass) {
  extend(DoubleDiv, superClass);

  function DoubleDiv() {
    return DoubleDiv.__super__.constructor.apply(this, arguments);
  }

  DoubleDiv.prototype.name = "DoubleDiv";

  DoubleDiv.prototype.f = function(x, y) {
    return x / y;
  };

  return DoubleDiv;

})(BinaryOp);

this.Div = Div = (function(superClass) {
  extend(Div, superClass);

  function Div() {
    return Div.__super__.constructor.apply(this, arguments);
  }

  Div.prototype.name = "Div";

  Div.prototype.castType = function(operandTypes) {
    var resultType;
    resultType = Div.__super__.castType.call(this, operandTypes);
    this.constructor = (function() {
      switch (resultType) {
        case PRIMITIVE_TYPES.INT:
          return IntDiv;
        case PRIMITIVE_TYPES.DOUBLE:
          return DoubleDiv;
        default:
          return 0;
      }
    })();
    return resultType;
  };

  return Div;

})(SimpleArithmetic);

this.Mod = Mod = (function(superClass) {
  extend(Mod, superClass);

  function Mod() {
    return Mod.__super__.constructor.apply(this, arguments);
  }

  Mod.prototype.name = "Mod";

  Mod.prototype.castType = function(arg) {
    var typeLeft, typeRight;
    typeLeft = arg[0], typeRight = arg[1];
    if (!(typeLeft.isIntegral && typeRight.isIntegral)) {
      this.compilationError('NON_INTEGRAL_MODULO');
    }
    return PRIMITIVE_TYPES.INT;
  };

  Mod.prototype.f = function(x, y, vm) {
    if (y === 0) {
      executionError(vm, 'MODULO_BY_ZERO');
    }
    return x % y;
  };

  return Mod;

})(Arithmetic);

LazyOperator = (function(superClass) {
  extend(LazyOperator, superClass);

  function LazyOperator() {
    return LazyOperator.__super__.constructor.apply(this, arguments);
  }

  LazyOperator.prototype.compile = function(state) {
    var castingInstructionsLeft, castingInstructionsRight, instructions, left, ref4, ref5, result, resultLeft, resultRight, right, rightInstructionsSize;
    left = this.left().compile(state);
    ref4 = ensureType(left.result, left.type, PRIMITIVE_TYPES.BOOL, state, this), resultLeft = ref4.result, castingInstructionsLeft = ref4.instructions;
    state.releaseTemporaries(resultLeft);
    right = this.right().compile(state);
    ref5 = ensureType(right.result, right.type, PRIMITIVE_TYPES.BOOL, state, this), resultRight = ref5.result, castingInstructionsRight = ref5.instructions;
    state.releaseTemporaries(resultRight);
    result = state.getTemporary(PRIMITIVE_TYPES.BOOL);
    rightInstructionsSize = right.instructions.length + castingInstructionsRight.length + 1;
    instructions = slice.call(left.instructions).concat(slice.call(castingInstructionsLeft), [new Assign(result, resultLeft)], [new this.branch(resultLeft, rightInstructionsSize)], slice.call(right.instructions), slice.call(castingInstructionsRight), [new Assign(result, resultRight)]);
    return {
      instructions: instructions,
      result: result,
      type: PRIMITIVE_TYPES.BOOL,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  return LazyOperator;

})(Ast);

this.And = And = (function(superClass) {
  extend(And, superClass);

  function And() {
    return And.__super__.constructor.apply(this, arguments);
  }

  And.prototype.name = "And";

  And.prototype.branch = BranchFalse;

  return And;

})(LazyOperator);

this.Or = Or = (function(superClass) {
  extend(Or, superClass);

  function Or() {
    return Or.__super__.constructor.apply(this, arguments);
  }

  Or.prototype.name = "Or";

  Or.prototype.branch = BranchTrue;

  return Or;

})(LazyOperator);

MaybePointerComparison = (function(superClass) {
  extend(MaybePointerComparison, superClass);

  function MaybePointerComparison() {
    return MaybePointerComparison.__super__.constructor.apply(this, arguments);
  }

  MaybePointerComparison.prototype.pointerCase = function(left, right, state) {
    var result;
    if (!((left.type.isPointer || left.type.isArray || left.type.isNullPtr) && (right.type.isPointer || right.type.isArray || right.type.isNullPtr))) {
      invalidOperands(left, right, null, this);
    }
    if (left.type.isArray) {
      left.type = left.type.getPointerType();
    }
    if (right.type.isArray) {
      right.type = right.type.getPointerType();
    }
    if (!(left.type.isNullPtr || right.type.isNullPtr || left.type.equalsNoConst(right.type))) {
      this.compilationError('POINTER_COMPARISON_DIFFERENT_TYPE', 'typeL', left.type.getSymbol(), 'typeR', right.type.getSymbol());
    }
    state.releaseTemporaries(left.result, right.result);
    result = state.getTemporary(PRIMITIVE_TYPES.BOOL);
    return {
      type: PRIMITIVE_TYPES.BOOL,
      result: result,
      instructions: slice.call(left.instructions).concat(slice.call(right.instructions), [new this.constructor(result, left.result, right.result)])
    };
  };

  return MaybePointerComparison;

})(BinaryOp);

Comparison = (function(superClass) {
  extend(Comparison, superClass);

  function Comparison() {
    return Comparison.__super__.constructor.apply(this, arguments);
  }

  Comparison.prototype.casting = function(operands, state) {
    var actualTypes, castingInstructions, castingResult, instructions, j, len, operandResult, operandType, ref4, ref5, ref6, results, typeLeft, typeRight;
    ref4 = actualTypes = operands.map(function(x) {
      return x.type;
    }), typeLeft = ref4[0], typeRight = ref4[1];
    results = [];
    instructions = [];
    if (typeLeft !== typeRight) {
      for (j = 0, len = operands.length; j < len; j++) {
        ref5 = operands[j], operandType = ref5.type, operandResult = ref5.result;
        ref6 = ensureType(operandResult, operandType, utils.max(actualTypes, function(t) {
          return t.size;
        }).arg, state, this, {
          releaseReference: false
        }), castingResult = ref6.result, castingInstructions = ref6.instructions;
        instructions = instructions.concat(castingInstructions);
        results.push(castingResult);
      }
    } else {
      results = operands.map(function(x) {
        return x.result;
      });
      instructions = [];
    }
    return {
      type: PRIMITIVE_TYPES.BOOL,
      results: results,
      instructions: instructions
    };
  };

  return Comparison;

})(MaybePointerComparison);

this.Lt = Lt = (function(superClass) {
  extend(Lt, superClass);

  function Lt() {
    return Lt.__super__.constructor.apply(this, arguments);
  }

  Lt.prototype.name = "Lt";

  Lt.prototype.f = function(x, y) {
    return x < y;
  };

  return Lt;

})(Comparison);

this.Lte = Lte = (function(superClass) {
  extend(Lte, superClass);

  function Lte() {
    return Lte.__super__.constructor.apply(this, arguments);
  }

  Lte.prototype.name = "Lte";

  Lte.prototype.f = function(x, y) {
    return x <= y;
  };

  return Lte;

})(Comparison);

this.Gt = Gt = (function(superClass) {
  extend(Gt, superClass);

  function Gt() {
    return Gt.__super__.constructor.apply(this, arguments);
  }

  Gt.prototype.name = "Gt";

  Gt.prototype.f = function(x, y) {
    return x > y;
  };

  return Gt;

})(Comparison);

this.Gte = Gte = (function(superClass) {
  extend(Gte, superClass);

  function Gte() {
    return Gte.__super__.constructor.apply(this, arguments);
  }

  Gte.prototype.name = "Gte";

  Gte.prototype.f = function(x, y) {
    return x >= y;
  };

  return Gte;

})(Comparison);

this.Eq = Eq = (function(superClass) {
  extend(Eq, superClass);

  function Eq() {
    return Eq.__super__.constructor.apply(this, arguments);
  }

  Eq.prototype.name = "Eq";

  Eq.prototype.f = function(x, y) {
    return x === y;
  };

  return Eq;

})(Comparison);

this.Neq = Neq = (function(superClass) {
  extend(Neq, superClass);

  function Neq() {
    return Neq.__super__.constructor.apply(this, arguments);
  }

  Neq.prototype.name = "Neq";

  Neq.prototype.f = function(x, y) {
    return x !== y;
  };

  return Neq;

})(Comparison);


},{"../messages":90,"../utils":96,"./assign":49,"./ast":50,"./branch":52,"./literals":66,"./type":72}],52:[function(require,module,exports){
var Ast, Branch, BranchFalse, BranchTrue,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

module.exports = this;

this.Branch = Branch = (function(superClass) {
  extend(Branch, superClass);

  function Branch() {
    return Branch.__super__.constructor.apply(this, arguments);
  }

  Branch.prototype.name = "Branch";

  Branch.prototype.execute = function(vm) {
    var jumpOffset;
    jumpOffset = this.children[0];
    return vm.pointers.instruction += jumpOffset;
  };

  return Branch;

})(Ast);

this.BranchFalse = BranchFalse = (function(superClass) {
  extend(BranchFalse, superClass);

  function BranchFalse() {
    return BranchFalse.__super__.constructor.apply(this, arguments);
  }

  BranchFalse.prototype.name = "BranchFalse";

  BranchFalse.prototype.execute = function(vm) {
    var conditionReference, jumpOffset, ref;
    ref = this.children, conditionReference = ref[0], jumpOffset = ref[1];
    if (!conditionReference.read(vm.memory)) {
      return vm.pointers.instruction += jumpOffset;
    }
  };

  return BranchFalse;

})(Ast);

this.BranchTrue = BranchTrue = (function(superClass) {
  extend(BranchTrue, superClass);

  function BranchTrue() {
    return BranchTrue.__super__.constructor.apply(this, arguments);
  }

  BranchTrue.prototype.name = "BranchTrue";

  BranchTrue.prototype.execute = function(vm) {
    var conditionReference, jumpOffset, ref;
    ref = this.children, conditionReference = ref[0], jumpOffset = ref[1];
    if (conditionReference.read(vm.memory)) {
      return vm.pointers.instruction += jumpOffset;
    }
  };

  return BranchTrue;

})(Ast);


},{"./ast":50}],53:[function(require,module,exports){
var Ast, BranchFalse, Cin, EXPR_TYPES, PRIMITIVE_TYPES, Read, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, EXPR_TYPES = ref.EXPR_TYPES;

Read = require('./read').Read;

BranchFalse = require('./branch').BranchFalse;

module.exports = this;

this.Cin = Cin = (function(superClass) {
  extend(Cin, superClass);

  function Cin() {
    return Cin.__super__.constructor.apply(this, arguments);
  }

  Cin.prototype.name = "Cin";

  Cin.prototype.compile = function(state) {
    var destAst, destInstructions, exprType, i, instructions, isConst, j, jumpOffset, len, lvalueId, memoryReference, ref1, ref2, result, type;
    instructions = [];
    result = state.getTemporary(PRIMITIVE_TYPES.BOOL);
    ref1 = this.children;
    for (i = j = 0, len = ref1.length; j < len; i = ++j) {
      destAst = ref1[i];
      ref2 = destAst.compile(state), exprType = ref2.exprType, type = ref2.type, memoryReference = ref2.result, lvalueId = ref2.lvalueId, destInstructions = ref2.instructions, isConst = ref2.isConst;
      if (type !== PRIMITIVE_TYPES.STRING && type !== PRIMITIVE_TYPES.INT && type !== PRIMITIVE_TYPES.DOUBLE && type !== PRIMITIVE_TYPES.CHAR && type !== PRIMITIVE_TYPES.BOOL) {
        destAst.compilationError('INVALID_CIN_OPERAND', 'type', type.getSymbol());
      }
      if (exprType !== EXPR_TYPES.LVALUE) {
        destAst.compilationError('LVALUE_CIN');
      }
      if (isConst) {
        destAst.compilationError('CONST_MODIFICATION', "name", lvalueId);
      }
      state.releaseTemporaries(memoryReference);
      instructions = instructions.concat(slice.call(destInstructions).concat([new Read(result, memoryReference)]));
      if (i !== this.children.length - 1) {
        jumpOffset = this.children.length - i - 1;
        instructions.push(new BranchFalse(result, +jumpOffset));
      }
    }
    instructions.forEach((function(_this) {
      return function(x) {
        return x.locations = _this.locations;
      };
    })(this));
    return {
      type: PRIMITIVE_TYPES.CIN,
      result: result,
      instructions: instructions,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  return Cin;

})(Ast);


},{"./ast":50,"./branch":52,"./read":70,"./type":72}],54:[function(require,module,exports){
var Ast, Branch, BranchFalse, CloseScope, IfThen, IfThenElse, OpenScope, PRIMITIVE_TYPES, countInstructions, ensureType, ref, ref1, ref2,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType;

ref1 = require('./branch'), Branch = ref1.Branch, BranchFalse = ref1.BranchFalse;

ref2 = require('./debug-info'), OpenScope = ref2.OpenScope, CloseScope = ref2.CloseScope;

countInstructions = require('../utils').countInstructions;

module.exports = this;

this.IfThen = IfThen = (function(superClass) {
  extend(IfThen, superClass);

  function IfThen() {
    return IfThen.__super__.constructor.apply(this, arguments);
  }

  IfThen.prototype.name = "IfThen";

  IfThen.prototype.compile = function(state) {
    var branch, castingInstructions, castingResult, conditionAst, conditionInstructions, conditionResult, conditionType, instructions, ref3, ref4, ref5, thenBody, thenInstructions, topInstructions;
    ref3 = this.children, conditionAst = ref3[0], thenBody = ref3[1];
    ref4 = conditionAst.compile(state), conditionType = ref4.type, conditionResult = ref4.result, conditionInstructions = ref4.instructions;
    ref5 = ensureType(conditionResult, conditionType, PRIMITIVE_TYPES.BOOL, state, conditionAst), castingInstructions = ref5.instructions, castingResult = ref5.result;
    state.releaseTemporaries(castingResult);
    state.openScope();
    thenInstructions = thenBody.compile(state).instructions;
    state.closeScope();
    branch = new BranchFalse(castingResult, countInstructions(thenInstructions));
    topInstructions = slice.call(conditionInstructions).concat(slice.call(castingInstructions));
    topInstructions.forEach((function(_this) {
      return function(x) {
        return x.locations = conditionAst.locations;
      };
    })(this));
    instructions = slice.call(topInstructions).concat([branch], [new OpenScope()], slice.call(thenInstructions), [new CloseScope()]);
    return {
      type: PRIMITIVE_TYPES.VOID,
      branch: branch,
      instructions: instructions
    };
  };

  return IfThen;

})(Ast);

this.IfThenElse = IfThenElse = (function(superClass) {
  extend(IfThenElse, superClass);

  function IfThenElse() {
    return IfThenElse.__super__.constructor.apply(this, arguments);
  }

  IfThenElse.prototype.name = "IfThenElse";

  IfThenElse.prototype.compile = function(state) {
    var _, branch, branchOffset, elseBody, elseInstructions, instructions, ref3, ref4, ref5, type;
    ref3 = this.children, _ = ref3[0], _ = ref3[1], elseBody = ref3[2];
    ref4 = IfThenElse.__super__.compile.call(this, state), type = ref4.type, instructions = ref4.instructions, branch = ref4.branch;
    ref5 = branch.children, _ = ref5[0], branchOffset = ref5[1];
    branch.setChild(1, branchOffset + 1);
    state.openScope();
    elseInstructions = elseBody.compile(state).instructions;
    state.closeScope();
    return {
      type: type,
      instructions: slice.call(instructions).concat([new Branch(countInstructions(elseInstructions))], [new OpenScope()], slice.call(elseInstructions), [new CloseScope()])
    };
  };

  return IfThenElse;

})(this.IfThen);


},{"../utils":96,"./ast":50,"./branch":52,"./debug-info":56,"./type":72}],55:[function(require,module,exports){
var Ast, Cout, PRIMITIVE_TYPES, Write, ensureType, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType;

Write = require('./write').Write;

module.exports = this;

this.Cout = Cout = (function(superClass) {
  extend(Cout, superClass);

  function Cout() {
    return Cout.__super__.constructor.apply(this, arguments);
  }

  Cout.prototype.name = "Cout";

  Cout.prototype.compile = function(state) {
    var i, instructions, len, ref1, ref2, result, type, value, valueInstructions;
    instructions = [];
    ref1 = this.children;
    for (i = 0, len = ref1.length; i < len; i++) {
      value = ref1[i];
      ref2 = value.compile(state), result = ref2.result, valueInstructions = ref2.instructions, type = ref2.type;
      if (!type.canCastTo(PRIMITIVE_TYPES.COUT)) {
        value.compilationError('CANNOT_COUT_TYPE', "type", type.getSymbol());
      }
      state.releaseTemporaries(result);
      instructions = instructions.concat(valueInstructions);
      instructions.push(new Write(result));
    }
    instructions.forEach((function(_this) {
      return function(x) {
        return x.locations = _this.locations;
      };
    })(this));
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: instructions
    };
  };

  return Cout;

})(Ast);


},{"./ast":50,"./type":72,"./write":75}],56:[function(require,module,exports){
var Ast, CloseScope, DebugInfo, FunctionDefinition, OpenScope, VariableDeclaration,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

module.exports = this;

this.DebugInfo = DebugInfo = (function(superClass) {
  extend(DebugInfo, superClass);

  function DebugInfo() {
    return DebugInfo.__super__.constructor.apply(this, arguments);
  }

  DebugInfo.prototype.isDebugInfo = true;

  DebugInfo.prototype.execute = function() {};

  return DebugInfo;

})(Ast);

this.OpenScope = OpenScope = (function(superClass) {
  extend(OpenScope, superClass);

  function OpenScope() {
    return OpenScope.__super__.constructor.apply(this, arguments);
  }

  OpenScope.prototype.name = "OpenScope";

  OpenScope.prototype.openScope = true;

  return OpenScope;

})(DebugInfo);

this.CloseScope = CloseScope = (function(superClass) {
  extend(CloseScope, superClass);

  function CloseScope() {
    return CloseScope.__super__.constructor.apply(this, arguments);
  }

  CloseScope.prototype.name = "CloseScope";

  CloseScope.prototype.closeScope = true;

  return CloseScope;

})(DebugInfo);

this.VariableDeclaration = VariableDeclaration = (function(superClass) {
  extend(VariableDeclaration, superClass);

  function VariableDeclaration() {
    return VariableDeclaration.__super__.constructor.apply(this, arguments);
  }

  VariableDeclaration.prototype.name = "VariableDeclaration";

  VariableDeclaration.prototype.variableDeclaration = true;

  return VariableDeclaration;

})(DebugInfo);

this.FunctionDefinition = FunctionDefinition = (function(superClass) {
  extend(FunctionDefinition, superClass);

  function FunctionDefinition() {
    return FunctionDefinition.__super__.constructor.apply(this, arguments);
  }

  FunctionDefinition.prototype.name = "FunctionDefinition";

  FunctionDefinition.prototype.functionDefinition = true;

  return FunctionDefinition;

})(DebugInfo);


},{"./ast":50}],57:[function(require,module,exports){
var Array, ArrayDeclaration, Assign, Ast, ConstDeclaration, DeclarationAssign, DeclarationGroup, EmptyDimension, FunctionType, FunctionVar, Id, IdDeclaration, PRIMITIVE_TYPES, Pointer, PointerDeclaration, Reference, Variable, VariableDeclaration, getSpecifiers, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, Array = ref.Array, Pointer = ref.Pointer, Reference = ref.Reference, FunctionType = ref.FunctionType;

Id = require('./id').Id;

Variable = require('../compiler/semantics/variable').Variable;

FunctionVar = require('../compiler/semantics/function-var').FunctionVar;

Assign = require('./assign').Assign;

VariableDeclaration = require('./debug-info').VariableDeclaration;

module.exports = this;

this.EmptyDimension = EmptyDimension = (function(superClass) {
  extend(EmptyDimension, superClass);

  function EmptyDimension() {
    return EmptyDimension.__super__.constructor.apply(this, arguments);
  }

  EmptyDimension.prototype.name = "EmptyDimension";

  EmptyDimension.prototype.isEmptyDimension = true;

  return EmptyDimension;

})(Ast);

this.getSpecifiers = getSpecifiers = function(specifiersList, state, ast) {
  var i, len, name, specifier, specifiers, type, v;
  specifiers = {};
  for (i = 0, len = specifiersList.length; i < len; i++) {
    specifier = specifiersList[i];
    if (typeof specifier === "string") {
      name = specifier;
      v = true;
    } else {
      name = "TYPE";
      v = specifier;
    }
    if (specifiers[name] != null) {
      ast.compilationError('DUPLICATE_SPECIFIER', 'specifier', name);
    } else {
      specifiers[name] = v;
    }
  }
  if (specifiers.TYPE == null) {
    if (state != null ? state.iAmInsideFunctionReturnDefinition() : void 0) {
      ast.compilationError('NO_RETURN_TYPE');
    } else {
      ast.compilationError('NO_TYPE_SPECIFIER');
    }
  } else {
    type = specifiers.TYPE;
    delete specifiers.TYPE;
  }
  return {
    specifiers: specifiers,
    type: type
  };
};

this.DeclarationGroup = DeclarationGroup = (function(superClass) {
  var findId;

  extend(DeclarationGroup, superClass);

  function DeclarationGroup() {
    return DeclarationGroup.__super__.constructor.apply(this, arguments);
  }

  DeclarationGroup.prototype.name = "DeclarationGroup";

  DeclarationGroup.prototype.getSpecifiers = function(state) {
    return getSpecifiers(this.children[0], state, this);
  };

  findId = function(declarationAst) {
    var id;
    while (!(declarationAst instanceof IdDeclaration)) {
      declarationAst = declarationAst.child();
    }
    id = declarationAst.children[0].children[0];
    return {
      id: id,
      idAst: declarationAst
    };
  };

  DeclarationGroup.prototype.compile = function(state) {
    var _, declaration, declarationInstructions, declarations, i, id, idAst, instructions, len, ref1, ref2, ref3, specifiers, type;
    ref1 = this.children, _ = ref1[0], declarations = ref1[1];
    ref2 = this.getSpecifiers(state), specifiers = ref2.specifiers, type = ref2.type;
    instructions = [];
    for (i = 0, len = declarations.length; i < len; i++) {
      declaration = declarations[i];
      ref3 = findId(declaration), id = ref3.id, idAst = ref3.idAst;
      declarationInstructions = declaration.compile(state, {
        specifiers: specifiers,
        type: type,
        id: id,
        idAst: idAst
      }).instructions;
      instructions = instructions.concat(declarationInstructions);
    }
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: instructions
    };
  };

  return DeclarationGroup;

})(Ast);

this.IdDeclaration = IdDeclaration = (function(superClass) {
  extend(IdDeclaration, superClass);

  function IdDeclaration() {
    return IdDeclaration.__super__.constructor.apply(this, arguments);
  }

  IdDeclaration.prototype.name = "IdDeclaration";

  IdDeclaration.prototype.compile = function(state, arg) {
    var id, idAst, insideFunctionArgumentDefinitions, isReturnDefinition, specifiers, type, variable;
    specifiers = arg.specifiers, type = arg.type, id = arg.id, idAst = arg.idAst;
    isReturnDefinition = state.iAmInsideFunctionReturnDefinition();
    insideFunctionArgumentDefinitions = state.iAmInsideFunctionArgumentDefinitions();
    if (!isReturnDefinition && type === PRIMITIVE_TYPES.VOID) {
      if (insideFunctionArgumentDefinitions) {
        this.compilationError('VOID_FUNCTION_ARGUMENT', 'argument', id, 'function', state.functionId);
      } else {
        this.compilationError('VOID_DECLARATION', 'name', id);
      }
    }
    if (type.isArray && (type.size == null) && !insideFunctionArgumentDefinitions) {
      this.compilationError('STORAGE_UNKNOWN', 'id', id);
    }
    variable = type.isArray && insideFunctionArgumentDefinitions ? state.defineVariable(new Variable(id, new Pointer(type.getElementType()), {
      specifiers: specifiers
    }), idAst) : isReturnDefinition ? (state.newFunction(new FunctionVar(id, new FunctionType(type)), idAst), null) : state.defineVariable(new Variable(id, type, {
      specifiers: specifiers
    }), idAst);
    return {
      instructions: (variable != null ? [new VariableDeclaration(variable)] : []),
      id: id
    };
  };

  return IdDeclaration;

})(Ast);

this.ArrayDeclaration = ArrayDeclaration = (function(superClass) {
  extend(ArrayDeclaration, superClass);

  function ArrayDeclaration() {
    return ArrayDeclaration.__super__.constructor.apply(this, arguments);
  }

  ArrayDeclaration.prototype.name = "ArrayDeclaration";

  ArrayDeclaration.prototype.compile = function(state, arg) {
    var dimension, dimensionAst, dimensionType, id, idAst, innerDeclarationAst, parentDimensionAst, ref1, ref2, specifiers, type;
    specifiers = arg.specifiers, type = arg.type, id = arg.id, idAst = arg.idAst, parentDimensionAst = arg.parentDimensionAst;
    ref1 = this.children, innerDeclarationAst = ref1[0], dimensionAst = ref1[1];
    if (state.iAmInsideFunctionReturnDefinition()) {
      this.compilationError('ARRAY_OF_FUNCTIONS', 'id', id);
    }
    if (!dimensionAst.isEmptyDimension) {
      ref2 = dimensionAst.compile(state), dimension = ref2.staticValue, dimensionType = ref2.type;
      if (dimension == null) {
        dimensionAst.compilationError('STATIC_SIZE_ARRAY', 'id', id);
      }
      if (!dimensionType.isIntegral) {
        dimensionAst.compilationError('NONINTEGRAL_DIMENSION', 'type', dimensionType.getSymbol(), 'id', id);
      }
      if (dimension < 0) {
        dimensionAst.compilationError('ARRAY_SIZE_NEGATIVE', 'id', id);
      }
    }
    if (type === PRIMITIVE_TYPES.VOID) {
      this.compilationError('INVALID_ARRAY_DECLARATION_TYPE', 'name', id, 'type', type.getSymbol());
    }
    if (type === PRIMITIVE_TYPES.STRING) {
      this.compilationError('STRING_ARRAY');
    }
    if (type.isArray && (type.size == null)) {
      parentDimensionAst.compilationError('ALL_BOUNDS_EXCEPT_FIRST', 'id', id);
    }
    type = new Array(dimension, type, {
      isValueConst: (specifiers != null ? specifiers["const"] : void 0) || (type.isArray && type.isValueConst)
    });
    return innerDeclarationAst.compile(state, {
      type: type,
      id: id,
      idAst: idAst,
      parentDimensionAst: dimensionAst
    });
  };

  return ArrayDeclaration;

})(Ast);

this.PointerDeclaration = PointerDeclaration = (function(superClass) {
  extend(PointerDeclaration, superClass);

  function PointerDeclaration() {
    return PointerDeclaration.__super__.constructor.apply(this, arguments);
  }

  PointerDeclaration.prototype.name = "PointerDeclaration";

  PointerDeclaration.prototype.compile = function(state, arg) {
    var id, idAst, innerDeclarationAst, specifiers, type;
    specifiers = arg.specifiers, type = arg.type, id = arg.id, idAst = arg.idAst;
    if (type === PRIMITIVE_TYPES.STRING) {
      this.compilationError('STRING_POINTER');
    }
    if (type.isArray && (type.size == null) && state.iAmInsideFunctionArgumentDefinitions()) {
      this.compilationError('POINTER_UNBOUND_SIZE', "type", type.getSymbol(), "id", id);
    }
    type = new Pointer(type, {
      isValueConst: specifiers != null ? specifiers["const"] : void 0
    });
    innerDeclarationAst = this.children[0];
    return innerDeclarationAst.compile(state, {
      type: type,
      id: id,
      idAst: idAst
    });
  };

  return PointerDeclaration;

})(Ast);

this.ConstDeclaration = ConstDeclaration = (function(superClass) {
  extend(ConstDeclaration, superClass);

  function ConstDeclaration() {
    return ConstDeclaration.__super__.constructor.apply(this, arguments);
  }

  ConstDeclaration.prototype.name = "PointerDeclaration";

  ConstDeclaration.prototype.compile = function(state, arg) {
    var id, idAst, innerDeclarationAst, type;
    type = arg.type, id = arg.id, idAst = arg.idAst;
    innerDeclarationAst = this.children[0];
    return innerDeclarationAst.compile(state, {
      specifiers: {
        "const": true
      },
      type: type,
      id: id,
      idAst: idAst
    });
  };

  return ConstDeclaration;

})(Ast);

this.DeclarationAssign = DeclarationAssign = (function(superClass) {
  extend(DeclarationAssign, superClass);

  function DeclarationAssign() {
    return DeclarationAssign.__super__.constructor.apply(this, arguments);
  }

  DeclarationAssign.prototype.name = "DeclarationAssign";

  DeclarationAssign.prototype.compile = function(state, arg) {
    var assignAst, assignInstructions, declaration, declarationInstructions, id, idAst, innerIdAst, ref1, ref2, specifiers, type, value;
    specifiers = arg.specifiers, type = arg.type, id = arg.id, idAst = arg.idAst;
    ref1 = this.children, declaration = ref1[0], value = ref1[1];
    ref2 = declaration.compile(state, {
      specifiers: specifiers,
      type: type,
      id: id,
      isInitialized: true,
      idAst: idAst
    }), id = ref2.id, declarationInstructions = ref2.instructions;
    innerIdAst = new Id(id);
    innerIdAst.locations = idAst.locations;
    assignAst = new Assign(innerIdAst, value);
    assignAst.locations = this.locations;
    assignInstructions = assignAst.compile(state, {
      isFromDeclaration: true
    }).instructions;
    return {
      instructions: slice.call(declarationInstructions).concat(slice.call(assignInstructions))
    };
  };

  return DeclarationAssign;

})(Ast);


},{"../compiler/semantics/function-var":82,"../compiler/semantics/variable":84,"./assign":49,"./ast":50,"./debug-info":56,"./id":62,"./type":72}],58:[function(require,module,exports){
var Ast, Dereference, EXPR_TYPES, IntLit, PointerMemoryReference,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

PointerMemoryReference = require('./memory-reference').PointerMemoryReference;

IntLit = require('./literals').IntLit;

EXPR_TYPES = require('./type').EXPR_TYPES;

module.exports = this;

this.Dereference = Dereference = (function(superClass) {
  extend(Dereference, superClass);

  function Dereference() {
    return Dereference.__super__.constructor.apply(this, arguments);
  }

  Dereference.prototype.name = "Dereference";

  Dereference.prototype.compile = function(state) {
    var isConst, ref, result, type, valueAst, valueInstructions, valueResult;
    valueAst = this.children[0];
    ref = valueAst.compile(state), type = ref.type, valueResult = ref.result, valueInstructions = ref.instructions;
    if (!(type.isPointer || type.isArray)) {
      this.compilationError('INVALID_DEREFERENCE_TYPE', "type", type.getSymbol());
    }
    if (type.isArray) {
      type = type.getPointerType();
    }
    isConst = type.isValueConst;
    type = type.getElementType();
    if (type.isArray) {
      type = type.getPointerType();
      result = valueResult;
    } else {
      result = new PointerMemoryReference(type, valueResult, new IntLit(0));
    }
    return {
      type: type,
      result: result,
      exprType: EXPR_TYPES.LVALUE,
      lvalueId: null,
      isConst: isConst,
      instructions: valueInstructions
    };
  };

  return Dereference;

})(Ast);


},{"./ast":50,"./literals":66,"./memory-reference":67,"./type":72}],59:[function(require,module,exports){
var Ast, BoolLit, Branch, BranchFalse, CloseScope, For, OpenScope, PRIMITIVE_TYPES, countInstructions, ensureType, ref, ref1, ref2,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType;

ref1 = require('./branch'), Branch = ref1.Branch, BranchFalse = ref1.BranchFalse;

BoolLit = require('./literals').BoolLit;

ref2 = require('./debug-info'), OpenScope = ref2.OpenScope, CloseScope = ref2.CloseScope;

countInstructions = require('../utils').countInstructions;

module.exports = this;

this.For = For = (function(superClass) {
  extend(For, superClass);

  function For() {
    return For.__super__.constructor.apply(this, arguments);
  }

  For.prototype.name = "For";

  For.prototype.compile = function(state) {
    var afterInstructionCount, afterInstructions, afterIteration, afterResult, body, bodyInstructions, bodyInstructionsCount, castingInstructions, castingInstructionsCount, castingResult, condition, conditionInstructions, conditionInstructionsCount, conditionResult, conditionType, init, instructionsInit, ref3, ref4, ref5, ref6, topInstructions;
    ref3 = this.children, init = ref3[0], condition = ref3[1], afterIteration = ref3[2], body = ref3[3];
    state.openScope();
    if (init !== false) {
      instructionsInit = init.compile(state).instructions;
    } else {
      instructionsInit = [];
    }
    if (condition !== false) {
      ref4 = condition.compile(state), conditionType = ref4.type, conditionInstructions = ref4.instructions, conditionResult = ref4.result;
    } else {
      conditionInstructions = [];
      conditionType = PRIMITIVE_TYPES.BOOL;
      conditionResult = new BoolLit(1);
    }
    ref5 = ensureType(conditionResult, conditionType, PRIMITIVE_TYPES.BOOL, state, this), castingInstructions = ref5.instructions, castingResult = ref5.result;
    if (castingResult != null) {
      state.releaseTemporaries(castingResult);
    }
    bodyInstructions = body.compile(state).instructions;
    if (afterIteration !== false) {
      ref6 = afterIteration.compile(state), afterInstructions = ref6.instructions, afterResult = ref6.result;
    } else {
      afterInstructions = [];
    }
    if (afterResult != null) {
      state.releaseTemporaries(afterResult);
    }
    state.closeScope();
    instructionsInit.forEach(function(x) {
      return x.locations = init.locations;
    });
    topInstructions = slice.call(conditionInstructions).concat(slice.call(castingInstructions));
    topInstructions.forEach(function(x) {
      return x.locations = condition.locations;
    });
    afterInstructions.forEach(function(x) {
      return x.locations = afterIteration.locations;
    });
    afterInstructionCount = countInstructions(afterInstructions);
    bodyInstructionsCount = countInstructions(bodyInstructions);
    conditionInstructionsCount = countInstructions(conditionInstructions);
    castingInstructionsCount = countInstructions(castingInstructions);
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: [new OpenScope()].concat(slice.call(instructionsInit), slice.call(topInstructions), [new BranchFalse(castingResult, bodyInstructionsCount + afterInstructionCount + 1)], slice.call(bodyInstructions), slice.call(afterInstructions), [new Branch(-(afterInstructionCount + bodyInstructionsCount + 1 + castingInstructionsCount + conditionInstructionsCount + 1))], [new CloseScope()])
    };
  };

  return For;

})(Ast);


},{"../utils":96,"./ast":50,"./branch":52,"./debug-info":56,"./literals":66,"./type":72}],60:[function(require,module,exports){
0;
var Assign, Ast, CALL_DEPTH_LIMIT, EXPR_TYPES, Funcall, Memory, MemoryReference, PRIMITIVE_TYPES, ParamPush, StackReference, alignTo, ensureType, executionError, ref1, ref2,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref1 = require('./type'), PRIMITIVE_TYPES = ref1.PRIMITIVE_TYPES, ensureType = ref1.ensureType, EXPR_TYPES = ref1.EXPR_TYPES;

ref2 = require('./memory-reference'), MemoryReference = ref2.MemoryReference, StackReference = ref2.StackReference;

Assign = require('./assign').Assign;

alignTo = require('../utils').alignTo;

Memory = require('../runtime/memory').Memory;

executionError = require('../messages').executionError;

CALL_DEPTH_LIMIT = 20000000;

module.exports = this;

this.Funcall = Funcall = (function(superClass) {
  extend(Funcall, superClass);

  function Funcall() {
    return Funcall.__super__.constructor.apply(this, arguments);
  }

  Funcall.prototype.name = "Funcall";

  Funcall.prototype.compile = function(state) {
    var actualType, castingInstructions, castingResult, desiredOffset, expectedParamTypes, func, funcId, i, instructions, j, k, len, len1, offset, param, paramInstructions, paramList, paramPushResult, paramPushResults, paramResult, ref3, ref4, ref5, ref6, ref7, ref8, result, returnReference, returnType, tmp, type;
    ref3 = this.children, (ref4 = ref3[0], (ref5 = ref4.children, funcId = ref5[0])), paramList = ref3[1];
    func = state.getVariable(funcId);
    if (func == null) {
      this.compilationError('CALL_FUNCTION_NOT_DEFINED', 'name', funcId);
    }
    type = func.type, (ref6 = func.type, returnType = ref6.returnType, expectedParamTypes = ref6.argTypes);
    if (!type.isFunction) {
      this.compilationError('CALL_NON_FUNCTION', 'name', funcId);
    }
    if (paramList.length !== expectedParamTypes.length) {
      this.compilationError('INVALID_PARAMETER_COUNT_CALL', 'name', funcId, 'good', expectedParamTypes.length, 'wrong', paramList.length);
    }
    instructions = [];
    paramPushResults = [];
    for (i = j = 0, len = paramList.length; j < len; i = ++j) {
      param = paramList[i];
      ref7 = param.compile(state), actualType = ref7.type, paramInstructions = ref7.instructions, paramResult = ref7.result;
      ref8 = ensureType(paramResult, actualType, expectedParamTypes[i], state, this), castingInstructions = ref8.instructions, castingResult = ref8.result;
      paramPushResults.push(castingResult);
      instructions = instructions.concat(slice.call(paramInstructions).concat(slice.call(castingInstructions)));
    }
    offset = 0;
    for (k = 0, len1 = paramPushResults.length; k < len1; k++) {
      paramPushResult = paramPushResults[k];
      state.releaseTemporaries(paramPushResult);
      desiredOffset = alignTo(offset, paramPushResult.getType().requiredAlignment());
      instructions.push(new ParamPush(paramPushResult, desiredOffset));
      offset = desiredOffset + paramPushResult.getType().bytes;
    }
    instructions.push(new Funcall(funcId, state.temporaryAddressOffset));
    result = returnType !== PRIMITIVE_TYPES.VOID ? (tmp = state.getTemporary(returnType), returnReference = MemoryReference.from(returnType, null, MemoryReference.RETURN), instructions.push(new Assign(tmp, returnReference)), tmp) : null;
    instructions.forEach((function(_this) {
      return function(x) {
        return x.locations = _this.locations;
      };
    })(this));
    return {
      type: returnType,
      result: result,
      instructions: instructions,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  Funcall.prototype.execute = function(vm) {
    var funcId, ref3, temporaryOffset;
    ref3 = this.children, funcId = ref3[0], temporaryOffset = ref3[1];
    vm.controlStack.push({
      func: vm.func,
      instruction: vm.pointers.instruction,
      temporariesOffset: vm.pointers.temporaries
    });
    vm.pointers.temporaries += temporaryOffset;
    if (!(vm.pointers.temporaries + vm.func.maxTmpSize <= Memory.SIZES.tmp)) {
      executionError(vm, 'TEMPORARIES_OVERFLOW', 'id', funcId);
    }
    vm.pointers.stack += vm.func.stackSize;
    if (!(vm.pointers.stack + vm.func.stackSize <= Memory.SIZES.stack && vm.controlStack.length < CALL_DEPTH_LIMIT)) {
      executionError(vm, 'STACK_OVERFLOW', 'id', funcId);
    }
    0;
    vm.pointers.instruction = -1;
    vm.func = vm.functions[funcId];
    return vm.instructions = vm.func.instructions;
  };

  Funcall.prototype.isFuncall = true;

  return Funcall;

})(Ast);

this.ParamPush = ParamPush = (function(superClass) {
  extend(ParamPush, superClass);

  function ParamPush() {
    return ParamPush.__super__.constructor.apply(this, arguments);
  }

  ParamPush.prototype.name = "ParamPush";

  ParamPush.prototype.execute = function(arg) {
    var func, memory, offset, ref, ref3, value;
    memory = arg.memory, func = arg.func;
    ref3 = this.children, value = ref3[0], offset = ref3[1];
    ref = new StackReference(value.getType(), func.stackSize + offset);
    return ref.write(memory, value.read(memory));
  };

  return ParamPush;

})(Ast);


},{"../messages":90,"../runtime/memory":95,"../utils":96,"./assign":49,"./ast":50,"./memory-reference":67,"./type":72}],61:[function(require,module,exports){
0;
var Assign, Ast, CloseScope, DeclarationGroup, FuncArg, Function, FunctionDefinition, IntLit, MAIN_FUNCTION, MemoryReference, OpenScope, PRIMITIVE_TYPES, Return, lastLocations, ref, utils,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

PRIMITIVE_TYPES = require('./type').PRIMITIVE_TYPES;

MAIN_FUNCTION = require('../compiler/program').Program.MAIN_FUNCTION;

utils = require('../utils');

Return = require('./return').Return;

IntLit = require('./literals').IntLit;

Assign = require('./assign').Assign;

MemoryReference = require('./memory-reference').MemoryReference;

DeclarationGroup = require('./declaration').DeclarationGroup;

ref = require('./debug-info'), FunctionDefinition = ref.FunctionDefinition, OpenScope = ref.OpenScope, CloseScope = ref.CloseScope;

module.exports = this;

lastLocations = function(locations) {
  return {
    lines: {
      first: locations.lines.last,
      last: locations.lines.last
    },
    columns: {
      first: locations.columns.last,
      last: locations.columns.last
    }
  };
};

this.Function = Function = (function(superClass) {
  extend(Function, superClass);

  function Function() {
    return Function.__super__.constructor.apply(this, arguments);
  }

  Function.prototype.name = "Function";

  Function.prototype.compile = function(state) {
    var argList, argListInstructions, declaration, functionId, functionVariable, instructionList, instructionsBody, ref1, returnInstruction, returnOassign;
    ref1 = this.children, declaration = ref1[0], argList = ref1[1], instructionList = ref1[2];
    state.beginFunctionReturnDefinition();
    declaration.compile(state);
    state.endFunctionReturnDefinition();
    state.beginFunctionArgumentDefinitions();
    argListInstructions = argList.compile(state).instructions;
    state.endFunctionArgumentDefinitions();
    instructionsBody = instructionList.compile(state).instructions;
    functionVariable = state.getFunction();
    functionId = functionVariable.id;
    if (functionId === MAIN_FUNCTION) {
      returnOassign = new Assign(MemoryReference.from(PRIMITIVE_TYPES.INT, null, MemoryReference.RETURN), new IntLit(0));
      returnOassign.locations = lastLocations(this.locations);
      instructionsBody.push(returnOassign);
    }
    returnInstruction = new Return;
    returnInstruction.locations = lastLocations(this.locations);
    instructionsBody.push(returnInstruction);
    functionVariable.instructions = instructionsBody;
    state.endFunction();
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: [new OpenScope].concat(slice.call(argListInstructions), [new FunctionDefinition(functionId)], [new CloseScope]),
      id: functionId
    };
  };

  return Function;

})(Ast);

this.FuncArg = FuncArg = (function(superClass) {
  extend(FuncArg, superClass);

  FuncArg.prototype.name = "FuncArg";

  function FuncArg(specifiers, id) {
    FuncArg.__super__.constructor.call(this, specifiers, [id]);
  }

  FuncArg.prototype.compile = function(state) {
    var type;
    type = this.getSpecifiers().type;
    if (type === PRIMITIVE_TYPES.STRING) {
      this.compilationError('STRING_ARGUMENT');
    }
    return FuncArg.__super__.compile.call(this, state);
  };

  return FuncArg;

})(DeclarationGroup);


},{"../compiler/program":80,"../utils":96,"./assign":49,"./ast":50,"./debug-info":56,"./declaration":57,"./literals":66,"./memory-reference":67,"./return":71,"./type":72}],62:[function(require,module,exports){
var AddressOf, Ast, EXPR_TYPES, Id, Pointer, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

ref = require('./type'), EXPR_TYPES = ref.EXPR_TYPES, Pointer = ref.Pointer;

AddressOf = require('./address-of').AddressOf;

module.exports = this;

this.Id = Id = (function(superClass) {
  extend(Id, superClass);

  function Id() {
    return Id.__super__.constructor.apply(this, arguments);
  }

  Id.prototype.name = "Id";

  Id.prototype.compile = function(state) {
    var id, instructions, ref1, result, variable;
    id = this.children[0];
    variable = state.getVariable(id);
    if (variable == null) {
      this.compilationError('REF_VARIABLE_NOT_DEFINED', 'name', id);
    }
    if (variable.type.isArray) {
      result = state.getTemporary(variable.type.getPointerType());
      instructions = [new AddressOf(result, variable.memoryReference)];
    } else {
      result = variable.memoryReference;
      instructions = [];
    }
    return {
      type: variable.type,
      result: result,
      instructions: instructions,
      exprType: EXPR_TYPES.LVALUE,
      lvalueId: id,
      isConst: (ref1 = variable.specifiers) != null ? ref1["const"] : void 0
    };
  };

  return Id;

})(Ast);


},{"./address-of":46,"./ast":50,"./type":72}],63:[function(require,module,exports){
var i, key, len, modules, myModule, value;

module.exports = this;

modules = [];

modules.push(require('././address-of'));

modules.push(require('./array-subscript'));

modules.push(require('./assign-op'));

modules.push(require('./assign'));

modules.push(require('./ast'));

modules.push(require('./binary-op'));

modules.push(require('./branch'));

modules.push(require('./cin'));

modules.push(require('./conditional'));

modules.push(require('./cout'));

modules.push(require('./declaration'));

modules.push(require('./dereference'));

modules.push(require('./for'));

modules.push(require('./funcall'));

modules.push(require('./function'));

modules.push(require('./id'));

modules.push(require('./index'));

modules.push(require('./initializer'));

modules.push(require('./list'));

modules.push(require('./literals'));

modules.push(require('./memory-reference'));

modules.push(require('./new-delete'));

modules.push(require('./program-ast'));

modules.push(require('./read'));

modules.push(require('./return'));

modules.push(require('./type'));

modules.push(require('./unary-op'));

modules.push(require('./while'));

modules.push(require('./write'));

for (i = 0, len = modules.length; i < len; i++) {
  myModule = modules[i];
  for (key in myModule) {
    value = myModule[key];
    this[key] = value;
  }
}


},{"././address-of":46,"./array-subscript":47,"./assign":49,"./assign-op":48,"./ast":50,"./binary-op":51,"./branch":52,"./cin":53,"./conditional":54,"./cout":55,"./declaration":57,"./dereference":58,"./for":59,"./funcall":60,"./function":61,"./id":62,"./index":63,"./initializer":64,"./list":65,"./literals":66,"./memory-reference":67,"./new-delete":68,"./program-ast":69,"./read":70,"./return":71,"./type":72,"./unary-op":73,"./while":74,"./write":75}],64:[function(require,module,exports){
module.exports = {};


/*
{ Ast } = require './ast'
{ ensureType, PRIMITIVE_TYPES, EXPR_TYPES } = require './type'

module.exports = @

@Initializer = class Initializer extends Ast

@ArrayInitializer = class ArrayInitializer extends Initializer
    compile: (state) ->
         * TODO: Implement

        values = @children

        { exprType: EXPR_TYPES.RVALUE, instructions: [] }
 */


},{}],65:[function(require,module,exports){
var Ast, CloseScope, List, OpenScope, ScopedList, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./debug-info'), OpenScope = ref.OpenScope, CloseScope = ref.CloseScope;

module.exports = this;

this.List = List = (function(superClass) {
  extend(List, superClass);

  function List() {
    return List.__super__.constructor.apply(this, arguments);
  }

  List.prototype.name = "List";

  List.prototype.compile = function() {
    var args, child, i, instructions, len, ref1, res, state;
    state = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    instructions = [];
    ref1 = this.children;
    for (i = 0, len = ref1.length; i < len; i++) {
      child = ref1[i];
      res = child.compile.apply(child, [state].concat(slice.call(args)));
      if (res.result != null) {
        state.releaseTemporaries(res.result);
      }
      instructions = instructions.concat(res.instructions);
    }
    return {
      instructions: instructions
    };
  };

  return List;

})(Ast);

this.ScopedList = ScopedList = (function(superClass) {
  extend(ScopedList, superClass);

  function ScopedList() {
    return ScopedList.__super__.constructor.apply(this, arguments);
  }

  ScopedList.prototype.name = "ScopedList";

  ScopedList.prototype.compile = function() {
    var args, result, state;
    state = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    state.openScope();
    result = ScopedList.__super__.compile.apply(this, [state].concat(slice.call(args)));
    state.closeScope();
    result.instructions = [new OpenScope()].concat(slice.call(result.instructions), [new CloseScope()]);
    return result;
  };

  return ScopedList;

})(List);


},{"./ast":50,"./debug-info":56}],66:[function(require,module,exports){
0;
var Assign, Ast, BoolLit, CharLit, DoubleLit, EXPR_TYPES, IntLit, Literal, NullPtr, PRIMITIVE_TYPES, Pointer, StringLit, T0, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, EXPR_TYPES = ref.EXPR_TYPES, Pointer = ref.Pointer;

T0 = require('./memory-reference').T0;

Assign = require('./assign').Assign;

module.exports = this;

this.Literal = Literal = (function(superClass) {
  extend(Literal, superClass);

  function Literal() {
    return Literal.__super__.constructor.apply(this, arguments);
  }

  Literal.prototype.compile = function(state) {
    0;
    0;
    var s;
    s = this.children[0];
    this.setChild(0, this.type.tipify(this.parse(s)));
    return {
      type: this.type,
      instructions: [],
      result: this,
      exprType: EXPR_TYPES.RVALUE,
      staticValue: this.child()
    };
  };

  Literal.prototype.read = function() {
    return this.child();
  };

  Literal.prototype.getType = function() {
    return this.type;
  };

  return Literal;

})(Ast);

this.DoubleLit = DoubleLit = (function(superClass) {
  extend(DoubleLit, superClass);

  function DoubleLit() {
    return DoubleLit.__super__.constructor.apply(this, arguments);
  }

  DoubleLit.prototype.name = "DoubleLit";

  DoubleLit.prototype.parse = parseFloat;

  DoubleLit.prototype.type = PRIMITIVE_TYPES.DOUBLE;

  return DoubleLit;

})(Literal);

this.IntLit = IntLit = (function(superClass) {
  extend(IntLit, superClass);

  function IntLit() {
    return IntLit.__super__.constructor.apply(this, arguments);
  }

  IntLit.prototype.name = "IntLit";

  IntLit.prototype.parse = parseInt;

  IntLit.prototype.type = PRIMITIVE_TYPES.INT;

  return IntLit;

})(Literal);

this.StringLit = StringLit = (function(superClass) {
  extend(StringLit, superClass);

  function StringLit() {
    return StringLit.__super__.constructor.apply(this, arguments);
  }

  StringLit.prototype.name = "StringLit";

  StringLit.prototype.parse = function(s) {
    return JSON.parse("{ \"s\": " + s + " }").s;
  };

  StringLit.prototype.type = PRIMITIVE_TYPES.STRING;

  return StringLit;

})(Literal);

this.CharLit = CharLit = (function(superClass) {
  extend(CharLit, superClass);

  function CharLit() {
    return CharLit.__super__.constructor.apply(this, arguments);
  }

  CharLit.prototype.name = "CharLit";

  CharLit.prototype.parse = function(s) {
    s = s.slice(1, -1);
    if (s === "\\'") {
      s = "'";
    } else if (s === "\"") {
      s = "\\\"";
    }
    return JSON.parse("{ \"s\": \"" + s + "\" }").s.charCodeAt(0);
  };

  CharLit.prototype.type = PRIMITIVE_TYPES.CHAR;

  return CharLit;

})(Literal);

this.BoolLit = BoolLit = (function(superClass) {
  extend(BoolLit, superClass);

  function BoolLit() {
    return BoolLit.__super__.constructor.apply(this, arguments);
  }

  BoolLit.prototype.name = "BoolLit";

  BoolLit.prototype.parse = function(s) {
    return s === "true";
  };

  BoolLit.prototype.type = PRIMITIVE_TYPES.BOOL;

  return BoolLit;

})(Literal);

this.NullPtr = NullPtr = (function(superClass) {
  extend(NullPtr, superClass);

  function NullPtr() {
    return NullPtr.__super__.constructor.apply(this, arguments);
  }

  NullPtr.prototype.name = "NullPtr";

  NullPtr.prototype.parse = function() {
    return 0;
  };

  NullPtr.prototype.type = PRIMITIVE_TYPES.NULLPTR;

  return NullPtr;

})(Literal);


},{"./assign":49,"./ast":50,"./memory-reference":67,"./type":72}],67:[function(require,module,exports){
0;
var Allocator, Ast, HEAP_INITIAL_ADDRESS, HeapReference, Leal, MALLOC_HEADER_SIZE, MemoryReference, PRIMITIVE_TYPES, PointerMemoryReference, ReturnReference, StackReference, StringReference, TmpReference,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Allocator = require('malloc');

Ast = require('./ast').Ast;

PRIMITIVE_TYPES = require('./type').PRIMITIVE_TYPES;

module.exports = this;

this.MALLOC_HEADER_SIZE = MALLOC_HEADER_SIZE = new Allocator(new ArrayBuffer(1024)).alloc(4);

HEAP_INITIAL_ADDRESS = 0x80000000 + MALLOC_HEADER_SIZE;

this.MemoryReference = MemoryReference = (function(superClass) {
  extend(MemoryReference, superClass);

  MemoryReference.prototype.name = "MemoryReference";

  MemoryReference.HEAP = 0;

  MemoryReference.STACK = 1;

  MemoryReference.TMP = 2;

  MemoryReference.RETURN = 3;

  function MemoryReference(type, address) {
    this.get = 'get' + type.stdTypeName;
    this.set = 'set' + type.stdTypeName;
    this.address = address;
    MemoryReference.__super__.constructor.call(this, type, address);
  }

  MemoryReference.from = function(type, value, store, occupation) {
    if (type === PRIMITIVE_TYPES.STRING) {
      return new StringReference(value);
    } else {
      switch (store) {
        case this.HEAP:
          return new HeapReference(type, value);
        case this.STACK:
          return new StackReference(type, value);
        case this.TMP:
          return new TmpReference(type, value, occupation);
        case this.RETURN:
          return new ReturnReference(type);
        default:
          return 0;
      }
    }
  };

  MemoryReference.prototype.getType = function() {
    return this.children[0];
  };

  MemoryReference.prototype.getAddress = function() {
    return this.children[1];
  };

  MemoryReference.prototype.read = function(memory) {
    return memory[this.address >>> 31][this.get](this.address & 0x7FFFFFFF);
  };

  MemoryReference.prototype.write = function(memory, value) {
    return memory[this.address >>> 31][this.set](this.address & 0x7FFFFFFF, value);
  };

  return MemoryReference;

})(Ast);

this.PointerMemoryReference = PointerMemoryReference = (function(superClass) {
  extend(PointerMemoryReference, superClass);

  PointerMemoryReference.prototype.name = "PointerMemoryReference";

  function PointerMemoryReference(type, baseAddressRef, indexAddressRef) {
    this.baseAddressRef = baseAddressRef;
    this.indexAddressRef = indexAddressRef;
    this.get = 'get' + type.stdTypeName;
    this.set = 'set' + type.stdTypeName;
    this.elementBytes = type.bytes;
    PointerMemoryReference.__super__.constructor.call(this, type, this.baseAddressRef, this.indexAddressRef);
  }

  PointerMemoryReference.prototype.getType = function() {
    return this.children[0];
  };

  PointerMemoryReference.prototype.getAddress = function(memory) {
    return this.baseAddressRef.read(memory) + this.indexAddressRef.read(memory) * this.elementBytes;
  };

  PointerMemoryReference.prototype.read = function(memory) {
    var address;
    address = this.baseAddressRef.read(memory) + this.indexAddressRef.read(memory) * this.elementBytes;
    return memory[address >>> 31][this.get](address & 0x7FFFFFFF);
  };

  PointerMemoryReference.prototype.write = function(memory, value) {
    var address;
    address = this.baseAddressRef.read(memory) + this.indexAddressRef.read(memory) * this.elementBytes;
    return memory[address >>> 31][this.set](address & 0x7FFFFFFF, value);
  };

  PointerMemoryReference.prototype.containsTemporaries = function() {
    return this.baseAddressRef.isTemporary || this.indexAddressRef.isTemporary;
  };

  PointerMemoryReference.prototype.getTemporaries = function() {
    return [this.baseAddressRef, this.indexAddressRef];
  };

  return PointerMemoryReference;

})(Ast);

this.ReturnReference = ReturnReference = (function(superClass) {
  extend(ReturnReference, superClass);

  ReturnReference.prototype.name = "ReturnReference";

  function ReturnReference(type) {
    ReturnReference.__super__.constructor.call(this, type, 0);
  }

  ReturnReference.prototype.read = function(memory) {
    return memory["return"][this.get](0);
  };

  ReturnReference.prototype.write = function(memory, value) {
    return memory["return"][this.set](0, value);
  };

  return ReturnReference;

})(MemoryReference);

this.StackReference = StackReference = (function(superClass) {
  extend(StackReference, superClass);

  function StackReference() {
    return StackReference.__super__.constructor.apply(this, arguments);
  }

  StackReference.prototype.name = "StackReference";

  StackReference.prototype.read = function(memory) {
    return memory.stack[this.get](this.address + memory.pointers.stack);
  };

  StackReference.prototype.write = function(memory, value) {
    return memory.stack[this.set](this.address + memory.pointers.stack, value);
  };

  StackReference.prototype.getAddress = function(memory) {
    return this.address + memory.pointers.stack;
  };

  return StackReference;

})(MemoryReference);

this.HeapReference = HeapReference = (function(superClass) {
  extend(HeapReference, superClass);

  HeapReference.prototype.name = "HeapReference";

  function HeapReference(type, address) {
    HeapReference.__super__.constructor.call(this, type, address + HEAP_INITIAL_ADDRESS);
  }

  return HeapReference;

})(MemoryReference);

this.TmpReference = TmpReference = (function(superClass) {
  extend(TmpReference, superClass);

  TmpReference.prototype.name = "TmpReference";

  function TmpReference(type, address, occupation1) {
    this.occupation = occupation1;
    TmpReference.__super__.constructor.call(this, type, address);
  }

  TmpReference.prototype.isTemporary = true;

  TmpReference.prototype.read = function(memory) {
    return memory.tmp[this.get](this.address + memory.pointers.temporaries);
  };

  TmpReference.prototype.write = function(memory, value) {
    return memory.tmp[this.set](this.address + memory.pointers.temporaries, value);
  };

  TmpReference.prototype.getOccupation = function() {
    return this.occupation;
  };

  return TmpReference;

})(MemoryReference);

this.StringReference = StringReference = (function(superClass) {
  extend(StringReference, superClass);

  StringReference.prototype.name = "StringReference";

  function StringReference(string) {
    StringReference.__super__.constructor.call(this, string);
  }

  StringReference.prototype.read = function() {
    return this.child();
  };

  StringReference.prototype.write = function(_, value) {
    return this.setChild(0, value);
  };

  StringReference.prototype.getType = function() {
    return PRIMITIVE_TYPES.STRING;
  };

  return StringReference;

})(Ast);

this.Leal = Leal = (function(superClass) {
  extend(Leal, superClass);

  function Leal() {
    return Leal.__super__.constructor.apply(this, arguments);
  }

  Leal.prototype.name = "Leal";

  Leal.prototype.execute = function(arg) {
    var baseReference, destReference, elementSize, indexReference, memory, ref;
    memory = arg.memory;
    ref = this.children, destReference = ref[0], baseReference = ref[1], indexReference = ref[2], elementSize = ref[3];
    return destReference.write(memory, baseReference.read(memory) + indexReference.read(memory) * elementSize);
  };

  return Leal;

})(Ast);


},{"./ast":50,"./type":72,"malloc":30}],68:[function(require,module,exports){
var Array, Ast, Delete, New, NewArrayDeclaration, NewDeclaration, NewPointerDeclaration, PRIMITIVE_TYPES, Pointer, executionError, getSpecifiers, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, Pointer = ref.Pointer, Array = ref.Array;

Ast = require('./ast').Ast;

getSpecifiers = require('./declaration').getSpecifiers;

executionError = require('../messages').executionError;

module.exports = this;

this.Delete = Delete = (function(superClass) {
  extend(Delete, superClass);

  function Delete() {
    return Delete.__super__.constructor.apply(this, arguments);
  }

  Delete.prototype.name = "Delete";

  Delete.prototype.compile = function(state) {
    var instructions, isArray, maybeArr, pointerAst, ref1, ref2, result, type;
    ref1 = this.children, maybeArr = ref1[0], pointerAst = ref1[1];
    if (maybeArr === "[") {
      isArray = true;
    } else {
      isArray = false;
      pointerAst = maybeArr;
    }
    ref2 = pointerAst.compile(state), instructions = ref2.instructions, result = ref2.result, type = ref2.type;
    state.releaseTemporaries(result);
    if (!(type.isPointer || type.isArray)) {
      this.compilationError('INVALID_DELETE_TYPE', "type", type.getSymbol());
    }
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: slice.call(instructions).concat([new Delete(result)])
    };
  };

  Delete.prototype.execute = function(vm) {
    var pointerReference, value;
    pointerReference = this.children[0];
    value = pointerReference.read(vm.memory);
    if (value !== 0) {
      return vm.free(value);
    }
  };

  return Delete;

})(Ast);

this.New = New = (function(superClass) {
  extend(New, superClass);

  function New() {
    return New.__super__.constructor.apply(this, arguments);
  }

  New.prototype.name = "New";

  New.prototype.compile = function(state) {
    var declarationAst, declarationInstructions, dimensionResult, maybeStaticDimension, ref1, ref2, ref3, result, specifiers, specifiersList, type;
    ref1 = this.children, specifiersList = ref1[0], declarationAst = ref1[1];
    ref2 = getSpecifiers(specifiersList), type = ref2.type, specifiers = ref2.specifiers;
    if (type === PRIMITIVE_TYPES.STRING) {
      this.compilationError('STRING_ADDRESSING');
    }
    if (type === PRIMITIVE_TYPES.VOID) {
      this.compilationError('VOID_INVALID_USE');
    }
    ref3 = declarationAst.compile(state, {
      specifiers: specifiers,
      type: type
    }), declarationInstructions = ref3.instructions, type = ref3.type, dimensionResult = ref3.dimensionResult;
    type = type.isArray ? (maybeStaticDimension = type.size, new Pointer(type.getElementType(), {
      specifiers: {}
    })) : new Pointer(type, {
      specifiers: {}
    });
    result = state.getTemporary(type);
    return {
      instructions: slice.call(declarationInstructions).concat([new New(result, maybeStaticDimension != null ? maybeStaticDimension : null, dimensionResult != null ? dimensionResult : null)]),
      type: type,
      result: result
    };
  };

  New.prototype.execute = function(vm) {
    var address, dimension, elements, memory, ref1, reserve, resultReference, type;
    memory = vm.memory;
    ref1 = this.children, resultReference = ref1[0], dimension = ref1[1];
    type = resultReference.getType().getElementType();
    reserve = type.bytes;
    if (dimension != null) {
      elements = isNaN(dimension) ? dimension.read(memory) : dimension;
      if (elements < 0) {
        executionError(vm, 'INVALID_NEW_ARRAY_LENGTH');
        return;
      }
      reserve *= elements;
    }
    address = vm.alloc(reserve);
    return resultReference.write(memory, address);
  };

  return New;

})(Ast);

this.NewArrayDeclaration = NewArrayDeclaration = (function(superClass) {
  extend(NewArrayDeclaration, superClass);

  function NewArrayDeclaration() {
    return NewArrayDeclaration.__super__.constructor.apply(this, arguments);
  }

  NewArrayDeclaration.prototype.name = "NewArrayDeclaration";

  NewArrayDeclaration.prototype.compile = function(state, arg) {
    var dimension, dimensionAst, dimensionInstructions, dimensionResult, dimensionType, innerDeclarationAst, innerInstructions, parentAstDimension, ref1, ref2, ref3, secondDimensionResult, specifiers, type;
    type = arg.type, specifiers = arg.specifiers, parentAstDimension = arg.parentAstDimension;
    ref1 = this.children, innerDeclarationAst = ref1[0], dimensionAst = ref1[1];
    ref2 = dimensionAst.compile(state), dimension = ref2.staticValue, dimensionType = ref2.type, dimensionResult = ref2.result, dimensionInstructions = ref2.instructions;
    if (!dimensionType.isIntegral) {
      dimensionAst.compilationError('NONINTEGRAL_DIMENSION', 'id', null, 'type', dimensionType.getSymbol());
    }
    if (type.isArray && (type.size == null)) {
      parentAstDimension.compilationError('NEW_ARRAY_SIZE_CONSTANT');
    }
    if (dimension != null) {
      if (dimension < 0) {
        dimensionAst.compilationError('ARRAY_SIZE_NEGATIVE');
      }
    } else {
      state.releaseTemporaries(dimensionResult);
    }
    type = new Array(dimension, type, {
      isValueConst: specifiers != null ? specifiers["const"] : void 0
    });
    ref3 = innerDeclarationAst.compile(state, {
      type: type,
      specifiers: {
        "const": type.isValueConst
      },
      parentAstDimension: dimensionAst
    }), innerInstructions = ref3.instructions, secondDimensionResult = ref3.dimensionResult, type = ref3.type;
    return {
      type: type,
      instructions: slice.call(dimensionInstructions).concat(slice.call(innerInstructions)),
      dimensionResult: dimension != null ? secondDimensionResult : dimensionResult
    };
  };

  return NewArrayDeclaration;

})(Ast);

this.NewPointerDeclaration = NewPointerDeclaration = (function(superClass) {
  extend(NewPointerDeclaration, superClass);

  function NewPointerDeclaration() {
    return NewPointerDeclaration.__super__.constructor.apply(this, arguments);
  }

  NewPointerDeclaration.prototype.name = "NewPointerDeclaration";

  NewPointerDeclaration.prototype.compile = function(state, arg) {
    var innerDeclarationAst, specifiers, type;
    specifiers = arg.specifiers, type = arg.type;
    innerDeclarationAst = this.children[0];
    type = new Pointer(type, {
      isValueConst: specifiers != null ? specifiers["const"] : void 0
    });
    return innerDeclarationAst.compile(state, {
      type: type
    });
  };

  return NewPointerDeclaration;

})(Ast);

this.NewDeclaration = NewDeclaration = (function(superClass) {
  extend(NewDeclaration, superClass);

  function NewDeclaration() {
    return NewDeclaration.__super__.constructor.apply(this, arguments);
  }

  NewDeclaration.prototype.name = "NewDeclaration";

  NewDeclaration.prototype.compile = function(state, arg) {
    var specifiers, type;
    specifiers = arg.specifiers, type = arg.type;
    if (specifiers != null ? specifiers["const"] : void 0) {
      this.compilationError('UNINITIALIZED_CONST_NEW');
    }
    return {
      instructions: [],
      type: type
    };
  };

  return NewDeclaration;

})(Ast);


},{"../messages":90,"./ast":50,"./declaration":57,"./type":72}],69:[function(require,module,exports){
0;
var Ast, CompilationState, ENTRY_FUNCTION, Funcall, FunctionType, FunctionVar, Memory, PRIMITIVE_TYPES, Program, ProgramAst, compilationError, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; },
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, FunctionType = ref.FunctionType;

CompilationState = require('../compiler/semantics/compilation-state').CompilationState;

FunctionVar = require('../compiler/semantics/function-var').FunctionVar;

Funcall = require('./funcall').Funcall;

Program = require('../compiler/program').Program;

Memory = require('../runtime/memory').Memory;

compilationError = require('../messages').compilationError;

module.exports = this;

ENTRY_FUNCTION = Program.ENTRY_FUNCTION;

this.ProgramAst = ProgramAst = (function(superClass) {
  var ALLOWED_MAIN_RETURN_TYPES, checkMainIsDefined;

  extend(ProgramAst, superClass);

  function ProgramAst() {
    return ProgramAst.__super__.constructor.apply(this, arguments);
  }

  ProgramAst.prototype.name = "ProgramAst";

  ALLOWED_MAIN_RETURN_TYPES = [PRIMITIVE_TYPES.INT];

  checkMainIsDefined = function(functions) {
    var main, ref1;
    main = functions.main;
    if (!((main != null) && main.type.isFunction)) {
      return compilationError('MAIN_NOT_DEFINED');
    } else if (ref1 = main.type.returnType, indexOf.call(ALLOWED_MAIN_RETURN_TYPES, ref1) < 0) {
      return compilationError('INVALID_MAIN_TYPE');
    }
  };

  ProgramAst.prototype.compile = function() {
    var entryFunction, functions, globalsSize, instructions, state, topDeclarationList, variables;
    topDeclarationList = this.children[0];
    state = new CompilationState;
    instructions = topDeclarationList.compile(state).instructions;
    functions = state.functions, variables = state.variables, globalsSize = state.addressOffset;
    if (globalsSize > Memory.SIZES.heap) {
      compilationError('MAX_HEAP_SIZE_EXCEEDED', null, 'size', globalsSize, 'limit', Memory.SIZES.heap);
    }
    checkMainIsDefined(functions);
    entryFunction = new FunctionVar(ENTRY_FUNCTION, new FunctionType(PRIMITIVE_TYPES.VOID));
    entryFunction.instructions = slice.call(instructions).concat([new Funcall('main', 0)]);
    state.newFunction(entryFunction);
    state.endFunction();
    return new Program(variables, functions, globalsSize);
  };

  return ProgramAst;

})(Ast);


},{"../compiler/program":80,"../compiler/semantics/compilation-state":81,"../compiler/semantics/function-var":82,"../messages":90,"../runtime/memory":95,"./ast":50,"./funcall":60,"./type":72}],70:[function(require,module,exports){
var Ast, IO, Read, parseInput,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

IO = require('../runtime/io').IO;

parseInput = require('../runtime/input-parser').parseInput;

module.exports = this;

this.Read = Read = (function(superClass) {
  extend(Read, superClass);

  function Read() {
    return Read.__super__.constructor.apply(this, arguments);
  }

  Read.prototype.name = "Read";

  Read.prototype.execute = function(arg) {
    var booleanReference, idReference, io, leftover, memory, read, ref, ref1, value, word;
    memory = arg.memory, io = arg.io;
    ref = this.children, booleanReference = ref[0], idReference = ref[1];
    word = io.getWord(IO.STDIN);
    read = false;
    if (word != null) {
      ref1 = parseInput(word, idReference.getType()), leftover = ref1.leftover, value = ref1.value;
      if (value != null) {
        if (leftover.length > 0) {
          io.unshiftWord(IO.STDIN, leftover);
        }
        idReference.write(memory, value);
        read = true;
      }
    }
    return booleanReference.write(memory, read ? 1 : 0);
  };

  Read.prototype.isRead = true;

  return Read;

})(Ast);


},{"../runtime/input-parser":93,"../runtime/io":94,"./ast":50}],71:[function(require,module,exports){
0;
var Assign, Ast, MAIN_FUNCTION, MemoryReference, PRIMITIVE_TYPES, Return, ensureType, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType;

Assign = require('./assign').Assign;

MemoryReference = require('./memory-reference').MemoryReference;

MAIN_FUNCTION = require('../compiler/program').Program.MAIN_FUNCTION;

module.exports = this;

this.Return = Return = (function(superClass) {
  extend(Return, superClass);

  function Return() {
    return Return.__super__.constructor.apply(this, arguments);
  }

  Return.prototype.name = "Return";

  Return.prototype.compile = function(state) {
    var actualType, castingInstructions, expectedType, func, instructions, ref1, ref2, result, value, valueInstructions, valueResult;
    value = this.children[0];
    func = state.getFunction();
    0;
    expectedType = func.type.returnType;
    if (value != null) {
      ref1 = value.compile(state), actualType = ref1.type, valueInstructions = ref1.instructions, valueResult = ref1.result;
      ref2 = ensureType(valueResult, actualType, expectedType, state, this), result = ref2.result, castingInstructions = ref2.instructions;
      state.releaseTemporaries(result);
      instructions = slice.call(valueInstructions).concat(slice.call(castingInstructions), [new Assign(MemoryReference.from(expectedType, null, MemoryReference.RETURN), result)]);
    } else {
      actualType = PRIMITIVE_TYPES.VOID;
      if (actualType !== expectedType) {
        this.compilationError('NO_RETURN', "expected", expectedType.getSymbol(), "name", functionId);
      }
      instructions = [];
    }
    instructions.push(new Return);
    instructions.forEach((function(_this) {
      return function(x) {
        return x.locations = _this.locations;
      };
    })(this));
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: instructions
    };
  };

  Return.prototype.execute = function(vm) {
    var func, instruction, ref1, temporariesOffset;
    ref1 = vm.controlStack.pop(), func = ref1.func, instruction = ref1.instruction, temporariesOffset = ref1.temporariesOffset;
    vm.pointers.temporaries = temporariesOffset;
    vm.pointers.instruction = instruction;
    vm.finished || (vm.finished = vm.func.id === MAIN_FUNCTION && vm.controlStack.length === 0);
    vm.func = func;
    vm.pointers.stack -= vm.func.stackSize;
    return vm.instructions = vm.func.instructions;
  };

  Return.prototype.isReturn = true;

  return Return;

})(Ast);


},{"../compiler/program":80,"./assign":49,"./ast":50,"./memory-reference":67,"./type":72}],72:[function(require,module,exports){
(function (global){
0;
var ASCII_MAP, Array, Ast, Casting, FunctionType, NullPtr, PRIMITIVE_TYPES, Pointer, Type, castingId, char, digits, fn, fn1, identity, isConstConversionValid, isVoidPointer, k, ref, roundCout, type, typeId, utils,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

utils = require('../utils');

ASCII_MAP = ((function() {
  var i, results;
  results = [];
  for (char = i = 0; i < 128; char = ++i) {
    results.push(String.fromCharCode(char));
  }
  return results;
})()).join("") + "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

digits = function(x) {
  var c;
  x = Math.floor(x);
  c = 0;
  while (x > 0) {
    ++c;
    x = Math.floor(x / 10);
  }
  return c;
};

roundCout = function(x) {
  var d, decimalPlacesRounder;
  d = digits(x);
  decimalPlacesRounder = Math.pow(10, 6 - d);
  return x = Math.round(x * decimalPlacesRounder) / decimalPlacesRounder;
};

identity = function(x) {
  return x;
};

Type = (function(superClass) {
  extend(Type, superClass);

  Type.prototype.name = "Type";

  function Type(id, arg) {
    var ref, ref1, ref2, ref3, ref4, ref5, typedArray;
    this.id = id;
    ref = arg != null ? arg : {}, this.castings = (ref1 = ref.castings) != null ? ref1 : {}, this.bytes = ref.bytes, this.stdTypeName = ref.stdTypeName, this.isIntegral = (ref2 = ref.isIntegral) != null ? ref2 : false, this.isNumeric = (ref3 = ref.isNumeric) != null ? ref3 : false, this.isAssignable = (ref4 = ref.isAssignable) != null ? ref4 : true, this.isReferenceable = (ref5 = ref.isReferenceable) != null ? ref5 : this.isAssignable, this.parse = ref.parse;
    Type.__super__.constructor.call(this);
    if (this.stdTypeName != null) {
      typedArray = new global[this.stdTypeName + 'Array'](1);
      this.tipify = function(x) {
        typedArray[0] = x;
        return typedArray[0];
      };
    } else {
      this.tipify = function(x) {
        return x;
      };
    }
  }

  Type.prototype.getSymbol = function() {
    return this.id.toLowerCase();
  };

  Type.prototype.canCastTo = function(otherType, arg) {
    var ref, strict;
    strict = (ref = (arg != null ? arg : {}).strict) != null ? ref : false;
    return (strict && otherType.id === this.id) || (!strict && (this.castings[otherType.id] != null));
  };

  Type.prototype.instructionsForCast = function(otherType, result, memoryReference) {
    return [this.castingGenerator[otherType.id](result, memoryReference)];
  };

  Type.prototype.requiredAlignment = function() {
    if (this.bytes === 0) {
      return 1;
    } else {
      return this.bytes;
    }
  };

  Type.prototype.equalsNoConst = function(other) {
    return this.id === other.id;
  };

  return Type;

})(Ast);

isVoidPointer = function(type) {
  return type.isPointer && type.getElementType() === PRIMITIVE_TYPES.VOID;
};

isConstConversionValid = function(origin, other) {
  return !origin.isValueConst || other.isValueConst;
};

this.Pointer = Pointer = (function(superClass) {
  extend(Pointer, superClass);

  Pointer.prototype.name = "Pointer";

  Pointer.bytes = 4;

  function Pointer(elementType1, arg) {
    var ref, ref1, ref2;
    this.elementType = elementType1;
    ref = arg != null ? arg : {}, this.isValueConst = (ref1 = ref.isValueConst) != null ? ref1 : false, this.isIncomplete = (ref2 = ref.isIncomplete) != null ? ref2 : false;
    Pointer.__super__.constructor.call(this, 'POINTER', {
      stdTypeName: 'Uint32',
      castings: {
        COUT: function(x) {
          return "0x" + utils.pad(x.toString(16), '0', 8);
        }
      },
      parse: function(s) {
        if (isNaN(s) || s < 0) {
          throw "Invalid value " + s;
        } else {
          return parseInt(s);
        }
      }
    });
    this.bytes = Pointer.bytes;
  }

  Pointer.prototype.isPointer = true;

  Pointer.prototype.getSymbol = function() {
    if (this.isValueConst) {
      if (this.elementType.isPointer) {
        return (this.elementType.getSymbol()) + " const*";
      } else {
        return "const " + (this.elementType.getSymbol()) + "*";
      }
    } else if (this.elementType.isArray) {
      return "(*)(" + (this.elementType.getSymbol()) + ")";
    } else {
      return (this.elementType.getSymbol()) + "*";
    }
  };

  Pointer.prototype.getElementType = function() {
    return this.elementType;
  };

  Pointer.prototype.canCastTo = function(otherType, arg) {
    var allConst, ref, ref1, ref2, strict;
    ref = arg != null ? arg : {}, strict = (ref1 = ref.strict) != null ? ref1 : false, allConst = (ref2 = ref.allConst) != null ? ref2 : true;
    if (!strict && ((otherType === PRIMITIVE_TYPES.BOOL || otherType === PRIMITIVE_TYPES.COUT) || (isVoidPointer(otherType) && isConstConversionValid(this, otherType)))) {
      return true;
    } else if (otherType.isPointer) {
      if (this.isValueConst && !otherType.isValueConst) {
        return false;
      } else if (otherType.isValueConst !== this.isValueConst) {
        return allConst && this.getElementType().canCastTo(otherType.getElementType(), {
          strict: true,
          allConst: allConst && otherType.isValueConst
        });
      } else {
        return this.getElementType().canCastTo(otherType.getElementType(), {
          strict: true,
          allConst: allConst && otherType.isValueConst
        });
      }
    } else {
      return false;
    }
  };

  Pointer.prototype.instructionsForCast = function(otherType, result, memoryReference) {
    if (result !== memoryReference) {
      return [new Casting(identity, result, memoryReference)];
    } else {
      return [];
    }
  };

  Pointer.prototype.equalsNoConst = function(other) {
    return other.isPointer && this.getElementType().equalsNoConst(other.getElementType());
  };

  return Pointer;

})(Type);

NullPtr = (function(superClass) {
  extend(NullPtr, superClass);

  NullPtr.prototype.name = "NullPtr";

  function NullPtr() {
    NullPtr.__super__.constructor.call(this, 'NULLPTR', {
      isAssignable: false
    });
  }

  NullPtr.prototype.getSymbol = function() {
    return "std::nullptr_t";
  };

  NullPtr.prototype.canCastTo = function(otherType) {
    return otherType.isPointer;
  };

  NullPtr.prototype.instructionsForCast = function(otherType, result, memoryReference) {
    if (result !== memoryReference) {
      return [new Casting(identity, result, memoryReference)];
    } else {
      return [];
    }
  };

  NullPtr.prototype.isNullPtr = true;

  return NullPtr;

})(Type);

this.Array = Array = (function(superClass) {
  extend(Array, superClass);

  Array.prototype.name = "Array";

  function Array(size1, elementType1, arg) {
    var ref;
    this.size = size1;
    this.elementType = elementType1;
    this.isValueConst = (ref = (arg != null ? arg : {}).isValueConst) != null ? ref : false;
    Array.__super__.constructor.call(this, 'ARRAY', {
      stdTypeName: 'Uint32',
      isAssignable: false,
      isReferenceable: true,
      castings: {
        COUT: function(x) {
          return "0x" + utils.pad(x.toString(16), '0', 8);
        }
      }
    });
    if (this.size == null) {
      this.isIncomplete = true;
    } else {
      this.bytes = this.elementType.bytes * this.size;
    }
  }

  Array.prototype.getSymbol = function(sizesCarry) {
    var main, size;
    if (sizesCarry == null) {
      sizesCarry = [];
    }
    main = this.elementType.isArray ? this.elementType.getSymbol(sizesCarry.concat([this.size])) : (this.elementType.getSymbol()) + " " + (((function() {
      var i, len, ref, results;
      ref = sizesCarry.concat(this.size);
      results = [];
      for (i = 0, len = ref.length; i < len; i++) {
        size = ref[i];
        results.push('[' + (size != null ? size : '') + ']');
      }
      return results;
    }).call(this)).join(""));
    return (this.isValueConst ? "const " : "") + main;
  };

  Array.prototype.canCastTo = function(otherType, arg) {
    var ref, strict;
    strict = (ref = (arg != null ? arg : {}).strict) != null ? ref : false;
    if (!strict && ((otherType === PRIMITIVE_TYPES.BOOL || otherType === PRIMITIVE_TYPES.COUT) || (isVoidPointer(otherType) && isConstConversionValid(this, otherType)))) {
      return true;
    } else if (otherType.isArray) {
      return (!strict || this.size === otherType.size) && this.getElementType().canCastTo(otherType.getElementType(), {
        strict: true
      });
    } else if (otherType.isPointer) {
      if (this.isValueConst && !otherType.isValueConst) {
        return false;
      } else {
        return !strict && this.getElementType().canCastTo(otherType.getElementType(), {
          strict: true
        });
      }
    } else {
      return false;
    }
  };

  Array.prototype.instructionsForCast = function(otherType, result, memoryReference) {
    return [];
  };

  Array.prototype.getElementType = function() {
    return this.elementType;
  };

  Array.prototype.getBaseElementType = function() {
    var elementType;
    elementType = this.getElementType();
    while (elementType.isArray) {
      elementType = elementType.getElementType();
    }
    return elementType;
  };

  Array.prototype.requiredAlignment = function() {
    return this.getBaseElementType().requiredAlignment();
  };

  Array.prototype.getPointerType = function() {
    return new Pointer(this.getElementType(), {
      isValueConst: this.isValueConst
    });
  };

  Array.prototype.equalsNoConst = function(other) {
    return other.isArray && other.size === this.size && this.getElementType().equalsNoConst(other.getElementType());
  };

  Array.prototype.isArray = true;

  return Array;

})(Type);

this.FunctionType = FunctionType = (function(superClass) {
  extend(FunctionType, superClass);

  FunctionType.prototype.name = "FunctionType";

  function FunctionType(returnType, argTypes) {
    this.returnType = returnType;
    this.argTypes = argTypes != null ? argTypes : [];
  }

  FunctionType.prototype.canCastTo = function() {
    return false;
  };

  FunctionType.prototype.getSymbol = function() {
    var argType;
    return this.returnType + "(" + (((function() {
      var i, len, ref, results;
      ref = this.argTypes;
      results = [];
      for (i = 0, len = ref.length; i < len; i++) {
        argType = ref[i];
        results.push(argType);
      }
      return results;
    }).call(this)).join(', ')) + ")";
  };

  FunctionType.prototype.equalsNoConst = function(other) {
    return false;
  };

  FunctionType.prototype.isFunction = true;

  return FunctionType;

})(Type);

this.EXPR_TYPES = {
  RVALUE: 'RVALUE',
  LVALUE: 'LVALUE'
};

this.PRIMITIVE_TYPES = PRIMITIVE_TYPES = {
  VOID: new Type('VOID', {
    isAssignable: false,
    bytes: 1
  }),
  INT: new Type('INT', {
    bytes: 4,
    isIntegral: true,
    isNumeric: true,
    castings: {
      DOUBLE: identity,
      CHAR: identity,
      BOOL: function(x) {
        return x !== 0;
      },
      COUT: function(x) {
        return x.toString();
      }
    },
    stdTypeName: 'Int32',
    parse: function(s) {
      if (isNaN(s)) {
        throw "Invalid value " + s;
      } else {
        return parseInt(s);
      }
    }
  }),
  DOUBLE: new Type('DOUBLE', {
    bytes: 8,
    isNumeric: true,
    castings: {
      INT: identity,
      CHAR: identity,
      BOOL: function(x) {
        return x !== 0;
      },
      COUT: function(x) {
        var abs, d, o, ref;
        if (isNaN(x)) {
          return "-nan";
        } else if (x === Number.POSITIVE_INFINITY) {
          return "inf";
        } else if (x === Number.NEGATIVE_INFINITY) {
          return "-inf";
        } else {
          abs = Math.abs(x);
          if (abs >= 1000000 || (abs <= 0.000001 && abs !== 0)) {
            ref = x.toExponential().split('e'), d = ref[0], o = ref[1];
            x = roundCout(d) + 'e' + o;
          } else {
            x = roundCout(x);
          }
          return x.toString();
        }
      }
    },
    stdTypeName: 'Float64',
    parse: function(s) {
      if (isNaN(s)) {
        throw "Invalid value " + s;
      } else {
        return parseFloat(s);
      }
    }
  }),
  STRING: new Type('STRING', {
    bytes: 0,
    castings: {
      COUT: identity
    },
    parse: identity
  }),
  CHAR: new Type('CHAR', {
    bytes: 1,
    isIntegral: true,
    isNumeric: true,
    castings: {
      INT: identity,
      DOUBLE: identity,
      BOOL: function(x) {
        return x !== 0;
      },
      COUT: function(x) {
        return ASCII_MAP[x & 0x000000FF];
      }
    },
    stdTypeName: 'Int8',
    parse: function(s) {
      if (s.length !== 1) {
        throw "Invalid length";
      }
      return s.charCodeAt(0);
    }
  }),
  BOOL: new Type('BOOL', {
    bytes: 1,
    isIntegral: true,
    castings: {
      INT: identity,
      DOUBLE: identity,
      CHAR: identity,
      COUT: function(x) {
        if (x) {
          return "1";
        } else {
          return "0";
        }
      }
    },
    stdTypeName: 'Uint8',
    parse: function(s) {
      if (isNaN(s)) {
        throw "Invalid value " + s;
      } else {
        return parseInt(s) !== 0;
      }
    }
  }),
  FUNCTION: new Type('FUNCTION', {
    isAssignable: false
  }),
  CIN: new Type('CIN', {
    isAssignable: false,
    castings: {
      BOOL: function(x) {
        return x;
      }
    }
  }),
  COUT: new Type('COUT', {
    isAssignable: false
  }),
  NULLPTR: new NullPtr
};

this.PRIMITIVE_TYPES.LARGEST_ASSIGNABLE = utils.max((function() {
  var ref, results;
  ref = this.PRIMITIVE_TYPES;
  results = [];
  for (k in ref) {
    type = ref[k];
    if (type.isAssignable) {
      results.push(type);
    }
  }
  return results;
}).call(this), 'bytes').arg;

Object.freeze(this.PRIMITIVE_TYPES);

Casting = (function(superClass) {
  extend(Casting, superClass);

  Casting.prototype.name = "Casting";

  function Casting() {
    var cast, children;
    cast = arguments[0], children = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    this.cast = cast;
    Casting.__super__.constructor.apply(this, children);
  }

  Casting.prototype.execute = function(arg) {
    var dest, memory, ref, src;
    memory = arg.memory;
    ref = this.children, dest = ref[0], src = ref[1];
    return dest.write(memory, this.cast(src.read(memory)));
  };

  return Casting;

})(Ast);

for (typeId in PRIMITIVE_TYPES) {
  type = PRIMITIVE_TYPES[typeId];
  type.castingGenerator = {};
  ref = type.castings;
  fn1 = function(fn) {
    return type.castingGenerator[castingId] = function(r, x) {
      return new Casting(fn, r, x);
    };
  };
  for (castingId in ref) {
    fn = ref[castingId];
    fn1(fn);
  }
}

this.ensureType = function(memoryReference, actualType, expectedType, state, ast, arg) {
  var instructions, onReference, ref1, ref2, releaseReference, result;
  ref1 = arg != null ? arg : {}, releaseReference = (ref2 = ref1.releaseReference) != null ? ref2 : true, onReference = ref1.onReference;
  0;
  0;
  if (actualType !== expectedType) {
    if (actualType.canCastTo(expectedType)) {
      if (releaseReference) {
        state.releaseTemporaries(memoryReference);
      }
      result = onReference != null ? onReference : state.getTemporary(expectedType);
      instructions = actualType.instructionsForCast(expectedType, result, memoryReference);
      return {
        instructions: instructions,
        result: result
      };
    } else {
      return ast.compilationError('INVALID_CAST', 'origin', actualType.getSymbol(), 'dest', expectedType.getSymbol());
    }
  } else {
    return {
      instructions: [],
      result: memoryReference
    };
  }
};


}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../utils":96,"./ast":50}],73:[function(require,module,exports){
var Ast, EXPR_TYPES, Not, PRIMITIVE_TYPES, Uadd, UnaryOp, Usub, ensureType, ref,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType, EXPR_TYPES = ref.EXPR_TYPES;

module.exports = this;

this.UnaryOp = UnaryOp = (function(superClass) {
  extend(UnaryOp, superClass);

  function UnaryOp() {
    return UnaryOp.__super__.constructor.apply(this, arguments);
  }

  UnaryOp.prototype.compile = function(state) {
    var castingInstructions, castingResult, instructions, operand, ref1, result, type, value;
    value = this.children[0];
    operand = value.compile(state);
    ref1 = this.casting(operand, state), type = ref1.type, castingResult = ref1.result, castingInstructions = ref1.instructions;
    state.releaseTemporaries(castingResult);
    result = state.getTemporary(type);
    instructions = slice.call(operand.instructions).concat(slice.call(castingInstructions), [new this.constructor(result, castingResult)]);
    return {
      instructions: instructions,
      type: type,
      result: result,
      exprType: EXPR_TYPES.RVALUE
    };
  };

  UnaryOp.prototype.execute = function(arg) {
    var memory, ref1, value, variable;
    memory = arg.memory;
    ref1 = this.children, variable = ref1[0], value = ref1[1];
    return variable.write(memory, this.f(value.read(memory)));
  };

  return UnaryOp;

})(Ast);

this.Uadd = Uadd = (function(superClass) {
  extend(Uadd, superClass);

  function Uadd() {
    return Uadd.__super__.constructor.apply(this, arguments);
  }

  Uadd.prototype.name = "Uadd";

  Uadd.prototype.casting = function(operand, state) {
    var instructions, operandResult, operandType, ref1, result, type;
    operandType = operand.type, operandResult = operand.result;
    if (!(operandType.isNumeric || operandType.isPointer || operandType.isArray)) {
      ref1 = ensureType(operandResult, operandType, PRIMITIVE_TYPES.INT, state, this), result = ref1.result, instructions = ref1.instructions;
      type = PRIMITIVE_TYPES.INT;
    } else {
      type = operandType;
      result = operandResult;
      instructions = [];
    }
    return {
      type: type,
      result: result,
      instructions: instructions
    };
  };

  Uadd.prototype.f = function(x) {
    return +x;
  };

  return Uadd;

})(UnaryOp);

this.Usub = Usub = (function(superClass) {
  extend(Usub, superClass);

  function Usub() {
    return Usub.__super__.constructor.apply(this, arguments);
  }

  Usub.prototype.name = "Usub";

  Usub.prototype.casting = function(operand, state) {
    var instructions, operandResult, operandType, ref1, result, type;
    operandType = operand.type, operandResult = operand.result;
    if (operandType.isPointer || operandType.isArray) {
      this.compilationError('WRONG_ARGUMENT_UNARY_MINUS', 'type', operandType.getSymbol());
    }
    if (!operandType.isNumeric) {
      ref1 = ensureType(operandResult, operandType, PRIMITIVE_TYPES.INT, state, this), result = ref1.result, instructions = ref1.instructions;
      type = PRIMITIVE_TYPES.INT;
    } else {
      type = operandType;
      result = operandResult;
      instructions = [];
    }
    return {
      type: type,
      result: result,
      instructions: instructions
    };
  };

  Usub.prototype.f = function(x) {
    return -x;
  };

  return Usub;

})(UnaryOp);

this.Not = Not = (function(superClass) {
  extend(Not, superClass);

  function Not() {
    return Not.__super__.constructor.apply(this, arguments);
  }

  Not.prototype.name = "Not";

  Not.prototype.casting = function(operand, state) {
    var instructions, operandResult, operandType, ref1, result;
    operandType = operand.type, operandResult = operand.result;
    ref1 = ensureType(operandResult, operandType, PRIMITIVE_TYPES.BOOL, state, this), result = ref1.result, instructions = ref1.instructions;
    return {
      type: PRIMITIVE_TYPES.BOOL,
      result: result,
      instructions: instructions
    };
  };

  Not.prototype.f = function(x) {
    return !x;
  };

  return Not;

})(UnaryOp);


},{"./ast":50,"./type":72}],74:[function(require,module,exports){
var Ast, Branch, BranchFalse, CloseScope, OpenScope, PRIMITIVE_TYPES, While, countInstructions, ensureType, ref, ref1, ref2,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Ast = require('./ast').Ast;

ref = require('./type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, ensureType = ref.ensureType;

countInstructions = require('../utils').countInstructions;

ref1 = require('./branch'), Branch = ref1.Branch, BranchFalse = ref1.BranchFalse;

ref2 = require('./debug-info'), OpenScope = ref2.OpenScope, CloseScope = ref2.CloseScope;

module.exports = this;

this.While = While = (function(superClass) {
  extend(While, superClass);

  function While() {
    return While.__super__.constructor.apply(this, arguments);
  }

  While.prototype.name = "While";

  While.prototype.compile = function(state) {
    var body, bodyInstructions, bodyInstructionsCount, castingInstructions, castingResult, conditionAst, conditionInstructions, conditionResult, conditionType, ref3, ref4, ref5, topInstructions, topInstructionsCount;
    ref3 = this.children, conditionAst = ref3[0], body = ref3[1];
    ref4 = conditionAst.compile(state), conditionType = ref4.type, conditionInstructions = ref4.instructions, conditionResult = ref4.result;
    ref5 = ensureType(conditionResult, conditionType, PRIMITIVE_TYPES.BOOL, state, this), castingResult = ref5.result, castingInstructions = ref5.instructions;
    state.releaseTemporaries(castingResult);
    state.openScope();
    bodyInstructions = body.compile(state).instructions;
    state.closeScope();
    topInstructions = slice.call(conditionInstructions).concat(slice.call(castingInstructions));
    topInstructions.forEach(function(x) {
      return x.locations = conditionAst.locations;
    });
    bodyInstructionsCount = countInstructions(bodyInstructions);
    topInstructionsCount = countInstructions(topInstructions);
    return {
      type: PRIMITIVE_TYPES.VOID,
      instructions: slice.call(topInstructions).concat([new BranchFalse(castingResult, bodyInstructionsCount + 1)], [new OpenScope()], slice.call(bodyInstructions), [new Branch(-(bodyInstructionsCount + 1 + topInstructionsCount + 1))], [new CloseScope()])
    };
  };

  return While;

})(Ast);


},{"../utils":96,"./ast":50,"./branch":52,"./debug-info":56,"./type":72}],75:[function(require,module,exports){
var Ast, IO, Write,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Ast = require('./ast').Ast;

IO = require('../runtime/io').IO;

this.Write = Write = (function(superClass) {
  extend(Write, superClass);

  function Write() {
    return Write.__super__.constructor.apply(this, arguments);
  }

  Write.prototype.name = "Write";

  Write.prototype.execute = function(arg) {
    var idReference, io, memory, value;
    memory = arg.memory, io = arg.io;
    idReference = this.children[0];
    value = idReference.read(memory);
    return io.output(IO.STDOUT, idReference.getType().castings.COUT(value));
  };

  return Write;

})(Ast);


},{"../runtime/io":94,"./ast":50}],76:[function(require,module,exports){
var compile, parse;

parse = require('./parser').parse;

compile = require('./semantics').compile;

module.exports = this;

this.compile = function(code) {
  var ast, program;
  ast = parse(code);
  program = compile(ast);
  return {
    program: program,
    ast: ast
  };
};


},{"./parser":78,"./semantics":83}],77:[function(require,module,exports){
// Generated by CoffeeScript 1.12.4
var Parser, addLocationData, bnf, lexRules, o, operators, r, start, unwrap;

Parser = require('jison').Parser;

unwrap = /^function\s*\(\)\s*\{\s*return\s*([\s\S]*);\s*\}/;

addLocationData = function(first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
};

o = function(patternString, action, options) {
  var match, patternCount;
  patternString = patternString.replace(/\s{2,}/g, ' ');
  if (!action) {
    return [patternString, '$$ = $1;', options];
  }
  patternCount = patternString.split(' ').length;
  action = (match = unwrap.exec(action)) ? match[1] : "(" + action + "())";
  action = action.replace(/\bnew /g, '$&yy.');
  action = action.replace(/\b(?:Ast.copyOf)\b/g, 'yy.$&');
  action = action.replace(/\b(?:PRIMITIVE_TYPES)/g, 'yy.$&');
  return [patternString, (action.indexOf('$$') >= 0 ? action : "$$ = " + addLocationData + "(@1, @" + patternCount + ")(" + action + ");"), options];
};

r = function(pattern, value) {
  return [pattern.toString().slice(1, -1), value.match(/\/\*.+\*\//) != null ? value : "return '" + value + "'"];
};

lexRules = [r(/\/\/.*/, "/* ignore comment */"), r(/\/\*(.|\n|\r)*?\*\//, "/* ignore multiline comment */"), r(/\s+/, "/* skip whitespace */"), r(/\+\+/, '++'), r(/--/, '--'), r(/\+=/, '+='), r(/-=/, '-='), r(/\*=/, '*='), r(/\/=/, '/='), r(/%=/, '%='), r(/\*/, '*'), r(/\//, '/'), r(/-/, '-'), r(/%/, '%'), r(/\+/, '+'), r(/&/, '&'), r(/!=/, '!='), r(/or\b/, '||'), r(/and\b/, '&&'), r(/not\b/, '!'), r(/not_eq\b/, '!='), r(/<%/, '{'), r(/%>/, '}'), r(/<:/, '['), r(/:>/, ']'), r(/%:/, '#'), r(/\|\|/, '||'), r(/&&/, '&&'), r(/!/, '!'), r(/<</, '<<'), r(/>>/, '>>'), r(/>=/, '>='), r(/<=/, '<='), r(/>/, '>'), r(/</, '<'), r(/==/, '=='), r(/=/, '='), r(/;/, ';'), r(/{/, '{'), r(/}/, '}'), r(/\(/, '('), r(/\)/, ')'), r(/\[/, '['), r(/]/, ']'), r(/,/, ','), r(/#/, '#'), r(/new\b/, 'NEW'), r(/delete\b/, 'DELETE'), r(/return\b/, 'RETURN'), r(/cin\b/, 'CIN'), r(/cout\b/, 'COUT'), r(/endl\b/, 'ENDL'), r(/int\b/, 'INT'), r(/double\b/, 'DOUBLE'), r(/char\b/, 'CHAR'), r(/bool\b/, 'BOOL'), r(/string\b/, 'STRING'), r(/void\b/, 'VOID'), r(/include\b/, 'INCLUDE'), r(/using\b/, 'USING'), r(/namespace\b/, 'NAMESPACE'), r(/std\b/, 'STD'), r(/if\b/, 'IF'), r(/else\b/, 'ELSE'), r(/while\b/, 'WHILE'), r(/for\b/, 'FOR'), r(/const\b/, 'CONST'), r(/true\b/, 'BOOL_LIT'), r(/false\b/, 'BOOL_LIT'), r(/[0-9]*(\.[0-9]+)\b/, 'DOUBLE_LIT'), r(/([1-9][0-9]*|0)/, 'INT_LIT'), r(/'([^\\']|\\.)'/, 'CHAR_LIT'), r(/"([^\\"]|\\.)*"/, 'STRING_LIT'), r(/nullptr\b/, 'NULLPTR'), r(/NULL\b/, 'NULLPTR'), r(/([a-z]|[A-Z]|_)([a-z]|[A-Z]|_|[0-9])*/, 'ID'), r(/$/, 'EOF'), r(/./, 'INVALID')];

operators = [['right', 'THEN', 'ELSE'], ['left', '['], ['nonassoc', '++', '--'], ['right', '!', 'u+', 'u-', 'deref', 'ref', 'NEW', 'DELETE'], ['left', '*', '/', '%'], ['left', '+', '-'], ['left', '>>', '<<'], ['left', '<', '>', '<=', '>='], ['left', '==', '!='], ['left', '&&'], ['left', '||'], ['right', '+=', '-=', '*=', '/=', '%=', '='], ['left', 'CIN'], ['right', 'type_decl']];

bnf = {
  prog: [
    o('top_level_decl_seq EOF', function() {
      return new ProgramAst($1);
    })
  ],
  top_level_decl_seq: [
    o('top_level_decl_seq top_level_decl', function() {
      return $$.addChild($2);
    }), o('', function() {
      return new List;
    })
  ],
  top_level_decl: [
    o('include', function() {
      return null;
    }), o('function'), o('declaration ;')
  ],
  include: [o('# INCLUDE < id >', function() {}), o('USING NAMESPACE STD ;', function() {})],
  "function": [
    o('type_specifier_seq decl_var_reference ( arg_seq ) { block_instr }', function() {
      return new Function(new DeclarationGroup($1, [$2]), $4, $7);
    })
  ],
  arg_seq: [
    o('arg_seq , arg', function() {
      return $$.addChild($3);
    }), o('arg', function() {
      return new List($1);
    }), o('', function() {
      return new List;
    })
  ],
  arg: [
    o('type_specifier_seq decl_var_reference', function() {
      return new FuncArg($1, $2);
    })
  ],
  block_instr: [
    o('block_instr instruction', function() {
      return $$.addChild($2);
    }), o('block_instr { block_instr }', function() {
      return $$.addChild(new ScopedList($3));
    }), o('', function() {
      return new List;
    })
  ],
  instruction: [
    o('basic_stmt ;'), o('if'), o('while'), o('for'), o('return_stmt ;'), o(';', function() {
      return null;
    })
  ],
  basic_stmt: [o('block_assign'), o('declaration'), o('cout'), o('expr')],
  return_stmt: [
    o('RETURN expr', function() {
      return new Return($2);
    }), o('RETURN', function() {
      return new Return;
    })
  ],
  funcall: [
    o('id ( param_seq )', function() {
      return new Funcall($1, $3);
    }), o('id ( VOID )', function() {
      return new Funcall($1, new List);
    })
  ],
  param_seq: [
    o('param_seq , param', function() {
      return $$.push($3);
    }), o('param', function() {
      return [$1];
    }), o('', function() {
      return [];
    })
  ],
  param: [
    o('expr', function() {
      return $1;
    })
  ],
  "if": [
    o('IF ( expr ) instruction_body', (function() {
      return new IfThen($3, $5);
    }), {
      prec: "THEN"
    }), o('IF ( expr ) instruction_body else', function() {
      return new IfThenElse($3, $5, $6);
    })
  ],
  "while": [
    o('WHILE ( expr ) instruction_body', function() {
      return new While($3, $5);
    })
  ],
  optional_expr: [
    o('expr'), o('', function() {
      return false;
    })
  ],
  optional_basic_stmt: [
    o('basic_stmt'), o('', function() {
      return false;
    })
  ],
  "for": [
    o('FOR ( optional_basic_stmt ; optional_expr ; optional_expr ) instruction_body', function() {
      return new For($3, $5, $7, $9);
    })
  ],
  "else": [
    o('ELSE instruction_body', function() {
      return $2;
    })
  ],
  cin: [
    o('CIN block_cin', function() {
      return $2;
    })
  ],
  block_cin: [
    o('block_cin >> expr', function() {
      return $$.addChild($3);
    }), o('>> expr', function() {
      return new Cin($2);
    })
  ],
  cout: [
    o('COUT block_cout', function() {
      return $2;
    })
  ],
  block_cout: [
    o('block_cout << expr', function() {
      return $$.addChild($3);
    }), o('block_cout << ENDL', function() {
      return $$.addChild(new StringLit('"\\n"'));
    }), o('<< expr', function() {
      return new Cout($2);
    }), o('<< ENDL', function() {
      return new Cout(new StringLit('"\\n"'));
    })
  ],
  instruction_body: [
    o('instruction', function() {
      return new List($1);
    }), o('{ block_instr }', function() {
      return $2;
    })
  ],
  decl_assign: [
    o('decl_var_reference = decl_value', function() {
      return new DeclarationAssign($1, $3);
    })
  ],
  decl_value: [o('expr')],

  /*
  initializer: [
      o 'array_initializer'
  ]
   */
  declaration: [
    o('type_specifier_seq declaration_body', function() {
      return new DeclarationGroup($1, $2);
    })
  ],
  type_specifier_seq: [
    o('type_specifier_seq type_specifier', function() {
      return $$.push($2);
    }), o('type_specifier', function() {
      return [$1];
    })
  ],
  type_specifier: [o('CONST'), o('type')],
  declaration_body: [
    o('declaration_body , decl_assign', function() {
      return $$.push($3);
    }), o('declaration_body , decl_var_reference', function() {
      return $$.push($3);
    }), o('decl_assign', function() {
      return [$1];
    }), o('decl_var_reference', function() {
      return [$1];
    })
  ],
  decl_var_reference: [
    o('id', function() {
      return new IdDeclaration($1);
    }), o('decl_var_reference dimension', function() {
      return new ArrayDeclaration($1, $2);
    }), o('* decl_var_reference', (function() {
      return new PointerDeclaration($2);
    }), {
      prec: "deref"
    }), o('* CONST decl_var_reference', (function() {
      return new PointerDeclaration(new ConstDeclaration($3));
    }), {
      prec: "deref"
    }), o('( decl_var_reference )', function() {
      return $2;
    })
  ],
  nonpointer_type_decl: [
    o('nonnull_dimension', function() {
      return new NewArrayDeclaration(new NewDeclaration, $1);
    }), o('nonpointer_type_decl dimension', function() {
      return new NewArrayDeclaration($1, $2);
    })
  ],
  type_decl_imm: [
    o('', (function() {
      return new NewDeclaration;
    }), {
      prec: "type_decl"
    }), o('nonpointer_type_decl', (function() {
      return $1;
    }), {
      prec: "type_decl"
    }), o('* type_decl_imm', function() {
      return new NewPointerDeclaration($2);
    }), o('* CONST type_decl_imm', function() {
      return new NewPointerDeclaration(new ConstDeclaration($3));
    })
  ],
  type_decl: [
    o('type_decl_imm', function() {
      return $1;
    }), o('( type_decl_imm )', function() {
      return $2;
    })
  ],
  dimension: [
    o('[ expr ]', function() {
      return $2;
    }), o('[ ]', function() {
      return new EmptyDimension;
    })
  ],
  nonnull_dimension: [
    o('[ expr ]', function() {
      return $2;
    })
  ],

  /*
  array_initializer: [
      o '{ array_initializer_value_seq }',                                  -> new ArrayInitializer $2
  ]
  
  array_initializer_value_seq: [ # TODO: Extend this to allow any expression (not only literals). Requires to implement a constant expression evaluator
      o 'array_initializer_value_seq , array_initializer_value',            -> $$.push $3
      o 'array_initializer_value',                                          -> [$1]
  ]
  
  array_initializer_value: [
      o 'literal'
      o 'initializer'
  ]
   */
  accessor: [
    o('[ expr ]', function() {
      return $2;
    })
  ],
  type: [
    o('INT', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    }), o('DOUBLE', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    }), o('CHAR', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    }), o('BOOL', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    }), o('STRING', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    }), o('VOID', function() {
      return PRIMITIVE_TYPES[$1.toUpperCase()];
    })
  ],
  literal: [
    o('DOUBLE_LIT', function() {
      return new DoubleLit($1);
    }), o('INT_LIT', function() {
      return new IntLit($1);
    }), o('CHAR_LIT', function() {
      return new CharLit($1);
    }), o('BOOL_LIT', function() {
      return new BoolLit($1);
    }), o('STRING_LIT', function() {
      return new StringLit($1);
    }), o('NULLPTR', function() {
      return new NullPtr;
    })
  ],
  new_expr: [
    o('NEW type_specifier_seq type_decl', function() {
      return new New($2, $3);
    }), o('NEW ( type_specifier_seq type_decl )', function() {
      return new New($3, $4);
    })
  ],
  delete_expr: [
    o('DELETE [ ] expr', function() {
      return new Delete($2, $4);
    }), o('DELETE expr', function() {
      return new Delete($2);
    })
  ],
  expr: [
    o('expr + expr', function() {
      return new Add($1, $3);
    }), o('expr - expr', function() {
      return new Sub($1, $3);
    }), o('expr * expr', function() {
      return new Mul($1, $3);
    }), o('expr / expr', function() {
      return new Div($1, $3);
    }), o('expr % expr', function() {
      return new Mod($1, $3);
    }), o('expr && expr', function() {
      return new And($1, $3);
    }), o('expr || expr', function() {
      return new Or($1, $3);
    }), o('expr < expr', function() {
      return new Lt($1, $3);
    }), o('expr > expr', function() {
      return new Gt($1, $3);
    }), o('expr <= expr', function() {
      return new Lte($1, $3);
    }), o('expr >= expr', function() {
      return new Gte($1, $3);
    }), o('expr == expr', function() {
      return new Eq($1, $3);
    }), o('expr != expr', function() {
      return new Neq($1, $3);
    }), o('expr += expr', function() {
      return new AddAssign($1, $3);
    }), o('expr -= expr', function() {
      return new SubAssign($1, $3);
    }), o('expr *= expr', function() {
      return new MulAssign($1, $3);
    }), o('expr /= expr', function() {
      return new DivAssign($1, $3);
    }), o('expr %= expr', function() {
      return new ModAssign($1, $3);
    }), o('expr = expr', function() {
      return new Assign($1, $3);
    }), o('- expr', (function() {
      return new Usub($2);
    }), {
      prec: "u-"
    }), o('+ expr', (function() {
      return new Uadd($2);
    }), {
      prec: "u+"
    }), o('! expr', function() {
      return new Not($2);
    }), o('++ expr', function() {
      return new PreInc($2);
    }), o('-- expr', function() {
      return new PreDec($2);
    }), o('& expr', (function() {
      return new AddressOf($2);
    }), {
      prec: "ref"
    }), o('* expr', (function() {
      return new Dereference($2);
    }), {
      prec: "deref"
    }), o('funcall'), o('id'), o('expr accessor', function() {
      return new ArraySubscript($1, $2);
    }), o('( expr )', function() {
      return $2;
    }), o('literal'), o('expr ++', function() {
      return new PostInc($1);
    }), o('expr --', function() {
      return new PostDec($1);
    }), o('cin'), o('new_expr'), o('delete_expr')
  ],
  id: [
    o('ID', function() {
      return new Id($1);
    })
  ]
};

start = "prog";

bnf[start][0][1] = "return " + bnf[start][0][1];

exports.parser = new Parser({
  lex: {
    rules: lexRules
  },
  operators: operators.reverse(),
  start: start,
  bnf: bnf
});

},{"jison":25}],78:[function(require,module,exports){
var astModule, compilationError, isTravisCiBuild, parser;

isTravisCiBuild = require('is-travis-ci-build');

if (isTravisCiBuild()) {
  parser = require('./grammar').parser;
} else {
  parser = require('./parser').parser;
}

astModule = require('../../ast');

compilationError = require('../../messages').compilationError;

module.exports = this;

parser.yy = astModule;

this.parse = function(code) {
  var ast, error;
  try {
    ast = parser.parse(code);
  } catch (error1) {
    error = error1;
    compilationError('PARSING_ERROR', null, 'error', error.message);
  }
  return ast;
};


},{"../../ast":63,"../../messages":90,"./grammar":77,"./parser":79,"is-travis-ci-build":22}],79:[function(require,module,exports){
(function (process){
/* parser generated by jison 0.4.17 */
/*
  Returns a Parser object of the following structure:

  Parser: {
    yy: {}
  }

  Parser.prototype: {
    yy: {},
    trace: function(),
    symbols_: {associative list: name ==> number},
    terminals_: {associative list: number ==> name},
    productions_: [...],
    performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate, $$, _$),
    table: [...],
    defaultActions: {...},
    parseError: function(str, hash),
    parse: function(input),

    lexer: {
        EOF: 1,
        parseError: function(str, hash),
        setInput: function(input),
        input: function(),
        unput: function(str),
        more: function(),
        less: function(n),
        pastInput: function(),
        upcomingInput: function(),
        showPosition: function(),
        test_match: function(regex_match_array, rule_index),
        next: function(),
        lex: function(),
        begin: function(condition),
        popState: function(),
        _currentRules: function(),
        topState: function(),
        pushState: function(condition),

        options: {
            ranges: boolean           (optional: true ==> token location info will include a .range[] member)
            flex: boolean             (optional: true ==> flex-like lexing behaviour where the rules are tested exhaustively to find the longest match)
            backtrack_lexer: boolean  (optional: true ==> lexer regexes are tested in order and for each matching regex the action code is invoked; the lexer terminates the scan when a token is returned by the action code)
        },

        performAction: function(yy, yy_, $avoiding_name_collisions, YY_START),
        rules: [...],
        conditions: {associative list: name ==> set},
    }
  }


  token location info (@$, _$, etc.): {
    first_line: n,
    last_line: n,
    first_column: n,
    last_column: n,
    range: [start_number, end_number]       (where the numbers are indexes into the input string, regular zero-based)
  }


  the parseError function receives a 'hash' object with these members for lexer and parser errors: {
    text:        (matched text)
    token:       (the produced terminal token, if any)
    line:        (yylineno)
  }
  while parser (grammar) errors will also provide these members, i.e. parser errors deliver a superset of attributes: {
    loc:         (yylloc)
    expected:    (string describing the set of expected tokens)
    recoverable: (boolean: TRUE when the parser has a error recovery rule available for this particular error)
  }
*/
var parser = (function(){
var o=function(k,v,o,l){for(o=o||{},l=k.length;l--;o[k[l]]=v);return o},$V0=[5,11,16,41,64,75,76,77,78,79],$V1=[1,19],$V2=[1,12],$V3=[1,14],$V4=[1,15],$V5=[1,16],$V6=[1,17],$V7=[1,18],$V8=[1,28],$V9=[1,27],$Va=[1,30],$Vb=[10,13,15,21,23,27,41,54,57,60,64,67,72,73,75,76,77,78,79,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108,110],$Vc=[10,27],$Vd=[2,64],$Ve=[1,35],$Vf=[1,36],$Vg=[10,21,23,27,60,72],$Vh=[10,13,15,21,23,27,54,57,60,67,72,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108],$Vi=[23,27],$Vj=[1,57],$Vk=[1,68],$Vl=[1,54],$Vm=[1,62],$Vn=[1,63],$Vo=[1,64],$Vp=[1,65],$Vq=[1,66],$Vr=[1,67],$Vs=[1,69],$Vt=[1,70],$Vu=[1,49],$Vv=[1,48],$Vw=[1,50],$Vx=[1,51],$Vy=[1,52],$Vz=[1,53],$VA=[10,21,23,27,60],$VB=[1,88],$VC=[1,89],$VD=[1,99],$VE=[1,83],$VF=[1,103],$VG=[1,81],$VH=[1,82],$VI=[1,84],$VJ=[1,85],$VK=[1,86],$VL=[1,87],$VM=[1,90],$VN=[1,91],$VO=[1,92],$VP=[1,93],$VQ=[1,94],$VR=[1,95],$VS=[1,96],$VT=[1,97],$VU=[1,98],$VV=[1,101],$VW=[1,102],$VX=[10,13,15,23,27,54,57,60,67,72,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108],$VY=[10,13,15,23,27,54,57,60,67,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105],$VZ=[10,13,15,23,27,54,57,60,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108],$V_=[2,72],$V$=[1,151],$V01=[1,153],$V11=[1,155],$V21=[10,21,24,26,35,38,41,43,46,49,52,55,64,67,75,76,77,78,79,81,82,83,84,85,86,88,90,91,92,106,107,108,109,110],$V31=[2,16],$V41=[10,13,15,23,27,54,57,60,73,91,92,95,96,97,98,99,100,101,102,103,104,105],$V51=[10,13,15,23,27,54,57,60,73,95,96,97,98,99,100,101,102,103,104,105],$V61=[10,23,27,54,57,60,73,95,96,99,100,101,102,103,104,105],$V71=[10,23,27,54,57,73],$V81=[1,179],$V91=[1,173],$Va1=[1,180],$Vb1=[1,187],$Vc1=[1,184],$Vd1=[1,185],$Ve1=[1,186],$Vf1=[1,189],$Vg1=[10,21,24,26,35,38,41,43,46,49,50,52,55,64,67,75,76,77,78,79,81,82,83,84,85,86,88,90,91,92,106,107,108,109,110],$Vh1=[10,57],$Vi1=[1,220],$Vj1=[2,39];
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"prog":3,"top_level_decl_seq":4,"EOF":5,"top_level_decl":6,"include":7,"function":8,"declaration":9,";":10,"#":11,"INCLUDE":12,"<":13,"id":14,">":15,"USING":16,"NAMESPACE":17,"STD":18,"type_specifier_seq":19,"decl_var_reference":20,"(":21,"arg_seq":22,")":23,"{":24,"block_instr":25,"}":26,",":27,"arg":28,"instruction":29,"basic_stmt":30,"if":31,"while":32,"for":33,"return_stmt":34,"block_assign":35,"cout":36,"expr":37,"RETURN":38,"funcall":39,"param_seq":40,"VOID":41,"param":42,"IF":43,"instruction_body":44,"else":45,"WHILE":46,"optional_expr":47,"optional_basic_stmt":48,"FOR":49,"ELSE":50,"cin":51,"CIN":52,"block_cin":53,">>":54,"COUT":55,"block_cout":56,"<<":57,"ENDL":58,"decl_assign":59,"=":60,"decl_value":61,"declaration_body":62,"type_specifier":63,"CONST":64,"type":65,"dimension":66,"*":67,"nonpointer_type_decl":68,"nonnull_dimension":69,"type_decl_imm":70,"type_decl":71,"[":72,"]":73,"accessor":74,"INT":75,"DOUBLE":76,"CHAR":77,"BOOL":78,"STRING":79,"literal":80,"DOUBLE_LIT":81,"INT_LIT":82,"CHAR_LIT":83,"BOOL_LIT":84,"STRING_LIT":85,"NULLPTR":86,"new_expr":87,"NEW":88,"delete_expr":89,"DELETE":90,"+":91,"-":92,"/":93,"%":94,"&&":95,"||":96,"<=":97,">=":98,"==":99,"!=":100,"+=":101,"-=":102,"*=":103,"/=":104,"%=":105,"!":106,"++":107,"--":108,"&":109,"ID":110,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",10:";",11:"#",12:"INCLUDE",13:"<",15:">",16:"USING",17:"NAMESPACE",18:"STD",21:"(",23:")",24:"{",26:"}",27:",",35:"block_assign",38:"RETURN",41:"VOID",43:"IF",46:"WHILE",49:"FOR",50:"ELSE",52:"CIN",54:">>",55:"COUT",57:"<<",58:"ENDL",60:"=",64:"CONST",67:"*",72:"[",73:"]",75:"INT",76:"DOUBLE",77:"CHAR",78:"BOOL",79:"STRING",81:"DOUBLE_LIT",82:"INT_LIT",83:"CHAR_LIT",84:"BOOL_LIT",85:"STRING_LIT",86:"NULLPTR",88:"NEW",90:"DELETE",91:"+",92:"-",93:"/",94:"%",95:"&&",96:"||",97:"<=",98:">=",99:"==",100:"!=",101:"+=",102:"-=",103:"*=",104:"/=",105:"%=",106:"!",107:"++",108:"--",109:"&",110:"ID"},
productions_: [0,[3,2],[4,2],[4,0],[6,1],[6,1],[6,2],[7,5],[7,4],[8,8],[22,3],[22,1],[22,0],[28,2],[25,2],[25,4],[25,0],[29,2],[29,1],[29,1],[29,1],[29,2],[29,1],[30,1],[30,1],[30,1],[30,1],[34,2],[34,1],[39,4],[39,4],[40,3],[40,1],[40,0],[42,1],[31,5],[31,6],[32,5],[47,1],[47,0],[48,1],[48,0],[33,9],[45,2],[51,2],[53,3],[53,2],[36,2],[56,3],[56,3],[56,2],[56,2],[44,1],[44,3],[59,3],[61,1],[9,2],[19,2],[19,1],[63,1],[63,1],[62,3],[62,3],[62,1],[62,1],[20,1],[20,2],[20,2],[20,3],[20,3],[68,1],[68,2],[70,0],[70,1],[70,2],[70,3],[71,1],[71,3],[66,3],[66,2],[69,3],[74,3],[65,1],[65,1],[65,1],[65,1],[65,1],[65,1],[80,1],[80,1],[80,1],[80,1],[80,1],[80,1],[87,3],[87,5],[89,4],[89,2],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,3],[37,2],[37,2],[37,2],[37,2],[37,2],[37,2],[37,2],[37,1],[37,1],[37,2],[37,3],[37,1],[37,2],[37,2],[37,1],[37,1],[37,1],[14,1]],
performAction: function anonymous(yytext, yyleng, yylineno, yy, yystate /* action[1] */, $$ /* vstack */, _$ /* lstack */) {
/* this == yyval */

var $0 = $$.length - 1;
switch (yystate) {
case 1:
return this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.ProgramAst($$[$0-1]));
break;
case 2: case 10: case 14: case 45: case 48:
this.$.addChild($$[$0])
break;
case 3: case 12: case 16:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.List);
break;
case 4: case 22:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(null);
break;
case 5: case 18: case 19: case 20: case 23: case 24: case 25: case 26: case 38: case 40: case 55: case 59: case 60: case 124: case 125: case 128: case 131: case 132: case 133:
this.$ = $$[$0];
break;
case 6: case 17: case 21:
this.$ = $$[$0-1];
break;
case 7:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-4], _$[$0])((function () {}()));
break;
case 8:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-3], _$[$0])((function () {}()));
break;
case 9:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-7], _$[$0])(new yy.Function(new yy.DeclarationGroup($$[$0-7], [$$[$0-6]]), $$[$0-4], $$[$0-1]));
break;
case 11: case 52:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.List($$[$0]));
break;
case 13:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.FuncArg($$[$0-1], $$[$0]));
break;
case 15:
this.$.addChild(new yy.ScopedList($$[$0-1]))
break;
case 27:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Return($$[$0]));
break;
case 28:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.Return);
break;
case 29:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-3], _$[$0])(new yy.Funcall($$[$0-3], $$[$0-1]));
break;
case 30:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-3], _$[$0])(new yy.Funcall($$[$0-3], new yy.List));
break;
case 31: case 57: case 61: case 62:
this.$.push($$[$0])
break;
case 32: case 58: case 63: case 64:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])([$$[$0]]);
break;
case 33:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])([]);
break;
case 34: case 73: case 76:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])($$[$0]);
break;
case 35:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-4], _$[$0])(new yy.IfThen($$[$0-2], $$[$0]));
break;
case 36:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-5], _$[$0])(new yy.IfThenElse($$[$0-3], $$[$0-1], $$[$0]));
break;
case 37:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-4], _$[$0])(new yy.While($$[$0-2], $$[$0]));
break;
case 39: case 41:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(false);
break;
case 42:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-8], _$[$0])(new yy.For($$[$0-6], $$[$0-4], $$[$0-2], $$[$0]));
break;
case 43: case 44: case 47:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])($$[$0]);
break;
case 46:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Cin($$[$0]));
break;
case 49:
this.$.addChild(new yy.StringLit('"\\n"'))
break;
case 50:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Cout($$[$0]));
break;
case 51:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Cout(new yy.StringLit('"\\n"')));
break;
case 53: case 69: case 77: case 78: case 80: case 81: case 127:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])($$[$0-1]);
break;
case 54:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.DeclarationAssign($$[$0-2], $$[$0]));
break;
case 56:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.DeclarationGroup($$[$0-1], $$[$0]));
break;
case 65:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.IdDeclaration($$[$0]));
break;
case 66:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.ArrayDeclaration($$[$0-1], $$[$0]));
break;
case 67:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.PointerDeclaration($$[$0]));
break;
case 68:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.PointerDeclaration(new yy.ConstDeclaration($$[$0])));
break;
case 70:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.NewArrayDeclaration(new yy.NewDeclaration, $$[$0]));
break;
case 71:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.NewArrayDeclaration($$[$0-1], $$[$0]));
break;
case 72:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.NewDeclaration);
break;
case 74:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.NewPointerDeclaration($$[$0]));
break;
case 75:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.NewPointerDeclaration(new yy.ConstDeclaration($$[$0])));
break;
case 79:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.EmptyDimension);
break;
case 82: case 83: case 84: case 85: case 86: case 87:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(yy.PRIMITIVE_TYPES[$$[$0].toUpperCase()]);
break;
case 88:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.DoubleLit($$[$0]));
break;
case 89:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.IntLit($$[$0]));
break;
case 90:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.CharLit($$[$0]));
break;
case 91:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.BoolLit($$[$0]));
break;
case 92:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.StringLit($$[$0]));
break;
case 93:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.NullPtr);
break;
case 94:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.New($$[$0-1], $$[$0]));
break;
case 95:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-4], _$[$0])(new yy.New($$[$0-2], $$[$0-1]));
break;
case 96:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-3], _$[$0])(new yy.Delete($$[$0-2], $$[$0]));
break;
case 97:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Delete($$[$0]));
break;
case 98:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Add($$[$0-2], $$[$0]));
break;
case 99:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Sub($$[$0-2], $$[$0]));
break;
case 100:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Mul($$[$0-2], $$[$0]));
break;
case 101:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Div($$[$0-2], $$[$0]));
break;
case 102:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Mod($$[$0-2], $$[$0]));
break;
case 103:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.And($$[$0-2], $$[$0]));
break;
case 104:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Or($$[$0-2], $$[$0]));
break;
case 105:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Lt($$[$0-2], $$[$0]));
break;
case 106:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Gt($$[$0-2], $$[$0]));
break;
case 107:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Lte($$[$0-2], $$[$0]));
break;
case 108:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Gte($$[$0-2], $$[$0]));
break;
case 109:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Eq($$[$0-2], $$[$0]));
break;
case 110:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Neq($$[$0-2], $$[$0]));
break;
case 111:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.AddAssign($$[$0-2], $$[$0]));
break;
case 112:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.SubAssign($$[$0-2], $$[$0]));
break;
case 113:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.MulAssign($$[$0-2], $$[$0]));
break;
case 114:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.DivAssign($$[$0-2], $$[$0]));
break;
case 115:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.ModAssign($$[$0-2], $$[$0]));
break;
case 116:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-2], _$[$0])(new yy.Assign($$[$0-2], $$[$0]));
break;
case 117:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Usub($$[$0]));
break;
case 118:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Uadd($$[$0]));
break;
case 119:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Not($$[$0]));
break;
case 120:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.PreInc($$[$0]));
break;
case 121:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.PreDec($$[$0]));
break;
case 122:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.AddressOf($$[$0]));
break;
case 123:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.Dereference($$[$0]));
break;
case 126:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.ArraySubscript($$[$0-1], $$[$0]));
break;
case 129:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.PostInc($$[$0-1]));
break;
case 130:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0-1], _$[$0])(new yy.PostDec($$[$0-1]));
break;
case 134:
this.$ = function (first, last) {
  return function(obj) {
    if (obj !== null && typeof obj === "object") {
      obj.locations = {
        lines: {
          first: first.first_line,
          last: last.last_line
        },
        columns: {
          first: first.first_column,
          last: last.last_column
        }
      };
    }
    return obj;
  };
}(_$[$0], _$[$0])(new yy.Id($$[$0]));
break;
}
},
table: [o($V0,[2,3],{3:1,4:2}),{1:[3]},{5:[1,3],6:4,7:5,8:6,9:7,11:[1,8],16:[1,9],19:10,41:$V1,63:11,64:$V2,65:13,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7},{1:[2,1]},o($V0,[2,2]),o($V0,[2,4]),o($V0,[2,5]),{10:[1,20]},{12:[1,21]},{17:[1,22]},{14:26,20:23,21:$V8,41:$V1,59:29,62:24,63:25,64:$V2,65:13,67:$V9,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,110:$Va},o($Vb,[2,58]),o($Vb,[2,59]),o($Vb,[2,60]),o($Vb,[2,82]),o($Vb,[2,83]),o($Vb,[2,84]),o($Vb,[2,85]),o($Vb,[2,86]),o($Vb,[2,87]),o($V0,[2,6]),{13:[1,31]},{18:[1,32]},o($Vc,$Vd,{66:34,21:[1,33],60:$Ve,72:$Vf}),{10:[2,56],27:[1,37]},o($Vb,[2,57]),o($Vg,[2,65]),{14:26,20:38,21:$V8,64:[1,39],67:$V9,110:$Va},{14:26,20:40,21:$V8,67:$V9,110:$Va},o($Vc,[2,63]),o($Vh,[2,134]),{14:41,110:$Va},{10:[1,42]},o($Vi,[2,12],{63:11,65:13,22:43,28:44,19:45,41:$V1,64:$V2,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7}),o($Vg,[2,66]),{14:56,21:$Vj,37:47,39:55,51:59,52:$Vk,61:46,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:71,39:55,51:59,52:$Vk,67:$Vl,73:[1,72],80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:26,20:74,21:$V8,59:73,67:$V9,110:$Va},o($VA,[2,67],{66:34,72:$Vf}),{14:26,20:75,21:$V8,67:$V9,110:$Va},{23:[1,76],66:34,72:$Vf},{15:[1,77]},o($V0,[2,8]),{23:[1,78],27:[1,79]},o($Vi,[2,11]),{14:26,20:80,21:$V8,41:$V1,63:25,64:$V2,65:13,67:$V9,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,110:$Va},o($Vc,[2,54]),o($Vc,[2,55],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),{14:56,21:$Vj,37:104,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:105,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:106,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:107,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:108,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:109,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:110,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VX,[2,124]),o($VX,[2,125],{21:[1,111]}),{14:56,21:$Vj,37:112,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VX,[2,128]),o($VX,[2,131]),o($VX,[2,132]),o($VX,[2,133]),o($VX,[2,88]),o($VX,[2,89]),o($VX,[2,90]),o($VX,[2,91]),o($VX,[2,92]),o($VX,[2,93]),{53:113,54:[1,114]},{19:115,21:[1,116],41:$V1,63:11,64:$V2,65:13,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7},{14:56,21:$Vj,37:118,39:55,51:59,52:$Vk,67:$Vl,72:[1,117],80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,73:[1,119],74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},o($Vh,[2,79]),o($Vc,[2,61]),o($Vc,[2,62],{66:34,60:$Ve,72:$Vf}),o($VA,[2,68],{66:34,72:$Vf}),o($Vg,[2,69]),o($V0,[2,7]),{24:[1,120]},{19:45,28:121,41:$V1,63:11,64:$V2,65:13,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7},o($Vi,[2,13],{66:34,72:$Vf}),{14:56,21:$Vj,37:122,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:123,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:124,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:125,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:126,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:127,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:128,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:129,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:130,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:131,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:132,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:133,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:134,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:135,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:136,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:137,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:138,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:139,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:140,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VX,[2,126]),o($VX,[2,129]),o($VX,[2,130]),{14:56,21:$Vj,37:141,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VY,[2,117],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,118],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,119],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,120],{74:100,72:$VF}),o($VY,[2,121],{74:100,72:$VF}),o($VY,[2,122],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,123],{74:100,72:$VF,107:$VV,108:$VW}),o($Vi,[2,33],{39:55,14:56,80:58,51:59,87:60,89:61,40:142,42:144,37:145,21:$Vj,41:[1,143],52:$Vk,67:$Vl,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,88:$Vs,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va}),{13:$VB,15:$VC,23:[1,146],60:$VD,67:$VE,72:$VF,74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},o([10,13,15,23,27,57,60,67,72,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108],[2,44],{54:[1,147]}),{14:56,21:$Vj,37:148,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VZ,$V_,{65:13,63:25,71:149,70:150,68:152,69:154,21:$V$,41:$V1,64:$V2,67:$V01,72:$V11,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7}),{19:156,41:$V1,63:11,64:$V2,65:13,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7},{73:[1,157]},o($VY,[2,97],{74:100,72:$VF,107:$VV,108:$VW}),o($Vh,[2,78]),o($V21,$V31,{25:158}),o($Vi,[2,10]),o($V41,[2,98],{74:100,67:$VE,72:$VF,93:$VI,94:$VJ,107:$VV,108:$VW}),o($V41,[2,99],{74:100,67:$VE,72:$VF,93:$VI,94:$VJ,107:$VV,108:$VW}),o($VY,[2,100],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,101],{74:100,72:$VF,107:$VV,108:$VW}),o($VY,[2,102],{74:100,72:$VF,107:$VV,108:$VW}),o([10,23,27,54,57,60,73,95,96,101,102,103,104,105],[2,103],{74:100,13:$VB,15:$VC,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,97:$VM,98:$VN,99:$VO,100:$VP,107:$VV,108:$VW}),o([10,23,27,54,57,60,73,96,101,102,103,104,105],[2,104],{74:100,13:$VB,15:$VC,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,97:$VM,98:$VN,99:$VO,100:$VP,107:$VV,108:$VW}),o($V51,[2,105],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),o($V51,[2,106],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),o($V51,[2,107],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),o($V51,[2,108],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),o($V61,[2,109],{74:100,13:$VB,15:$VC,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,97:$VM,98:$VN,107:$VV,108:$VW}),o($V61,[2,110],{74:100,13:$VB,15:$VC,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,97:$VM,98:$VN,107:$VV,108:$VW}),o($V71,[2,111],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($V71,[2,112],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($V71,[2,113],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($V71,[2,114],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($V71,[2,115],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($V71,[2,116],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),{13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,73:[1,159],74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},{23:[1,160],27:[1,161]},{23:[1,162]},o($Vi,[2,32]),o($Vi,[2,34],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($VX,[2,127]),{14:56,21:$Vj,37:163,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($V51,[2,46],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),o($VX,[2,94]),o($VX,[2,76]),{23:$V_,67:$V01,68:152,69:154,70:164,72:$V11},o([10,13,15,23,27,54,57,60,67,73,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,107,108],[2,73],{66:165,72:$Vf}),o($VZ,$V_,{68:152,69:154,70:166,64:[1,167],67:$V01,72:$V11}),o($VX,[2,70]),{14:56,21:$Vj,37:168,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{21:$V$,23:$V_,41:$V1,63:25,64:$V2,65:13,67:$V01,68:152,69:154,70:150,71:169,72:$V11,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7},{14:56,21:$Vj,37:170,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{9:181,10:$V81,14:56,19:188,21:$Vj,24:$V91,26:[1,171],29:172,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VX,[2,81]),o($VX,[2,29]),{14:56,21:$Vj,37:145,39:55,42:190,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($VX,[2,30]),o($V51,[2,45],{74:100,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,107:$VV,108:$VW}),{23:[1,191]},o($VX,[2,71]),o($VX,[2,74]),o($VZ,$V_,{68:152,69:154,70:192,67:$V01,72:$V11}),{13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,73:[1,193],74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},{23:[1,194]},o($VY,[2,96],{74:100,72:$VF,107:$VV,108:$VW}),o($V0,[2,9]),o($V21,[2,14]),o($V21,$V31,{25:195}),{10:[1,196]},o($Vg1,[2,18]),o($Vg1,[2,19]),o($Vg1,[2,20]),{10:[1,197]},o($Vg1,[2,22]),{10:[2,23]},{10:[2,24]},{10:[2,25]},{10:[2,26],13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},{21:[1,198]},{21:[1,199]},{21:[1,200]},{10:[2,28],14:56,21:$Vj,37:201,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:26,20:202,21:$V8,41:$V1,59:29,62:24,63:25,64:$V2,65:13,67:$V9,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,110:$Va},{56:203,57:[1,204]},o($Vi,[2,31]),o($VX,[2,77]),o($VX,[2,75]),o($VX,[2,80]),o($VX,[2,95]),{9:181,10:$V81,14:56,19:188,21:$Vj,24:$V91,26:[1,205],29:172,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($Vg1,[2,17]),o($Vg1,[2,21]),{14:56,21:$Vj,37:206,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,37:207,39:55,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{9:181,10:[2,41],14:56,19:188,21:$Vj,30:209,35:$Va1,36:182,37:183,39:55,41:$V1,48:208,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{10:[2,27],13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},o($Vc,$Vd,{66:34,60:$Ve,72:$Vf}),{10:[2,47],57:[1,210]},{14:56,21:$Vj,37:211,39:55,51:59,52:$Vk,58:[1,212],67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($V21,[2,15]),{13:$VB,15:$VC,23:[1,213],60:$VD,67:$VE,72:$VF,74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},{13:$VB,15:$VC,23:[1,214],60:$VD,67:$VE,72:$VF,74:100,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW},{10:[1,215]},{10:[2,40]},{14:56,21:$Vj,37:216,39:55,51:59,52:$Vk,58:[1,217],67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($Vh1,[2,50],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($Vh1,[2,51]),{9:181,10:$V81,14:56,19:188,21:$Vj,24:$Vi1,29:219,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,44:218,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{9:181,10:$V81,14:56,19:188,21:$Vj,24:$Vi1,29:219,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,44:221,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{10:$Vj1,14:56,21:$Vj,37:223,39:55,47:222,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($Vh1,[2,48],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($Vh1,[2,49]),o($V21,[2,35],{45:224,50:[1,225]}),o($Vg1,[2,52]),o($V21,$V31,{25:226}),o($Vg1,[2,37]),{10:[1,227]},o([10,23],[2,38],{74:100,13:$VB,15:$VC,60:$VD,67:$VE,72:$VF,91:$VG,92:$VH,93:$VI,94:$VJ,95:$VK,96:$VL,97:$VM,98:$VN,99:$VO,100:$VP,101:$VQ,102:$VR,103:$VS,104:$VT,105:$VU,107:$VV,108:$VW}),o($Vg1,[2,36]),{9:181,10:$V81,14:56,19:188,21:$Vj,24:$Vi1,29:219,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,44:228,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{9:181,10:$V81,14:56,19:188,21:$Vj,24:$V91,26:[1,229],29:172,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},{14:56,21:$Vj,23:$Vj1,37:223,39:55,47:230,51:59,52:$Vk,67:$Vl,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($Vg1,[2,43]),o($Vg1,[2,53]),{23:[1,231]},{9:181,10:$V81,14:56,19:188,21:$Vj,24:$Vi1,29:219,30:174,31:175,32:176,33:177,34:178,35:$Va1,36:182,37:183,38:$Vb1,39:55,41:$V1,43:$Vc1,44:232,46:$Vd1,49:$Ve1,51:59,52:$Vk,55:$Vf1,63:11,64:$V2,65:13,67:$Vl,75:$V3,76:$V4,77:$V5,78:$V6,79:$V7,80:58,81:$Vm,82:$Vn,83:$Vo,84:$Vp,85:$Vq,86:$Vr,87:60,88:$Vs,89:61,90:$Vt,91:$Vu,92:$Vv,106:$Vw,107:$Vx,108:$Vy,109:$Vz,110:$Va},o($Vg1,[2,42])],
defaultActions: {3:[2,1],180:[2,23],181:[2,24],182:[2,25],209:[2,40]},
parseError: function parseError(str, hash) {
    if (hash.recoverable) {
        this.trace(str);
    } else {
        function _parseError (msg, hash) {
            this.message = msg;
            this.hash = hash;
        }
        _parseError.prototype = Error;

        throw new _parseError(str, hash);
    }
},
parse: function parse(input) {
    var self = this, stack = [0], tstack = [], vstack = [null], lstack = [], table = this.table, yytext = '', yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    var args = lstack.slice.call(arguments, 1);
    var lexer = Object.create(this.lexer);
    var sharedState = { yy: {} };
    for (var k in this.yy) {
        if (Object.prototype.hasOwnProperty.call(this.yy, k)) {
            sharedState.yy[k] = this.yy[k];
        }
    }
    lexer.setInput(input, sharedState.yy);
    sharedState.yy.lexer = lexer;
    sharedState.yy.parser = this;
    if (typeof lexer.yylloc == 'undefined') {
        lexer.yylloc = {};
    }
    var yyloc = lexer.yylloc;
    lstack.push(yyloc);
    var ranges = lexer.options && lexer.options.ranges;
    if (typeof sharedState.yy.parseError === 'function') {
        this.parseError = sharedState.yy.parseError;
    } else {
        this.parseError = Object.getPrototypeOf(this).parseError;
    }
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    _token_stack:
        var lex = function () {
            var token;
            token = lexer.lex() || EOF;
            if (typeof token !== 'number') {
                token = self.symbols_[token] || token;
            }
            return token;
        };
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == 'undefined') {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
                    if (typeof action === 'undefined' || !action.length || !action[0]) {
                var errStr = '';
                expected = [];
                for (p in table[state]) {
                    if (this.terminals_[p] && p > TERROR) {
                        expected.push('\'' + this.terminals_[p] + '\'');
                    }
                }
                if (lexer.showPosition) {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ':\n' + lexer.showPosition() + '\nExpecting ' + expected.join(', ') + ', got \'' + (this.terminals_[symbol] || symbol) + '\'';
                } else {
                    errStr = 'Parse error on line ' + (yylineno + 1) + ': Unexpected ' + (symbol == EOF ? 'end of input' : '\'' + (this.terminals_[symbol] || symbol) + '\'');
                }
                this.parseError(errStr, {
                    text: lexer.match,
                    token: this.terminals_[symbol] || symbol,
                    line: lexer.yylineno,
                    loc: yyloc,
                    expected: expected
                });
            }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error('Parse Error: multiple actions possible at state: ' + state + ', token: ' + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(lexer.yytext);
            lstack.push(lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = lexer.yyleng;
                yytext = lexer.yytext;
                yylineno = lexer.yylineno;
                yyloc = lexer.yylloc;
                if (recovering > 0) {
                    recovering--;
                }
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {
                first_line: lstack[lstack.length - (len || 1)].first_line,
                last_line: lstack[lstack.length - 1].last_line,
                first_column: lstack[lstack.length - (len || 1)].first_column,
                last_column: lstack[lstack.length - 1].last_column
            };
            if (ranges) {
                yyval._$.range = [
                    lstack[lstack.length - (len || 1)].range[0],
                    lstack[lstack.length - 1].range[1]
                ];
            }
            r = this.performAction.apply(yyval, [
                yytext,
                yyleng,
                yylineno,
                sharedState.yy,
                action[1],
                vstack,
                lstack
            ].concat(args));
            if (typeof r !== 'undefined') {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}};
/* generated by jison-lex 0.3.4 */
var lexer = (function(){
var lexer = ({

EOF:1,

parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },

// resets the lexer, sets new input
setInput:function (input, yy) {
        this.yy = yy || this.yy || {};
        this._input = input;
        this._more = this._backtrack = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {
            first_line: 1,
            first_column: 0,
            last_line: 1,
            last_column: 0
        };
        if (this.options.ranges) {
            this.yylloc.range = [0,0];
        }
        this.offset = 0;
        return this;
    },

// consumes and returns one char from the input
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) {
            this.yylloc.range[1]++;
        }

        this._input = this._input.slice(1);
        return ch;
    },

// unshifts one char (or a string) into the input
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length - len);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length - 1);
        this.matched = this.matched.substr(0, this.matched.length - 1);

        if (lines.length - 1) {
            this.yylineno -= lines.length - 1;
        }
        var r = this.yylloc.range;

        this.yylloc = {
            first_line: this.yylloc.first_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.first_column,
            last_column: lines ?
                (lines.length === oldLines.length ? this.yylloc.first_column : 0)
                 + oldLines[oldLines.length - lines.length].length - lines[0].length :
              this.yylloc.first_column - len
        };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        this.yyleng = this.yytext.length;
        return this;
    },

// When called from action, caches matched text and appends it on next action
more:function () {
        this._more = true;
        return this;
    },

// When called from action, signals the lexer that this rule fails to match the input, so the next matching rule (regex) should be tested instead.
reject:function () {
        if (this.options.backtrack_lexer) {
            this._backtrack = true;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });

        }
        return this;
    },

// retain first n characters of the match
less:function (n) {
        this.unput(this.match.slice(n));
    },

// displays already matched input, i.e. for error messages
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },

// displays upcoming input, i.e. for error messages
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20) + (next.length > 20 ? '...' : '')).replace(/\n/g, "");
    },

// displays the character position where the lexing error occurred, i.e. for error messages
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c + "^";
    },

// test the lexed token: return FALSE when not a match, otherwise return token
test_match:function (match, indexed_rule) {
        var token,
            lines,
            backup;

        if (this.options.backtrack_lexer) {
            // save context
            backup = {
                yylineno: this.yylineno,
                yylloc: {
                    first_line: this.yylloc.first_line,
                    last_line: this.last_line,
                    first_column: this.yylloc.first_column,
                    last_column: this.yylloc.last_column
                },
                yytext: this.yytext,
                match: this.match,
                matches: this.matches,
                matched: this.matched,
                yyleng: this.yyleng,
                offset: this.offset,
                _more: this._more,
                _input: this._input,
                yy: this.yy,
                conditionStack: this.conditionStack.slice(0),
                done: this.done
            };
            if (this.options.ranges) {
                backup.yylloc.range = this.yylloc.range.slice(0);
            }
        }

        lines = match[0].match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno += lines.length;
        }
        this.yylloc = {
            first_line: this.yylloc.last_line,
            last_line: this.yylineno + 1,
            first_column: this.yylloc.last_column,
            last_column: lines ?
                         lines[lines.length - 1].length - lines[lines.length - 1].match(/\r?\n?/)[0].length :
                         this.yylloc.last_column + match[0].length
        };
        this.yytext += match[0];
        this.match += match[0];
        this.matches = match;
        this.yyleng = this.yytext.length;
        if (this.options.ranges) {
            this.yylloc.range = [this.offset, this.offset += this.yyleng];
        }
        this._more = false;
        this._backtrack = false;
        this._input = this._input.slice(match[0].length);
        this.matched += match[0];
        token = this.performAction.call(this, this.yy, this, indexed_rule, this.conditionStack[this.conditionStack.length - 1]);
        if (this.done && this._input) {
            this.done = false;
        }
        if (token) {
            return token;
        } else if (this._backtrack) {
            // recover context
            for (var k in backup) {
                this[k] = backup[k];
            }
            return false; // rule action called reject() implying the next rule should be tested instead.
        }
        return false;
    },

// return next match in input
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) {
            this.done = true;
        }

        var token,
            match,
            tempMatch,
            index;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i = 0; i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (this.options.backtrack_lexer) {
                    token = this.test_match(tempMatch, rules[i]);
                    if (token !== false) {
                        return token;
                    } else if (this._backtrack) {
                        match = false;
                        continue; // rule action called reject() implying a rule MISmatch.
                    } else {
                        // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
                        return false;
                    }
                } else if (!this.options.flex) {
                    break;
                }
            }
        }
        if (match) {
            token = this.test_match(match, rules[index]);
            if (token !== false) {
                return token;
            }
            // else: this is a lexer rule which consumes input without producing a token (e.g. whitespace)
            return false;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line ' + (this.yylineno + 1) + '. Unrecognized text.\n' + this.showPosition(), {
                text: "",
                token: null,
                line: this.yylineno
            });
        }
    },

// return next match that has a token
lex:function lex() {
        var r = this.next();
        if (r) {
            return r;
        } else {
            return this.lex();
        }
    },

// activates a new lexer condition state (pushes the new lexer condition state onto the condition stack)
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },

// pop the previously active lexer condition state off the condition stack
popState:function popState() {
        var n = this.conditionStack.length - 1;
        if (n > 0) {
            return this.conditionStack.pop();
        } else {
            return this.conditionStack[0];
        }
    },

// produce the lexer rule set which is active for the currently active lexer condition state
_currentRules:function _currentRules() {
        if (this.conditionStack.length && this.conditionStack[this.conditionStack.length - 1]) {
            return this.conditions[this.conditionStack[this.conditionStack.length - 1]].rules;
        } else {
            return this.conditions["INITIAL"].rules;
        }
    },

// return the currently active lexer condition state; when an index argument is provided it produces the N-th previous condition state, if available
topState:function topState(n) {
        n = this.conditionStack.length - 1 - Math.abs(n || 0);
        if (n >= 0) {
            return this.conditionStack[n];
        } else {
            return "INITIAL";
        }
    },

// alias for begin(condition)
pushState:function pushState(condition) {
        this.begin(condition);
    },

// return the number of states currently on the stack
stateStackSize:function stateStackSize() {
        return this.conditionStack.length;
    },
options: {},
performAction: function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {
var YYSTATE=YY_START;
switch($avoiding_name_collisions) {
case 0:/* ignore comment */
break;
case 1:/* ignore multiline comment */
break;
case 2:/* skip whitespace */
break;
case 3:return 107
break;
case 4:return 108
break;
case 5:return 101
break;
case 6:return 102
break;
case 7:return 103
break;
case 8:return 104
break;
case 9:return 105
break;
case 10:return 67
break;
case 11:return 93
break;
case 12:return 92
break;
case 13:return 94
break;
case 14:return 91
break;
case 15:return 109
break;
case 16:return 100
break;
case 17:return 96
break;
case 18:return 95
break;
case 19:return 106
break;
case 20:return 100
break;
case 21:return 24
break;
case 22:return 26
break;
case 23:return 72
break;
case 24:return 73
break;
case 25:return 11
break;
case 26:return 96
break;
case 27:return 95
break;
case 28:return 106
break;
case 29:return 57
break;
case 30:return 54
break;
case 31:return 98
break;
case 32:return 97
break;
case 33:return 15
break;
case 34:return 13
break;
case 35:return 99
break;
case 36:return 60
break;
case 37:return 10
break;
case 38:return 24
break;
case 39:return 26
break;
case 40:return 21
break;
case 41:return 23
break;
case 42:return 72
break;
case 43:return 73
break;
case 44:return 27
break;
case 45:return 11
break;
case 46:return 88
break;
case 47:return 90
break;
case 48:return 38
break;
case 49:return 52
break;
case 50:return 55
break;
case 51:return 58
break;
case 52:return 75
break;
case 53:return 76
break;
case 54:return 77
break;
case 55:return 78
break;
case 56:return 79
break;
case 57:return 41
break;
case 58:return 12
break;
case 59:return 16
break;
case 60:return 17
break;
case 61:return 18
break;
case 62:return 43
break;
case 63:return 50
break;
case 64:return 46
break;
case 65:return 49
break;
case 66:return 64
break;
case 67:return 84
break;
case 68:return 84
break;
case 69:return 81
break;
case 70:return 82
break;
case 71:return 83
break;
case 72:return 85
break;
case 73:return 86
break;
case 74:return 86
break;
case 75:return 110
break;
case 76:return 5
break;
case 77:return 'INVALID'
break;
}
},
rules: [/^(?:\/\/.*)/,/^(?:\/\*(.|\n|\r)*?\*\/)/,/^(?:\s+)/,/^(?:\+\+)/,/^(?:--)/,/^(?:\+=)/,/^(?:-=)/,/^(?:\*=)/,/^(?:\/=)/,/^(?:%=)/,/^(?:\*)/,/^(?:\/)/,/^(?:-)/,/^(?:%)/,/^(?:\+)/,/^(?:&)/,/^(?:!=)/,/^(?:or\b)/,/^(?:and\b)/,/^(?:not\b)/,/^(?:not_eq\b)/,/^(?:<%)/,/^(?:%>)/,/^(?:<:)/,/^(?::>)/,/^(?:%:)/,/^(?:\|\|)/,/^(?:&&)/,/^(?:!)/,/^(?:<<)/,/^(?:>>)/,/^(?:>=)/,/^(?:<=)/,/^(?:>)/,/^(?:<)/,/^(?:==)/,/^(?:=)/,/^(?:;)/,/^(?:{)/,/^(?:})/,/^(?:\()/,/^(?:\))/,/^(?:\[)/,/^(?:])/,/^(?:,)/,/^(?:#)/,/^(?:new\b)/,/^(?:delete\b)/,/^(?:return\b)/,/^(?:cin\b)/,/^(?:cout\b)/,/^(?:endl\b)/,/^(?:int\b)/,/^(?:double\b)/,/^(?:char\b)/,/^(?:bool\b)/,/^(?:string\b)/,/^(?:void\b)/,/^(?:include\b)/,/^(?:using\b)/,/^(?:namespace\b)/,/^(?:std\b)/,/^(?:if\b)/,/^(?:else\b)/,/^(?:while\b)/,/^(?:for\b)/,/^(?:const\b)/,/^(?:true\b)/,/^(?:false\b)/,/^(?:[0-9]*(\.[0-9]+)\b)/,/^(?:([1-9][0-9]*|0))/,/^(?:'([^\\']|\\.)')/,/^(?:"([^\\"]|\\.)*")/,/^(?:nullptr\b)/,/^(?:NULL\b)/,/^(?:([a-z]|[A-Z]|_)([a-z]|[A-Z]|_|[0-9])*)/,/^(?:$)/,/^(?:.)/],
conditions: {"INITIAL":{"rules":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77],"inclusive":true}}
});
return lexer;
})();
parser.lexer = lexer;
function Parser () {
  this.yy = {};
}
Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();


if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = parser;
exports.Parser = parser.Parser;
exports.parse = function () { return parser.parse.apply(parser, arguments); };
exports.main = function commonjsMain(args) {
    if (!args[1]) {
        console.log('Usage: '+args[0]+' FILE');
        process.exit(1);
    }
    var source = require('fs').readFileSync(require('path').normalize(args[1]), "utf8");
    return exports.parser.parse(source);
};
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(process.argv.slice(1));
}
}
}).call(this,require('_process'))
},{"_process":33,"fs":7,"path":32}],80:[function(require,module,exports){
var IO, Program, utils;

IO = require('../runtime/io').IO;

utils = require('../utils');

module.exports = this;

this.Program = Program = (function() {
  var tagInstructionsVariables;

  Program.ENTRY_FUNCTION = ".text";

  Program.MAIN_FUNCTION = "main";

  tagInstructionsVariables = function(functions) {
    var closeScope, defineVariable, getVisibleVariables, openScope, scope, scopes, tagInstructions;
    scopes = [{}];
    scope = scopes[0];
    defineVariable = function(defIns) {
      var variable;
      variable = defIns.children[0];
      return scope[variable.id] = variable;
    };
    openScope = function() {
      scope = {};
      return scopes.push(scope);
    };
    closeScope = function() {
      scopes.pop();
      return scope = scopes[scopes.length - 1];
    };
    getVisibleVariables = function() {
      var id, j, len, variable, visibleVariables;
      visibleVariables = {};
      for (j = 0, len = scopes.length; j < len; j++) {
        scope = scopes[j];
        for (id in scope) {
          variable = scope[id];
          visibleVariables[id] = variable;
        }
      }
      return visibleVariables;
    };
    tagInstructions = function(funcId) {
      var i, instruction, j, len, ref, results;
      ref = functions[funcId].instructions;
      results = [];
      for (i = j = 0, len = ref.length; j < len; i = ++j) {
        instruction = ref[i];
        switch (false) {
          case !instruction.variableDeclaration:
            results.push(defineVariable(instruction));
            break;
          case !instruction.functionDefinition:
            results.push(tagInstructions(instruction.children[0]));
            break;
          case !instruction.openScope:
            results.push(openScope());
            break;
          case !instruction.closeScope:
            results.push(closeScope());
            break;
          default:
            results.push(functions[funcId].instructions[i].visibleVariables = getVisibleVariables());
        }
      }
      return results;
    };
    return tagInstructions(Program.ENTRY_FUNCTION);
  };

  function Program(variables, functions1, globalsSize) {
    var func, funcId, instruction, ref;
    this.variables = variables;
    this.functions = functions1;
    this.globalsSize = globalsSize;
    this.outputListeners = [];
    tagInstructionsVariables(this.functions);
    ref = this.functions;
    for (funcId in ref) {
      func = ref[funcId];
      func.instructions = (function() {
        var j, len, ref1, results;
        ref1 = func.instructions;
        results = [];
        for (j = 0, len = ref1.length; j < len; j++) {
          instruction = ref1[j];
          if (!instruction.isDebugInfo) {
            results.push(instruction);
          }
        }
        return results;
      })();
    }
  }

  Program.prototype.instructionsToString = function() {
    var func, funcId, instruction, j, len, ref, ref1, s;
    s = "";
    ref = this.functions;
    for (funcId in ref) {
      func = ref[funcId];
      s += funcId + ":" + "\n";
      ref1 = func.instructions;
      for (j = 0, len = ref1.length; j < len; j++) {
        instruction = ref1[j];
        s += instruction.toString().split("\n").map(function(x) {
          return "    " + x;
        }).join("\n") + "\n";
      }
    }
    return s;
  };

  Program.prototype.writeInstructions = function() {
    var func, funcId, instruction, ref, results;
    ref = this.functions;
    results = [];
    for (funcId in ref) {
      func = ref[funcId];
      console.log(funcId + ":");
      results.push((function() {
        var j, len, ref1, results1;
        ref1 = func.instructions;
        results1 = [];
        for (j = 0, len = ref1.length; j < len; j++) {
          instruction = ref1[j];
          results1.push(console.log(instruction.toString().split("\n").map(function(x) {
            return "    " + x;
          }).join("\n")));
        }
        return results1;
      })());
    }
    return results;
  };

  Program.prototype.attachMemory = function(memory) {
    this.memory = memory;
  };

  Program.prototype.attachOutputListener = function(fn, stream) {
    if (stream == null) {
      stream = IO.INTERLEAVED;
    }
    return this.outputListeners.push({
      fn: fn,
      stream: stream
    });
  };

  return Program;

})();


},{"../runtime/io":94,"../utils":96}],81:[function(require,module,exports){
0;
var CompilationState, Memory, MemoryReference, alignTo, compilationError, utils,
  slice = [].slice;

utils = require('../../utils');

compilationError = require('../../messages').compilationError;

MemoryReference = require('../../ast/memory-reference').MemoryReference;

alignTo = require('../../utils').alignTo;

Memory = require('../../runtime/memory').Memory;

module.exports = this;

this.CompilationState = CompilationState = (function() {
  function CompilationState() {
    this.variables = {};
    this.functions = {};
    this.addressOffset = 0;
    this.temporaryAddressOffset = 0;
    this.scopes = [{}];
    this.scope = this.scopes[0];
    this.insideFunctionArgumentDefinitions = false;
    this.insideFunctionReturnDefinition = false;
    this.warnings = [];
  }

  CompilationState.prototype.openScope = function() {
    this.scope = {};
    return this.scopes.push(this.scope);
  };

  CompilationState.prototype.closeScope = function() {
    this.scopes.pop();
    return this.scope = this.scopes[this.scopes.length - 1];
  };

  CompilationState.prototype.newFunction = function(func, ast) {
    0;
    0;
    this.maxTmpSize = 0;
    this.defineVariable(func, ast);
    this.addressOffsetCopy = this.addressOffset;
    this.addressOffset = 0;
    this.functionId = func.id;
    this.functions[this.functionId] = func;
    return this.openScope();
  };

  CompilationState.prototype.endFunction = function() {
    0;
    0;
    var stackSize;
    stackSize = alignTo(this.addressOffset, 16);
    if (stackSize > Memory.SIZES.stack) {
      compilationError('MAX_STACK_SIZE_EXCEEDED', null, 'id', this.functionId, 'size', stackSize, 'limit', Memory.SIZES.stack);
    }
    this.functions[this.functionId].stackSize = alignTo(this.addressOffset, 16);
    this.functions[this.functionId].maxTmpSize = this.maxTmpSize;
    this.addressOffset = this.addressOffsetCopy;
    delete this.functionId;
    return this.closeScope();
  };

  CompilationState.prototype.defineVariable = function(variable, ast) {
    var desiredAddressOffset, func, id, requiredAlignment;
    id = variable.id;
    variable.isFunctionArgument = this.insideFunctionArgumentDefinitions;
    if (variable.isFunctionArgument) {
      func = this.getFunction();
      0;
      func.type.argTypes.push(variable.type);
    }
    if (this.scope[id] != null) {
      ast.compilationError('VARIABLE_REDEFINITION', "name", id);
    } else {
      this.variables[id] = {};
    }
    if (variable.type.isReferenceable) {
      requiredAlignment = variable.type.requiredAlignment();
      desiredAddressOffset = alignTo(this.addressOffset, requiredAlignment);
      variable.memoryReference = MemoryReference.from(variable.type, desiredAddressOffset, this.scopes.length > 1 ? 1 : 0);
      this.addressOffset = desiredAddressOffset + variable.type.bytes;
    }
    return this.scope[id] = variable;
  };

  CompilationState.prototype.getVariable = function(id) {
    var scopeLevel;
    scopeLevel = this.scopes.length;
    while (--scopeLevel >= 0) {
      if (this.scopes[scopeLevel][id] != null) {
        return this.scopes[scopeLevel][id];
      }
    }
    return null;
  };

  CompilationState.prototype.getFunction = function(id) {
    if (id == null) {
      id = this.functionId;
    }
    return this.functions[id];
  };

  CompilationState.prototype.getTemporary = function(type) {
    var desiredAddressOffset, previousOffset, ret;
    desiredAddressOffset = alignTo(this.temporaryAddressOffset, type.requiredAlignment());
    previousOffset = this.temporaryAddressOffset;
    this.temporaryAddressOffset = desiredAddressOffset + type.bytes;
    this.maxTmpSize = Math.max(this.temporaryAddressOffset, this.maxTmpSize);
    if (this.temporaryAddressOffset > Memory.SIZES.tmp) {
      compilationError('TEMPORARY_ADDRESS_LIMIT');
    }
    ret = MemoryReference.from(type, desiredAddressOffset, MemoryReference.TMP, this.temporaryAddressOffset - previousOffset);
    return ret;
  };

  CompilationState.prototype.releaseTemporaries = function() {
    var i, reference, references, results;
    references = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    i = 0;
    results = [];
    while (i < references.length) {
      reference = references[i++];
      if (typeof reference.containsTemporaries === "function" ? reference.containsTemporaries() : void 0) {
        references = references.concat(reference.getTemporaries());
      }
      if (reference.isTemporary && !reference.alreadyReleased) {
        reference.alreadyReleased = true;
        this.temporaryAddressOffset -= reference.getOccupation();
        results.push(0);
      } else {
        results.push(void 0);
      }
    }
    return results;
  };

  CompilationState.prototype.iAmInsideFunctionArgumentDefinitions = function() {
    return this.insideFunctionArgumentDefinitions;
  };

  CompilationState.prototype.beginFunctionArgumentDefinitions = function() {
    return this.insideFunctionArgumentDefinitions = true;
  };

  CompilationState.prototype.endFunctionArgumentDefinitions = function() {
    return this.insideFunctionArgumentDefinitions = false;
  };

  CompilationState.prototype.iAmInsideFunctionReturnDefinition = function() {
    return this.insideFunctionReturnDefinition;
  };

  CompilationState.prototype.beginFunctionReturnDefinition = function() {
    return this.insideFunctionReturnDefinition = true;
  };

  CompilationState.prototype.endFunctionReturnDefinition = function() {
    return this.insideFunctionReturnDefinition = false;
  };

  CompilationState.prototype.warn = function(warning) {
    return warnings.push(warning);
  };

  return CompilationState;

})();


},{"../../ast/memory-reference":67,"../../messages":90,"../../runtime/memory":95,"../../utils":96}],82:[function(require,module,exports){
var PRIMITIVE_TYPES, Variable,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Variable = require('./variable').Variable;

PRIMITIVE_TYPES = require('../../ast/type').PRIMITIVE_TYPES;

module.exports = this;

this.FunctionVar = (function(superClass) {
  extend(_Class, superClass);

  function _Class(id, type, arg) {
    var specifiers;
    specifiers = (arg != null ? arg : {}).specifiers;
    _Class.__super__.constructor.call(this, id, type, {
      specifiers: specifiers
    });
    this.stackSize = 0;
  }

  return _Class;

})(Variable);


},{"../../ast/type":72,"./variable":84}],83:[function(require,module,exports){
0;
module.exports = this;

this.compile = function(root) {
  0;
  return root.compile();
};


},{}],84:[function(require,module,exports){
var Variable;

module.exports = this;

this.Variable = Variable = (function() {
  function Variable(id, type, arg) {
    var base, ref, ref1, ref2, ref3;
    this.id = id;
    this.type = type;
    ref = arg != null ? arg : {}, this.specifiers = (ref1 = ref.specifiers) != null ? ref1 : {}, this.isTmp = (ref2 = ref.isTmp) != null ? ref2 : false, this.isFunctionArgument = (ref3 = ref.isFunctionArgument) != null ? ref3 : false;
    if ((base = this.specifiers)["const"] == null) {
      base["const"] = false;
    }
  }

  return Variable;

})();


},{}],85:[function(require,module,exports){
0;
var Debugger, differLine, findLineInstruction, run,
  slice = [].slice;

run = require('../runtime').run;

module.exports = this;

findLineInstruction = function(program, line) {
  var func, funcId, i, instruction, len, ref, ref1, ref2, ref3;
  ref = program.functions;
  for (funcId in ref) {
    func = ref[funcId];
    ref1 = func.instructions;
    for (i = 0, len = ref1.length; i < len; i++) {
      instruction = ref1[i];
      if ((((ref2 = instruction.locations) != null ? ref2.lines.first : void 0) <= line && line <= ((ref3 = instruction.locations) != null ? ref3.lines.last : void 0))) {
        return instruction;
      }
    }
  }
  return null;
};

differLine = function(line, other) {
  return (line != null) && (other != null) && line !== other;
};

this.Debugger = Debugger = (function() {
  function Debugger() {
    this.breakpointsToAdd = {};
  }

  Debugger.prototype.debug = function(program1) {
    this.program = program1;
    0;
    this.started = true;
    this.addBreakpoints.apply(this, Object.keys(this.breakpointsToAdd));
    this.iterator = run(this.program);
    return this["continue"](null, true);
  };

  Debugger.prototype["continue"] = function*(condition, initial) {
    if (condition == null) {
      condition = (function() {
        return false;
      });
    }
    if (initial == null) {
      initial = false;
    }
    0;
    this.vm = this.iterator.next().value;
    if (initial) {
      yield this.vm;
    }
    while (!(this.vm.finished || this.vm.instruction.breakpoint || condition(this.vm))) {
      if (this.vm.isWaitingForInput()) {
        yield this.vm;
      }
      this.vm = this.iterator.next().value;
    }
    return (yield this.vm);
  };

  Debugger.prototype.stepOver = function*() {
    0;
    var currentLine, currentStackLevel, ref;
    currentLine = (ref = this.vm.instruction.locations) != null ? ref.lines.first : void 0;
    currentStackLevel = this.vm.controlStack.length;
    return (yield* this["continue"](function(vm) {
      var ref1;
      return differLine(currentLine, (ref1 = vm.instruction.locations) != null ? ref1.lines.first : void 0) && vm.controlStack.length <= currentStackLevel;
    }));
  };

  Debugger.prototype.stepInto = function*() {
    0;
    var currentLine, ref;
    currentLine = (ref = this.vm.instruction.locations) != null ? ref.lines.first : void 0;
    return (yield* this["continue"](function(vm) {
      var ref1;
      return differLine((ref1 = vm.instruction.locations) != null ? ref1.lines.first : void 0, currentLine);
    }));
  };

  Debugger.prototype.stepOut = function*() {
    0;
    var currentStackLevel;
    currentStackLevel = this.vm.controlStack.length;
    return (yield* this["continue"](function(vm) {
      return vm.controlStack.length < currentStackLevel && vm.controlStack.length > 0 && (vm.instruction.locations != null);
    }));
  };

  Debugger.prototype.stepInstruction = function*() {
    0;
    return (yield* this["continue"](function() {
      return true;
    }));
  };

  Debugger.prototype.addBreakpoints = function() {
    var i, instruction, j, len, len1, line, lines, results;
    lines = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (this.program) {
      for (i = 0, len = lines.length; i < len; i++) {
        line = lines[i];
        instruction = findLineInstruction(this.program, line);
        if (instruction != null) {
          instruction.breakpoint = true;
        }
      }
    }
    results = [];
    for (j = 0, len1 = lines.length; j < len1; j++) {
      line = lines[j];
      results.push(this.breakpointsToAdd[line] = true);
    }
    return results;
  };

  Debugger.prototype.removeBreakpoints = function() {
    var i, instruction, j, len, len1, line, lines, results;
    lines = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    if (this.program) {
      for (i = 0, len = lines.length; i < len; i++) {
        line = lines[i];
        instruction = findLineInstruction(this.program, line);
        if (instruction != null) {
          delete instruction.breakpoint;
        }
      }
    }
    results = [];
    for (j = 0, len1 = lines.length; j < len1; j++) {
      line = lines[j];
      results.push(delete this.breakpointsToAdd[line]);
    }
    return results;
  };

  return Debugger;

})();


},{"../runtime":92}],86:[function(require,module,exports){
var Debugger, Memory, compile, ref, run, runSync;

compile = require('./compiler').compile;

ref = require('./runtime'), run = ref.run, runSync = ref.runSync;

Memory = require('./runtime/memory').Memory;

Debugger = require('./debugger').Debugger;

module.exports = this;

this.compile = compile;

this.run = run;

this.runSync = runSync;

this.Memory = Memory;

this.Debugger = Debugger;


},{"./compiler":76,"./debugger":85,"./runtime":92,"./runtime/memory":95}],87:[function(require,module,exports){
0;
var Message, c, code, description, errorType, map, message, name, ref, ref1;

Message = require('./message').Message;

this.parsing = {
  PARSING_ERROR: {
    code: 1001,
    message: "Parsing error:\n<<<error>>>"
  }
};

this.declaration = {
  VARIABLE_REDEFINITION: {
    code: 2001,
    message: "Cannot define variable or function<<name>>: already defined in this scope",
    description: "This error occurs when two variables are declared with the same exact name within the same scope.\n\nIt could be caused by a clash between two function names, for instance:\n\n```\n    int myFunction() { // First definition\n    }\n\n    ...\n\n    double myFunction() { // Error! myFunction name is already used in the first definition\n    }\n```\n\nOr a function and a global variable:\n\n```\n    int x; // First global variable definition\n\n    ...\n\n    double x() { // Error! x name is already used in the first global variable definition\n    }\n```\n\nOr by two local variables:\n\n```\n    int main() {\n\n        int p; // First definition of p as int\n\n        if (true) {\n            double p; // This compiles, although not recommended, the scope is different because\n                      // every { } pair opens a new scope so further uses of p within this scope\n                      // all refer to this 'double p' instead of 'int p'\n        }\n\n        char p; // Error! p is already defined in this scope as an int\n    }\n```\n\nRemember that scopes are delimited by the '{' and '}' symbols."
  },
  VOID_FUNCTION_ARGUMENT: {
    code: 2002,
    message: "Cannot define a function argument with 'void' type: function<<function>>, argument<<argument>>",
    description: "Function arguments should not have type 'void'.\n\nExample:\n\n```\n    void f(void x) { // Wrong! return type can be void but argument x cannot be declared as void\n\n    }\n\n    void fCorrect() { // If you want to declare a function with no arguments it should be declared like this\n\n    }\n\n    void fCorrect2(void) { // Or like this, which is equivalent to the declaration of 'fCorrect'\n\n    }\n```"
  },
  ARRAY_OF_FUNCTIONS: {
    code: 2003,
    message: "Declaration of<<id>> as array of functions",
    description: "This error occurs when trying to declare a function with an array return type. Functions\ncannot return arrays, pointers should be used instead as the return type. Also, arrays of functions\nare not allowed either, so this alternative interpretation is not correct either.\n\nExample:\n\n```\n    int f[2]() { // f[2] is not allowed here, f is a function and cannot return an array int[2] f() {} would also be incorrect\n\n    }\n```"
  },
  NO_RETURN_TYPE: {
    code: 2004,
    message: "Function declared with no return type",
    description: "This error occurs when no type has been specified in the return section of a function declaration.\n\nExample:\n\n```\n    const f() { // Wrong! const is not a type and no return type has been specified for f\n    }\n```"
  },
  VOID_DECLARATION: {
    code: 2005,
    message: "Variable or field<<name>> declared void",
    description: "This error occurs when declaring a variable or field with void type.\n\nExample:\n\n```\n    int main() {\n        void x; // Wrong! a variable cannot have type void\n    }\n```"
  },
  INVALID_ARRAY_DECLARATION_TYPE: {
    code: 2006,
    message: "Cannot declare<<name>> as array of<<type>>",
    description: "This error occurs when declaring arrays of an invalid type such as void.\n\nExample:\n\n```\n    int main() {\n        void arr[20]; // Error! Cannot declare an array of void values\n    }\n```"
  },
  DUPLICATE_SPECIFIER: {
    code: 2007,
    message: "Duplicate specifier<<specifier>> for declaration",
    description: "This error occurs when a variable, member or function declaration has more than one specifier,\nsuch as a const or a type specifier;\n\nExample:\n\n```\n    const int const x; // Wrong! duplicate const specifier\n    int double y; // Wrong! duplicate type specifier\n```"
  },
  NO_TYPE_SPECIFIER: {
    code: 2008,
    message: "No type specifier for declaration",
    description: "This error occurs when a variable or member declaration has no type specifier.\n\nExample:\n\n```\n    int main() {\n        const x = 2; // Error! no type specifier for declaration of 'x'\n    }\n```"
  },
  ALL_BOUNDS_EXCEPT_FIRST: {
    code: 2009,
    message: "Multidimensional array<<id>> must have bounds for all dimensions except the first",
    description: "This error occurs when declaring an array variable or function parameter without specifying the size of\nthe dimensions. All but the first dimension must be specified in a function parameter declaration, and all\nthe dimensions must be specified in a variable or member declaration.\n\nExample:\n\n```\n    int f(int arr[20][]) { // Wrong! second dimension of parameter arr is not specified\n    }\n\n    int main() {\n    }\n\n```"
  },
  STORAGE_UNKNOWN: {
    code: 2010,
    message: "Storage size of<<id>> isn't known",
    description: "This error occurs when declaring array variables or members and not specifying one or more of its dimensions.\n\nExample:\n\n```\n    int arr[][20]; // Error! first dimension not specified for declaration of 'arr'\n\n```"
  },
  POINTER_UNBOUND_SIZE: {
    code: 2011,
    message: "Parameter<<id>> includes pointer to array of unknown bound<<type>>",
    description: "This error occurs when defining a function parameter as a pointer to an array which has one of its dimensions\nas unspecified.\n\nExample:\n\n```\n    int f(char (*arr)[]) { // Error! parameter arr is declared as a pointer to an array with unknown size (first dimension unknown)\n    }\n\n```"
  },
  ARRAY_SIZE_NEGATIVE: {
    code: 2012,
    message: "Size of array<<id>> is negative",
    description: "This error occurs when declaring an array and specifying one of its dimensions with negative size.\n\nExample:\n\n```\n    int arr[-2]; // Wrong! First dimension of arr is negative\n```"
  },
  STATIC_SIZE_ARRAY: {
    code: 2013,
    message: "Invalid array dimension value for array<<id>>, only literals are supported as array dimensions",
    description: "This error occurs when declaring an array and specifying one of its dimensions with something other than\nan integral literal. Even const integer variables or static expressions are not supported in the current\nversion of the compiler, but will be supported in the future.\n\nExample:\n\n```\n    const int X = 2;\n\n    int arr[X]; // Error! X is not a literal but a variable\n\n    int arr2[10]; // Correct, size is literal\n```"
  },
  NONINTEGRAL_DIMENSION: {
    code: 2014,
    message: "Size of array<<id>> has non-integral type<<type>>",
    description: "This error occurs when an array is declared with a dimension value having a non-integral type, such as double.\n\nExample:\n\n```\n    int arr[2.5]; // Error! Size is not integral\n\n```"
  },
  STRING_ARRAY: {
    code: 2015,
    message: "String arrays are not supported",
    description: "This error occurs when declaring an array of strings, which is not supported yet.\n\nExample:\n\n```\n    string arr[20]; // Error! declaring an array 'arr' of strings\n```"
  },
  STRING_ARGUMENT: {
    code: 2016,
    message: "String function arguments are not supported",
    description: "This error occurs when declaring a function argument with string type. This feature is not supported yet.\n\nExample:\n```\n    int f(string s) { // Error! s declared as a string argument\n        ...\n    }\n```"
  },
  STRING_POINTER: {
    code: 2017,
    message: "String pointers are not supported",
    description: "This error occurs when declaring a pointer to type string. Currently pointer to string declarations\nare not supported.\n\nExample:\n\n```\nstring * x; // Error! Declaring pointer to string\n\n```"
  }
};

this.variableUse = {
  REF_VARIABLE_NOT_DEFINED: {
    code: 3001,
    message: "Cannot reference variable<<name>>: not defined in this scope",
    description: "This error occurs when trying to read or write on a variable which has not been declared in the same\nscope of use or any parent scope.\n\n\nExample:\n\n```\n    int main() {\n        if (true) {\n            int x;\n\n            ... // do something with x\n        }\n\n\n        x = 3; // Error! x has not been declared in this scope or the parent scope, its\n               // declaration is within a children scope created by the if statement,\n               // and thus it is not visible here\n    }\n```"
  }
};

this.functionCalling = {
  CALL_FUNCTION_NOT_DEFINED: {
    code: 4001,
    message: "Cannot call function<<name>>, has not been declared",
    description: "This error occurs when calling a function which has not been defined before the call.\n\nExample:\n\n```\n    int f() {\n        ...\n        t(); // Wrong! t has not been defined yet, its definition comes after its use\n        ...\n    }\n\n\n    int t() {\n        ...\n    }\n```"
  },
  CALL_NON_FUNCTION: {
    code: 4002,
    message: "Cannot call variable<<name>>, which is not a function",
    description: "This error occurs when trying to call on a variable which is not a function. It could be caused\nby variable shadowing, as you can see in the example.\n\nExample:\n\n```\n    int f() {\n        ...\n    }\n\n    int main() {\n        ...\n        double f = 2; // Redefines f and shadows the function\n\n        f(); // Error! Here f refers to the variable, not the function, and a variable cannot be called.\n    }\n```"
  },
  INVALID_PARAMETER_COUNT_CALL: {
    code: 4003,
    message: "Function<<name>> with<<good>> parameters has been called with wrong number of parameters<<wrong>>",
    description: "This error is caused when calling a function with too few parameters or too much parameters.\n\nExample:\n\nint f0() {\n}\n\nint f2(int a, int b) {\n}\n\nint main() {\n    int x, y;\n\n    f0(x); // Error, f has 0 parameters, called with 1 parameter\n\n    f2(); // Error, f2 has 2 parameters, called with 0 parameters\n\n    f2(x, y); // Correct, f2 has 2 parameters, called with 2 parameters\n}"
  }
};

this.assignment = {
  ASSIGN_OF_NON_ASSIGNABLE: {
    code: 5001,
    message: "Variable<<id>> with type<<type>> is not assignable",
    description: "This error occurs when trying to assign to a variable which has a non-assignable type, such as\na function variable.\n\n\nExample:\n\n```\n    int f() {\n    }\n\n    int f2() {\n    }\n\n    int main() {\n        f = f2; // Error! functions are not assignable\n    }\n```"
  },
  LVALUE_ASSIGN: {
    code: 5002,
    message: "lvalue required as left operand of assignment",
    description: "This error occurs when trying to assign to an expression which is not necessarily stored in memory,\nsuch as a literal or the result of an expression which does not refer to a memory location.\n\nExample:\n\n```\n    int main() {\n        int a;\n\n        int* p;\n\n        2 = 5; // Error, 2 is a literal not a variable\n\n        a + 2 += 3; // Error, a + 2 is not a variable, it's the result of an arithmetic expression which does not refer to a memory location. Note that += is also a type of assignment\n\n        *(p + 2) = 5; // Correct, in this case p + 2 is a pointer, and its dereference (*) refers to a memory location\n\n        ++a = 3; // Also correct, although highly discouraged. In this case the expression is equivalent to a = 3\n    }\n```"
  },
  ASSIGN_TO_ARRAY: {
    code: 5003,
    message: "Invalid array assignment",
    description: "This error occurs when trying to assign something to an array instead of one of its elements.\n\nExample:\n\n```\n    int arr[20][30];\n\n    int arr2[20][30];\n\n    int main() {\n        arr = arr2; // Error! Even if both arrays have the same type and sizes, array assignment is not allowed\n\n        arr[0] = arr2[0]; // Error! Same as above, arr[0] returns an a int[30] array, which is again not assignable\n\n        arr[0][0] = arr2[0][1]; // Correct, arr[0][0] is a specific memory location, not an array\n    }\n```"
  },
  CONST_MODIFICATION: {
    code: 5004,
    message: "Modification of read-only variable<<name>>",
    description: "This error occurs when trying to assign on to a variable which has been declared const.\n\nExample:\n\n```\n    const int SIZE = 2;\n\n    int main() {\n        SIZE = 3; // Error! SIZE is declared const, cannot be modified\n    }\n```"
  }
};

this.arrays = {
  INVALID_ARRAY_SUBSCRIPT: {
    code: 6001,
    message: "Invalid types '<<<type>>>[<<<typeSubscript>>>]' for array subscript",
    description: "This error occurs when trying to use an array subscript on something which is not an array or pointer,\nor using a subscript value which is not a integral value (char, bool or int).\n\nExample:\n\n```\n    int main() {\n        int arr[20];\n        int x;\n\n        x[0] = 2; // Error! x is not an array so it cannot be subscripted on 0\n\n        x = arr[2.6]; // Error! 2.6 is not an integral value so it cannot be used as a subcript value\n    }\n\n```"
  }
};

this.cin = {
  LVALUE_CIN: {
    code: 7001,
    message: "lvalue required as operand of cin",
    description: "This error occurs when trying to cin on an expression which does not represent a memory location,\nsuch as a literal or a conventional arithmetic expression.\n\nExample:\n\n```\n    #include <iostream>\n    using namespace std;\n\n    int main() {\n        int a;\n\n        cin >> (a + 2); // Error! a + 2 is not necessarily stored in a memory location\n\n        cin >> 2; // Error! 2 is a literal, not necessarily in a memory location\n\n        cin >> a; // Correct, a is stored in a memory location\n    }\n```"
  },
  INVALID_CIN_OPERAND: {
    code: 7002,
    message: "Invalid operand of type<<type>> to cin",
    description: "This error occurs when using cin with a variable type that is not adequate for the operation,\nsuch as pointers, arrays or functions.\n\nExample:\n\n```\n    #include <iostream>\n    using namespace std;\n\n    int main() {\n        int* p;\n        int arr[2];\n        int x;\n\n        cin >> p // Error! p is a pointer, cin is not allowed on pointers\n            >> arr // Error! arr is an array, cin does not support arrays\n            >> main // Error! main is a function, cin does not support functions\n            >> arr[0]; // Correct, arr[0] is of type int, which is supported by cin\n    }\n```"
  }
};

this.expressions = {
  INVALID_OPERANDS: {
    code: 8001,
    message: "Invalid operands<<typel>> and<<typer>> to operation",
    description: "This error occurs when trying to apply a binary operation to arguments of incorrect type,\nfor instance adding up two pointers (or arrays), or multiplying a pointer or array by a number. Other kinds of operations\nwhich are not allowed, such as multiplying a string by a number or adding a string to a number\nthrow a different kind of error, because the compiler tries to cast the wrong argument type to the adequate\ntype, failing to do so. In the case of pointers the cast cannot even be tried so this type of error is thrown.\n\nExample:\n```\n    int main() {\n        int* p;\n\n        int arr[2];\n\n        p = p + p; // Incorrect! cannot add up two pointers\n\n        int x = arr*2; // Incorrect! cannot multiply an array by an integer\n\n        int* p2 = p + 1; // Correct, adding a pointer to an integer is allowed\n    }\n```"
  },
  WRONG_ARGUMENT_UNARY_MINUS: {
    code: 8002,
    message: "Wrong type argument<<type>> to unary minus",
    description: "This error occurs when trying to apply the unary minus operation to invalid types\nsuch as pointers or arrays.\n\nExample:\n\n```\n    int main() {\n        int arr[2];\n        int * p;\n\n        -p; // Error! Argument type pointer is not allowed for -\n\n        -arr; // Error! Argument type array is not allowed for -\n\n    }\n```"
  },
  NON_INTEGRAL_MODULO: {
    code: 8003,
    message: "Both operands to modulo operation must be integrals",
    description: "This error occurs when performing a modulo operation with an operand being of non-integral type,\nsuch as double.\n\nExample:\n\n```\n    int main() {\n        int x = 2;\n        double y = 2.0;\n\n        int m  = x%y; // Wrong! Both operands must be of integral type but 'y' isn't\n    }\n\n```"
  },
  INVALID_BOOL_DEC: {
    code: 8004,
    message: "Invalid use of boolean expression as operand to 'operator--'",
    description: "This error occurs when trying to decrement a variable of boolean type.\n\nExample:\n\n```\n    int main() {\n        bool x;\n        --x; // Wrong! Booleans cannot be pre-decremented\n        x--; // Wrong! Booleans cannot be post-decremented\n    }\n\n```"
  },
  LVALUE_ADDRESSING: {
    code: 8005,
    message: "Lvalue required as unary '&' operand",
    description: "This error occurs when trying to use the unary '&' operand (address of) on an operand\nwhich is not necessarily stored in a memory location.\n\nExample:\n\n```\n    int f() {\n        return 5;\n    }\n\n    int main() {\n        int y;\n\n        int* x = & (f()); // Wrong! the return value of f() is not necessarily stored in memory, cannot be addressed\n\n        int* p = & (&y); // Wrong! &y gives a value which is not necessarily stored in memory, because it is a variable address\n    }\n```"
  },
  UNALLOWED_ARITHMETIC_INCOMPLETE_TYPE: {
    code: 8006,
    message: "Cannot perform pointer arithmetic on a pointer to incomplete type<<type>>",
    description: "This error occurs when trying to perform pointer arithmetic on a pointer to incomplete type.\nAn example of an incomplete type is an array whose first dimension size is not bounded.\n\nExample:\n\n```\n    int main() {\n        int (*arr)[];\n\n        ++arr; // Error! arr is a pointer to an array with unknown first dimension\n    }\n```"
  }
};

this.types = {
  VOID_NOT_IGNORED: {
    code: 9001,
    message: "Void value not ignored as it ought to be",
    description: "This error occurs when trying to assign a value with void type, for instance the result of a\nvoid function call or the dereference of a void*\n\nExample:\n\n```\n    void f() {\n    }\n\n    int main() {\n        void* p;\n\n        int a = *p; // Error! *p has void type, cannot be assigned\n\n        int b = f(); // Error! f() has void type, cannot be assigned\n    }\n```"
  },
  INVALID_CAST: {
    code: 9002,
    message: "Cannot cast type<<origin>> to type<<dest>>",
    description: "This error occurs when some operation that you perform requires a type different than\nthe one you specified, thus a casting to the desired type is required for the operation to proceed,\nbut the type that you specified cannot be casted to the specified type.\n\nThis could happen in an arithmetic operation, comparison, assignment, function parameter forwarding,\netc.\n\nExample:\n\n```\n    int f(int x) {\n    }\n\n    int main() {\n        string s;\n        int* p;\n\n        int x = s; // Error! s with type string cannot be casted to type int\n\n        f(p); // Error! f expects an argument of type int but pointer was passed, and pointer cannot be casted to int\n\n        int x = 2 + \"string\"; // Error! binary + expects operands to have same numerical type, but \"string\" with type string cannot be casted to type int\n    }\n\n```"
  },
  ASSIGNABLE_ADDRESSING: {
    code: 9003,
    message: "Assignable type required for unary '&' operand",
    description: "This error occurs when trying to take the address of some expression which doesn't have assignable type,\nsuch as void or function.\n\nExample:\n\n```\n    int main() {\n        int* x = &main; // Wrong! main is a function\n    }\n```"
  },
  INVALID_DEREFERENCE_TYPE: {
    code: 9004,
    message: "invalid type argument of unary '*' (have<<type>>)",
    description: "This error occurs when trying to dereference an expression which is not a pointer or array.\n\nExample:\n\n```\n    int main() {\n        int x;\n\n        int y = *x; // Wrong! x doesn't have pointer or array type\n    }\n```"
  },
  VOID_INVALID_USE: {
    code: 9005,
    message: "Invalid use of 'void'",
    description: "This error occurs when using a void type somewhere it is not expected. This can\nhappen for instance when using the new operator with a void type argument.\n\nExample:\n\n```\n    int main() {\n        void* x = new void; // Wrong! void is not allowed here\n    }\n\n```"
  },
  INVALID_DELETE_TYPE: {
    code: 9006,
    message: "type<<type>> argument given to 'delete', expected pointer or array",
    description: "This error occurs when using delete on an expression which doesn't have a pointer or array type.\n\nExample:\n\n```\n    int main() {\n        int x;\n\n        delete x; // Error! x has int type, which is not a pointer type\n    }\n```"
  },
  STRING_ADDRESSING: {
    code: 9007,
    message: "String addressing is not supported",
    description: "This error occurs when using the unary & operator on strings or using new on a string type.\n\nExample:\n\n```\n    int main() {\n        string s;\n\n        &s; // Error! s has type string\n\n        new string; // Error! new cannot be applied to string type or string arrays\n    }\n\n```"
  },
  POINTER_COMPARISON_DIFFERENT_TYPE: {
    code: 9008,
    message: "Comparison between distinct pointer types<<typeL>> and<<typeR>> is not allowed.",
    description: "This error occurs when trying to compare to pointers which have different type.\n\nExample:\n\n```\n    int main() {\n        int* x;\n\n        const int* z;\n\n        double* y;\n\n        bool b = x == y; // Error! x and y have different pointer types\n\n        bool b2 = x == z; // Correct, x and y have same pointer type (constness doesn't matter)\n    }\n```"
  }
};

this.general = {
  MAIN_NOT_DEFINED: {
    code: 10001,
    message: "You must define a main function",
    description: "This error occurs when your program does not define a main function.\n\nExample:\n\n```\n    int mainf() { // typo, should be main, not mainf\n\n    }\n\n    // Main function is not defined anywhere in the program\n```"
  },
  INVALID_MAIN_TYPE: {
    code: 10002,
    message: "Main must return int",
    description: "This problem occurs when a main function is defined, but does not have int as its return type.\n\nExample:\n\n```\n    void main() { // Incorrect! main must have int return type, any other type is not allowed\n    }\n```"
  }
};

this.cout = {
  CANNOT_COUT_TYPE: {
    code: 11001,
    message: "Cannot cout value with type<<type>>",
    description: "This error occurs when using cout on an expression which cannot be written to the console.\n\nTypes which cannot be written to the console: Function, nullptr_t, void\n\nExample:\n\n```\n    #include <iostream>\n    using namespace std;\n\n    void f() {\n    }\n\n    int main() {\n        cout << f; // Invalid! f is of type function\n\n        cout << f(); // Invalid! f() is of type void\n    }\n\n```"
  }
};

this.newOperator = {
  UNINITIALIZED_CONST_NEW: {
    code: 12001,
    message: "Uninitialized const in 'new'",
    description: "This error occurs when using new on a const type. Currently new initialization is not supported yet\nso any new declaration with a const type will give this error.\n\nExample:\n\n```\n    int main() {\n        const int * x = new const int; // Error! new const int is a const type and it's not initialized\n    }\n```"
  },
  NEW_ARRAY_SIZE_CONSTANT: {
    code: 12002,
    message: "Array size in new-expression must be constant",
    description: "This error occurs when using a new statement on an array type which has a dimension other than the first one\nwith a non-const value.\n\nExample:\n\n```\n    int main() {\n        int n = 5;\n\n        int** x = new int[20][n]; // Error! second dimension has non-constant value n\n\n        int (*x)[20] = new int[n][20]; // Correct, first dimension is allowed to have a non-constant value\n    }\n```"
  }
};

this.limits = {
  TEMPORARY_ADDRESS_LIMIT: {
    code: 13001,
    message: "Temporary variable address space limit reached. You should simplify your program by breaking complex expressions into multiple operations",
    description: "This error occurs when a program has very complex expressions, and it is very rare.\n\nIf you happen to receive this error, try to simplify expressions in your program by breaking them\ninto multiple simpler expressions in different lines."
  },
  MAX_STACK_SIZE_EXCEEDED: {
    code: 13002,
    message: "Function<<id>> with stack size <<<size>>> bytes exceeds the maximum stack size limit of <<<limit>>> bytes. Try moving array declarations to the global scope.",
    description: "This error occurs when you define very big local variables inside a function. Typically it is\ndue to declaring big arrays.\n\nExample:\n\n```\n    int main() {\n        int arr[5000][5000][5000]; This array occupies 5000*5000*5000*4 bytes = 100GB, which is way above the stack limit\n    }\n```"
  },
  MAX_HEAP_SIZE_EXCEEDED: {
    code: 13003,
    message: "Heap size of <<<size>>> bytes exceeds the maximum <<<limit>>> bytes limit.",
    description: "This error occurs when you define a very big global variable. Typically it is due to declaring big arrays.\n\nExample:\n\n```\n    int arr[5000][5000][5000]; This array occupies 5000*5000*5000*4 bytes = 100GB, which is way above the heap limit\n\n```"
  }
};

c = (function(_this) {
  return function(name, code, message, description) {
    0;
    var messageName, messageObject, ref;
    ref = module.exports;
    for (messageName in ref) {
      messageObject = ref[messageName];
      0;
    }
    return new Message(code, message, "Compilation error", description);
  };
})(this);

module.exports = {};

ref = this;
for (errorType in ref) {
  map = ref[errorType];
  for (name in map) {
    ref1 = map[name], code = ref1.code, message = ref1.message, description = ref1.description;
    module.exports[name] = c(name, code, message, description);
  }
}


},{"./message":91}],88:[function(require,module,exports){
0;
var Message, code, description, errorType, map, message, name, ref, ref1, w;

Message = require('./message').Message;

w = (function(_this) {
  return function(name, code, message, description) {
    0;
    var messageName, messageObject, ref;
    ref = module.exports;
    for (messageName in ref) {
      messageObject = ref[messageName];
      0;
    }
    return new Message(code, message + "\n", "Warning", description);
  };
})(this);

module.exports = {};

ref = this;
for (errorType in ref) {
  map = ref[errorType];
  for (name in map) {
    ref1 = map[name], code = ref1.code, message = ref1.message, description = ref1.description;
    module.exports[name] = w(name, code, message, description);
  }
}


},{"./message":91}],89:[function(require,module,exports){
0;
var Message, code, description, e, errorType, map, message, name, ref, ref1;

Message = require('./message').Message;

this.invalidArithmetic = {
  DIVISION_BY_ZERO: {
    code: 136,
    message: "Floating point exception: division by zero",
    description: "This error occurs when performing an integer division with a zero-valued divisor.\n\nExample:\n\n```\n    int main() {\n        int x = 2;\n\n        x *= 0;\n\n        x /= x; // Error! x is zero because of the previous operation, so we're dividing by zero\n    }\n```"
  },
  MODULO_BY_ZERO: {
    code: 137,
    message: "Floating point exception: modulo by zero",
    description: "This error occurs when performing a modulo with a zero-valued modulo.\n\nExample:\n\n```\n    int main() {\n        int x = 2;\n\n        x *= 0;\n\n        x %= x; // Error! x is zero because of the previous operation, so we're performing a modulo by zero\n    }\n```"
  }
};

this.overflow = {
  STACK_OVERFLOW: {
    code: 138,
    message: "Stack overflow while calling function<<id>>. May be caused by infinite recursion, too deep recursion or very large local variable space",
    description: "This error can be caused either by too large local variables, or by too deep (possibily infinite) recursion.\n\nExample:\n\n```\n    int f() { // f recurses forever, and it has a very large local variable 'arr', so it will eventually cause a stack overflow\n              // note that the first condition is sufficient to cause a stack overflow\n        int arr[500][500][500];\n\n        f();\n    }\n\n    int main() {\n        f();\n    }\n```"
  },
  TEMPORARIES_OVERFLOW: {
    code: 139,
    message: "Ran out of temporaries while calling function<<id>>. May be caused by too complex expressions or very deep or infinite recursion",
    description: "This error can be caused either by too complex expressions or by to deep (possibily infinite) recursion.\n\nIf you happen to receive this error, try to simplify expressions in your program by breaking them\ninto multiple simpler expressions in different lines. Also check that there is no infinite recursion in your program."
  }
};

this.allocationAndDeallocation = {
  INVALID_NEW_ARRAY_LENGTH: {
    code: 140,
    message: "Invalid negative array size to new operator",
    description: "This error occurs when using new on an array type with a variable first dimension that happens to evaluate to\na negative integer at runtime.\n\nExample:\n\nint f() {\n    return -1;\n}\n\n```\n    int n = f();\n\n    int* p = new int[n]; // Error! n is negative here\n\n```"
  },
  CANNOT_ALLOCATE: {
    code: 141,
    message: "Cannot allocate<<size>> bytes, not enough heap space left",
    description: "This error occurs when allocating too large arrays. It could be that your program has already\nallocated too much space previously or that the static heap (global variables) is too big.\n\nExample:\n\n```\n    int x[500][500]; // Big global variable\n\n    void f(int n) {\n        if (n > 0) {\n            int * p = new int[50][50][50]; // This is executed 1000 times, causing too many allocations and exhausting the heap space\n            f(n - 1);\n        }\n    }\n\n    int main() {\n        f(1000);\n    }\n\n```"
  },
  INVALID_FREE_POINTER: {
    code: 142,
    message: "Used delete on an already deleted pointer or a pointer not allocated with new: <<pointer>>",
    description: "This error occurs when using delete on a pointer or array which has not been previously allocated with new,\nor a pointer which has already been freed with delete before in the program.\n\nExample:\n\n```\n    int x;\n\n    int main() {\n        int* p = &x;\n\n        delete p; // Error! p has not been allocated with new\n\n        int * p2 = new int[20];\n\n        delete p2; // Correct, p2 has been allocated with new\n\n        delete p2; // Error! p2 has already been freed with delete before\n    }\n```"
  }
};

e = (function(_this) {
  return function(name, code, message, description) {
    0;
    var messageName, messageObject, ref;
    ref = module.exports;
    for (messageName in ref) {
      messageObject = ref[messageName];
      0;
    }
    return new Message(code, message + "\n", "Execution error", description);
  };
})(this);

module.exports = {};

ref = this;
for (errorType in ref) {
  map = ref[errorType];
  for (name in map) {
    ref1 = map[name], code = ref1.code, message = ref1.message, description = ref1.description;
    module.exports[name] = e(name, code, message, description);
  }
}


},{"./message":91}],90:[function(require,module,exports){
0;
var compilationErrors, compilationWarnings, executionErrors,
  slice = [].slice;

module.exports = this;

compilationErrors = require('./compilation-error');

executionErrors = require('./execution-error');

compilationWarnings = require('./compilation-warning');

this.compilationError = function() {
  var error, locations, name, others;
  name = arguments[0], locations = arguments[1], others = 3 <= arguments.length ? slice.call(arguments, 2) : [];
  0;
  error = compilationErrors[name];
  error.locations = locations;
  if (others.length) {
    error = error.complete.apply(error, others);
  }
  throw error;
};

this.executionError = function() {
  var error, name, others, vm;
  vm = arguments[0], name = arguments[1], others = 3 <= arguments.length ? slice.call(arguments, 2) : [];
  0;
  error = executionErrors[name];
  if (others.length) {
    error = error.complete.apply(error, others);
  }
  return vm.executionError(error);
};

this.compilationWarning = function() {
  var name, others, state, warning;
  state = arguments[0], name = arguments[1], others = 3 <= arguments.length ? slice.call(arguments, 2) : [];
  0;
  warning = compilationWarnings[name];
  if (others.length) {
    warning = warning.complete.apply(warning, others);
  }
  return state.warn(warning);
};


},{"./compilation-error":87,"./compilation-warning":88,"./execution-error":89}],91:[function(require,module,exports){
0;
var Message, utils,
  slice = [].slice;

utils = require('../utils');

module.exports = this;

this.Message = Message = (function() {
  function Message(code1, message1, type, description) {
    this.code = code1;
    this.message = message1;
    this.type = type;
    this.description = description;
    this.generated = true;
    this.locations = null;
  }

  Message.prototype.complete = function() {
    var bracedPlaceHolder, index, isLiteral, others, placeHolder, ref, ret, text;
    placeHolder = arguments[0], text = arguments[1], others = 3 <= arguments.length ? slice.call(arguments, 2) : [];
    others.unshift(placeHolder, text);
    ret = utils.clone(this);
    while (others.length > 0) {
      ref = others, placeHolder = ref[0], text = ref[1], others = 3 <= ref.length ? slice.call(ref, 2) : [];
      bracedPlaceHolder = "<<<" + placeHolder + ">>>";
      index = ret.message.indexOf(bracedPlaceHolder);
      isLiteral = index >= 0;
      if (!isLiteral) {
        bracedPlaceHolder = "<<" + placeHolder + ">>";
        index = ret.message.indexOf(bracedPlaceHolder);
        text = text != null ? " '" + text + "'" : "";
      }
      0;
      0;
      ret.message = ret.message.replace(bracedPlaceHolder, text);
    }
    return ret;
  };

  Message.prototype.toString = function(code) {
    var s;
    s = this.getMessage(code);
    if (this.description != null) {
      s += "\nDescription:\n\n" + this.description;
    }
    return s;
  };

  Message.prototype.getMessage = function(code) {
    var lineColumnSpec, message, ref, relevantCode, s;
    if (this.locations != null) {
      ref = utils.locationsMessage(code, this.locations), lineColumnSpec = ref.lineColumnSpec, relevantCode = ref.relevantCode;
    } else {
      lineColumnSpec = "";
    }
    message = this.code === 1001 ? this.message : lineColumnSpec + "semantic error: " + this.message;
    s = message + "\n";
    if (relevantCode != null) {
      s += utils.indent(relevantCode, 2) + "\n";
    }
    return s;
  };

  return Message;

})();


},{"../utils":96}],92:[function(require,module,exports){
0;
var Allocator, ENTRY_FUNCTION, IO, Memory, MemoryReference, PRIMITIVE_TYPES, Pointer, VM, executionError, ref, utils;

Allocator = require('malloc');

IO = require('./io').IO;

ENTRY_FUNCTION = require('../compiler/program').Program.ENTRY_FUNCTION;

Memory = require('./memory').Memory;

MemoryReference = require('../ast/memory-reference').MemoryReference;

ref = require('../ast/type'), PRIMITIVE_TYPES = ref.PRIMITIVE_TYPES, Pointer = ref.Pointer;

utils = require('../utils');

executionError = require('../messages').executionError;

module.exports = this;

VM = (function() {
  function VM(program, input) {
    var ref1;
    this.func = program.functions[ENTRY_FUNCTION];
    this.instructions = this.func.instructions;
    this.pointers = {
      instruction: 0,
      stack: 0,
      temporaries: 0
    };
    this.io = new IO;
    if (input != null) {
      this.io.input(IO.STDIN, input);
    }
    this.io.setOutputListeners(program.outputListeners);
    this.memory = (ref1 = program.memory) != null ? ref1 : new Memory;
    this.memory.setPointers(this.pointers);
    this.allocator = new Allocator(this.memory.heapBuffer);
    this.allocatedPointers = {};
    if (program.globalsSize > 0) {
      this.staticHeapAddress = this.allocator.calloc(program.globalsSize);
    }
    this.controlStack = [];
    this.variables = program.variables, this.functions = program.functions;
    this.finished = false;
    this.instruction = this.instructions[this.pointers.instruction];
    this.hasEndedInput = false;
  }

  VM.prototype.isWaitingForInput = function() {
    return !this.hasEndedInput && this.instruction.isRead && this.io.getStream(IO.STDIN).length === 0;
  };

  VM.prototype.endOfInput = function() {
    return this.hasEndedInput = true;
  };

  VM.prototype.computeResults = function() {
    0;
    var address, results;
    if (this.status == null) {
      this.status = MemoryReference.from(PRIMITIVE_TYPES.INT, null, MemoryReference.RETURN).read(this.memory);
    }
    this.stdout = this.io.getStream(IO.STDOUT);
    this.stderr = this.io.getStream(IO.STDERR);
    this.output = this.io.getStream(IO.INTERLEAVED);
    if (this.staticHeapAddress != null) {
      this.allocator.free(this.staticHeapAddress);
    }
    results = [];
    for (address in this.allocatedPointers) {
      results.push(this.allocator.free(address & 0x7FFFFFF));
    }
    return results;
  };

  VM.prototype.executionError = function(error) {
    this.finished = true;
    this.io.output(IO.STDERR, error.message);
    return this.status = error.code;
  };

  VM.prototype.input = function(string) {
    return this.io.input(IO.STDIN, string);
  };

  VM.prototype.alloc = function(size) {
    var error, initialPointer, pointer;
    try {
      initialPointer = this.allocator.calloc(size);
      if (initialPointer === 0) {
        throw new Error();
      }
      pointer = new Pointer(PRIMITIVE_TYPES.VOID).tipify(initialPointer | 0x80000000);
      this.allocatedPointers[pointer] = true;
    } catch (error1) {
      error = error1;
      executionError(this, 'CANNOT_ALLOCATE', "size", size);
    }
    return pointer;
  };

  VM.prototype.free = function(offset) {
    var err, error, offsetMalloc, result;
    error = this.allocatedPointers[offset] == null;
    offsetMalloc = offset & 0x7FFFFFFF;
    if (!error) {
      try {
        result = this.allocator.free(offsetMalloc);
      } catch (error1) {
        err = error1;
        error = true;
      }
    }
    if (error) {
      executionError(this, 'INVALID_FREE_POINTER', 'pointer', "0x" + utils.pad(offset.toString(16), '0', 8));
    }
    delete this.allocatedPointers[offset];
    return result;
  };

  return VM;

})();

this.run = function*(program, input) {
  var vm;
  vm = new VM(program, input);
  while (!vm.finished) {
    vm.instruction = vm.instructions[vm.pointers.instruction];
    yield vm;
    vm.instruction.execute(vm);
    ++vm.pointers.instruction;
  }
  vm.computeResults();
  return (yield vm);
};

this.runSync = function(program, input) {
  var vm;
  vm = new VM(program, input);
  while (!vm.finished) {
    vm.instructions[vm.pointers.instruction].execute(vm);
    ++vm.pointers.instruction;
  }
  vm.computeResults();
  return vm;
};


},{"../ast/memory-reference":67,"../ast/type":72,"../compiler/program":80,"../messages":90,"../utils":96,"./io":94,"./memory":95,"malloc":30}],93:[function(require,module,exports){
var PRIMITIVE_TYPES;

PRIMITIVE_TYPES = require('../ast/type').PRIMITIVE_TYPES;

module.exports = this;

this.parseInput = function(word, type) {
  var end, foundDot, index, value;
  switch (type) {
    case PRIMITIVE_TYPES.INT:
      if (!/[0-9\-]/.test(word[0])) {
        index = 0;
      } else {
        index = word.slice(1).search(/[^0-9]/);
        if (index >= 0) {
          ++index;
        }
      }
      if (index > 0) {
        return {
          value: parseInt(word.slice(0, index)),
          leftover: word.slice(index)
        };
      } else if (index === 0) {
        return {
          value: null,
          leftover: word
        };
      } else {
        return {
          value: parseInt(word),
          leftover: ""
        };
      }
      break;
    case PRIMITIVE_TYPES.DOUBLE:
      index = 0;
      end = false;
      foundDot = false;
      if (/[0-9\-\.]/.test(word[0])) {
        if (word[0] === '.') {
          foundDot = true;
        }
        index = 1;
        while (index < word.length && !end) {
          if (word[index] === '.') {
            if (foundDot) {
              end = true;
            } else {
              foundDot = true;
              ++index;
            }
          } else if (/[0-9]/.test(word[index])) {
            ++index;
          } else {
            end = true;
          }
        }
      }
      if (index > 0) {
        return {
          value: parseFloat(word.slice(0, index)),
          leftover: word.slice(index)
        };
      } else if (index === 0) {
        return {
          value: null,
          leftover: word
        };
      } else {
        return {
          value: parseFloat(word),
          leftover: ""
        };
      }
      break;
    case PRIMITIVE_TYPES.BOOL:
      value = parseInt(word);
      if (value !== 0 && value !== 1) {
        return {
          leftover: word,
          value: null
        };
      } else {
        return {
          value: value === 1,
          leftover: word.slice(1)
        };
      }
      break;
    case PRIMITIVE_TYPES.STRING:
      return {
        value: word,
        leftover: ""
      };
    case PRIMITIVE_TYPES.CHAR:
      return {
        value: word.charCodeAt(0),
        leftover: word.slice(1)
      };
    default:
      return 0;
  }
};


},{"../ast/type":72}],94:[function(require,module,exports){
0;
var IO;

module.exports = this;

this.IO = IO = (function() {
  IO.STDIN = 0;

  IO.STDOUT = 1;

  IO.STDERR = 2;

  IO.INTERLEAVED = 3;

  function IO() {
    var stream;
    this.streams = {
      1: "",
      2: "",
      0: [],
      3: ""
    };
    this.listeners = {};
    for (stream in this.streams) {
      this.listeners[stream] = [];
    }
  }

  IO.prototype.output = function(stream, string) {
    0;
    0;
    var i, j, len, len1, listener, ref, ref1, results;
    this.streams[IO.INTERLEAVED] += string;
    this.streams[stream] += string;
    ref = this.listeners[stream];
    for (i = 0, len = ref.length; i < len; i++) {
      listener = ref[i];
      listener(string);
    }
    ref1 = this.listeners[IO.INTERLEAVED];
    results = [];
    for (j = 0, len1 = ref1.length; j < len1; j++) {
      listener = ref1[j];
      results.push(listener(string));
    }
    return results;
  };

  IO.prototype.input = function(stream, input) {
    0;
    0;
    var words;
    words = input.trim().split(/\s+/);
    if (words.length && words[0].length) {
      return this.streams[stream] = this.streams[stream].concat(words);
    }
  };

  IO.prototype.getWord = function(stream) {
    0;
    return this.streams[stream].shift();
  };

  IO.prototype.unshiftWord = function(stream, word) {
    0;
    return this.streams[stream].unshift(word);
  };

  IO.prototype.getStream = function(stream) {
    return this.streams[stream];
  };

  IO.prototype.setOutputListeners = function(listeners) {
    var base, fn, i, len, ref, results, stream;
    results = [];
    for (i = 0, len = listeners.length; i < len; i++) {
      ref = listeners[i], fn = ref.fn, stream = ref.stream;
      0;
      if ((base = this.listeners)[stream] == null) {
        base[stream] = [];
      }
      results.push(this.listeners[stream].push(fn));
    }
    return results;
  };

  return IO;

})();


},{}],95:[function(require,module,exports){
var DataView, MB, Memory, largestAssignableBytes;

largestAssignableBytes = require('../ast/type').PRIMITIVE_TYPES.LARGEST_ASSIGNABLE.bytes;

DataView = (function() {
  function DataView(buffer1) {
    this.buffer = buffer1;
    this.int8Array = new Int8Array(this.buffer, 0);
    this.uint8Array = new Uint8Array(this.buffer, 0);
    this.int16Array = new Int16Array(this.buffer, 0);
    this.uint16Array = new Uint16Array(this.buffer, 0);
    this.int32Array = new Int32Array(this.buffer, 0);
    this.uint32Array = new Uint32Array(this.buffer, 0);
    this.float32Array = new Float32Array(this.buffer, 0);
    this.float64Array = new Float64Array(this.buffer, 0);
  }

  DataView.prototype.getInt8 = function(address) {
    return this.int8Array[address];
  };

  DataView.prototype.getUint8 = function(address) {
    return this.uint8Array[address];
  };

  DataView.prototype.getInt16 = function(address) {
    return this.int16Array[address >> 1];
  };

  DataView.prototype.getUint16 = function(address) {
    return this.uint16Array[address >> 1];
  };

  DataView.prototype.getInt32 = function(address) {
    return this.int32Array[address >> 2];
  };

  DataView.prototype.getUint32 = function(address) {
    return this.uint32Array[address >> 2];
  };

  DataView.prototype.getFloat32 = function(address) {
    return this.float32Array[address >> 2];
  };

  DataView.prototype.getFloat64 = function(address) {
    return this.float64Array[address >> 3];
  };

  DataView.prototype.setInt8 = function(address, value) {
    return this.int8Array[address] = value;
  };

  DataView.prototype.setUint8 = function(address, value) {
    return this.uint8Array[address] = value;
  };

  DataView.prototype.setInt16 = function(address, value) {
    return this.int16Array[address >> 1] = value;
  };

  DataView.prototype.setUint16 = function(address, value) {
    return this.uint16Array[address >> 1] = value;
  };

  DataView.prototype.setInt32 = function(address, value) {
    return this.int32Array[address >> 2] = value;
  };

  DataView.prototype.setUint32 = function(address, value) {
    return this.uint32Array[address >> 2] = value;
  };

  DataView.prototype.setFloat32 = function(address, value) {
    return this.float32Array[address >> 2] = value;
  };

  DataView.prototype.setFloat64 = function(address, value) {
    return this.float64Array[address >> 3] = value;
  };

  return DataView;

})();

module.exports = this;

MB = 1024 * 1024;

this.Memory = Memory = (function() {
  Memory.SIZES = {
    heap: 256 * MB,
    stack: 128 * MB,
    tmp: 64 * MB,
    "return": largestAssignableBytes
  };

  function Memory() {
    var buffer, memoryCompartment, ref, size;
    ref = Memory.SIZES;
    for (memoryCompartment in ref) {
      size = ref[memoryCompartment];
      this[memoryCompartment + 'Buffer'] = buffer = new ArrayBuffer(size);
      this[memoryCompartment] = new DataView(buffer);
    }
    this[0] = this.stack;
    this[1] = this.heap;
  }

  Memory.prototype.setPointers = function(pointers) {
    this.pointers = pointers;
  };

  return Memory;

})();


},{"../ast/type":72}],96:[function(require,module,exports){
var clone, markLineFrom,
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

module.exports = this;

this.clone = clone = function(x) {
  var key, r, value;
  if (Array.isArray(x)) {
    return x.slice(0);
  } else if (typeof x === "object") {
    r = {};
    for (key in x) {
      value = x[key];
      r[key] = value;
    }
    for (key in x) {
      if (!hasProp.call(x, key)) continue;
      value = x[key];
      r[key] = value;
    }
    return r;
  } else {
    return x;
  }
};

this.max = function(arg, f) {
  var elem, first, j, len, maxE, maxV, obj, prop, rest, v;
  first = arg[0], rest = 2 <= arg.length ? slice.call(arg, 1) : [];
  if (typeof f === "object") {
    obj = f;
    f = function(x) {
      return obj[x];
    };
  } else if (typeof f === "string") {
    prop = f;
    f = function(x) {
      return x[prop];
    };
  }
  maxV = f(first);
  maxE = first;
  for (j = 0, len = rest.length; j < len; j++) {
    elem = rest[j];
    if ((v = f(elem)) > maxV) {
      maxE = elem;
      maxV = v;
    }
  }
  return {
    arg: maxE,
    value: maxV
  };
};

this.cloneDeep = function(obj) {
  var flags, key, newInstance;
  if ((obj == null) || typeof obj !== 'object') {
    return obj;
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }
  if (obj instanceof RegExp) {
    flags = '';
    if (obj.global != null) {
      flags += 'g';
    }
    if (obj.ignoreCase != null) {
      flags += 'i';
    }
    if (obj.multiline != null) {
      flags += 'm';
    }
    if (obj.sticky != null) {
      flags += 'y';
    }
    return new RegExp(obj.source, flags);
  }
  newInstance = new obj.constructor();
  for (key in obj) {
    newInstance[key] = clone(obj[key]);
  }
  return newInstance;
};

this.pad = function(s, c, t, arg) {
  var end, i, length, padding, ref;
  end = (ref = (arg != null ? arg : {}).end) != null ? ref : false;
  length = s.length;
  padding = ((function() {
    var j, ref1, ref2, results;
    results = [];
    for (i = j = ref1 = length, ref2 = t; ref1 <= ref2 ? j < ref2 : j > ref2; i = ref1 <= ref2 ? ++j : --j) {
      results.push(c);
    }
    return results;
  })()).join("");
  if (end) {
    return s + padding;
  } else {
    return padding + s;
  }
};

this.alignTo = function(address, bytes) {
  return (((address / bytes) | 0) + ((address & (bytes - 1)) !== 0)) * bytes;
};

markLineFrom = function(line, start, end) {
  if (start == null) {
    start = line.search(/\S/) - 1;
  }
  if (end == null) {
    end = line.length - 1;
  }
  return Array(start + 2).join(" ") + Array(end - start + 1).join("~");
};

this.locationsMessage = function(code, locations) {
  var codeLines, columns, j, k, lineColumnSpec, lineNumber, lines, markLines, ref, ref1, relevantCodeLines, results;
  locations = clone(locations);
  lines = locations.lines, columns = locations.columns;
  lineColumnSpec = lines.first + ":" + columns.first + ": ";
  --lines.first;
  --lines.last;
  --columns.first;
  --columns.last;
  codeLines = code.split('\n');
  relevantCodeLines = codeLines.slice(lines.first, +lines.last + 1 || 9e9);
  markLines = [];
  if (relevantCodeLines.length === 1) {
    markLines.push(markLineFrom(relevantCodeLines[0], columns.first, columns.last));
  } else {
    markLines.push(markLineFrom(relevantCodeLines[0], columns.first));
    for (lineNumber = j = 1, ref = relevantCodeLines.length - 1; 1 <= ref ? j < ref : j > ref; lineNumber = 1 <= ref ? ++j : --j) {
      markLines.push(markLineFrom(relevantCodeLines[lineNumber], null, null));
    }
    markLines.push(markLineFrom(relevantCodeLines[relevantCodeLines.length - 1], null, columns.last));
  }
  return {
    lineColumnSpec: lineColumnSpec,
    relevantCode: (function() {
      results = [];
      for (var k = 0, ref1 = relevantCodeLines.length * 2; 0 <= ref1 ? k < ref1 : k > ref1; 0 <= ref1 ? k++ : k--){ results.push(k); }
      return results;
    }).apply(this).map(function(x, i) {
      if (i & 1) {
        return markLines[i >> 1];
      } else {
        return relevantCodeLines[i >> 1];
      }
    }).join("\n")
  };
};

this.indent = function(text, spaces) {
  return text.split('\n').map(function(x) {
    return Array(spaces + 1).join(" ") + x;
  }).join("\n");
};

this.countInstructions = function(instructions) {
  var c, instruction, j, len;
  c = 0;
  for (j = 0, len = instructions.length; j < len; j++) {
    instruction = instructions[j];
    if (!instruction.isDebugInfo) {
      ++c;
    }
  }
  return c;
};


},{}]},{},[1]);
