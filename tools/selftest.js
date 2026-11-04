#!/usr/bin/env node
'use strict';

/*
 * tools/selftest.js
 * 无网络、无 AI 调用的基础自检：扩展语法/命令、Companion 写入、提交识别、样例读取。
 *
 *   node tools/selftest.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'tools', 'vscode-extension', 'algorithm-training-tool');
let pass = 0;
let fail = 0;

function check(name, ok, extra) {
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ('  ' + String(extra).replace(/\s+/g, ' ').slice(0, 180)) : ''));
    if (ok) pass++; else fail++;
}

function run(cmd, args, timeout) {
    return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', timeout: timeout || 120000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

function main() {
    // extension syntax
    const syntax = run('node', ['--check', path.join(EXT, 'extension.js')]);
    check('extension syntax', syntax.status === 0, syntax.stderr);

    // package identity
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8')); } catch (e) { /* ignore */ }
    check('package name', pkg && pkg.name === 'algorithm-training-tool', pkg && pkg.name);
    check('package commands >= 43', pkg && Array.isArray(pkg.contributes.commands) && pkg.contributes.commands.length >= 43,
        pkg && pkg.contributes.commands && pkg.contributes.commands.length);

    // companion data writer
    const testRoot = path.join(ROOT, '.build', 'selftest-companion');
    try {
        fs.rmSync(testRoot, { recursive: true, force: true });
        fs.mkdirSync(testRoot, { recursive: true });
        const tmpl = path.join(ROOT, 'new.cpp');
        if (fs.existsSync(tmpl)) fs.copyFileSync(tmpl, path.join(testRoot, 'new.cpp'));
        const writer = require('./companion-data.js');
        const result = writer.writeCompanionProblem({
            name: 'A. Selftest', group: 'Codeforces - Gym 1',
            url: 'https://codeforces.com/gym/1/problem/A',
            timeLimit: 2000, memoryLimit: 256,
            tests: [{ input: '1 2\n', output: '3\n' }]
        }, testRoot);
        const data = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
        const cph = path.join(path.dirname(result.cppPath), '.cph');
        const cphFiles = fs.existsSync(cph) ? fs.readdirSync(cph).filter(function (f) { return /\.prob$/i.test(f); }) : [];
        check('companion writes cpp', fs.existsSync(result.cppPath));
        check('companion writes tests', data.tests.length === 1 && data.tests[0].output === '3\n');
        check('companion writes .cph cache', cphFiles.length > 0, cphFiles.join(','));
    } catch (e) {
        check('companion writer', false, e.message);
    } finally {
        try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }

    // submit dry-run (no network, uses saved metadata)
    const cpp = path.join(ROOT, 'luogu', 'contest367096', 'B2175.cpp');
    if (fs.existsSync(cpp)) {
        const sub = run('node', [path.join(ROOT, 'tools', 'submit.js'), 'luogu/contest367096/B2175.cpp', '--dry-run']);
        let data = null;
        try { data = JSON.parse(String(sub.stdout || '').trim().split(/\r?\n/).pop()); } catch (e) { /* ignore */ }
        check('submit detects platform', data && data.platform === 'luogu', data && data.platform);
        check('submit finds URL', data && /luogu\.com\.cn\/problem\/B2175/.test(String(data.url || '')), data && data.url);
    } else {
        check('submit fixture exists', false, cpp);
    }

    // sample reader
    if (fs.existsSync(cpp)) {
        const list = run('node', [path.join(ROOT, 'tools', 'sample-tests.js'), '--list', 'luogu/contest367096/B2175.cpp']);
        let data = null;
        try { data = JSON.parse(String(list.stdout || '').trim().split(/\r?\n/).pop()); } catch (e) { /* ignore */ }
        check('sample-tests reads tests', data && Array.isArray(data.tests) && data.tests.length >= 2, data && data.tests && data.tests.length);
    }

    console.log('SUMMARY pass=' + pass + ' fail=' + fail);
    process.exit(fail > 0 ? 1 : 0);
}

main();
