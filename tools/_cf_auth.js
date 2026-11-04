'use strict';

/*
 * tools/_cf_auth.js
 * Local Codeforces login state for Gym / private contests.
 *
 * The user logs in with a real browser, copies the `Cookie` request header and
 * stores it in training/cf-cookies.txt (gitignored). All CF page/API requests
 * made by the tools attach that header, so Gym and private contests become
 * accessible without putting a password anywhere.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COOKIE_FILE = path.join(ROOT, 'training', 'cf-cookies.txt');

function normalizeCookie(value) {
    let text = String(value == null ? '' : value).trim();
    const m = /(?:-H|--header|-b)\s+['"](?:cookie:\s*)?([^'"]+)['"]/i.exec(text);
    if (m) text = m[1];
    return text
        .replace(/\r?\n/g, ' ')
        .replace(/^\s*Cookie:\s*/i, '')
        .trim();
}

function readCookie() {
    try {
        return normalizeCookie(fs.readFileSync(COOKIE_FILE, 'utf8'));
    } catch (e) {
        return '';
    }
}

function writeCookie(value) {
    const text = normalizeCookie(value);
    if (!text) return false;
    fs.mkdirSync(path.dirname(COOKIE_FILE), { recursive: true });
    fs.writeFileSync(COOKIE_FILE, text + '\n', 'utf8');
    return true;
}

function clearCookie() {
    try {
        fs.unlinkSync(COOKIE_FILE);
        return true;
    } catch (e) {
        return false;
    }
}

function isCfUrl(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return /(^|\.)codeforces\.com$/.test(host);
    } catch (e) {
        return /codeforces\.com/i.test(String(url || ''));
    }
}

module.exports = {
    ROOT: ROOT,
    COOKIE_FILE: COOKIE_FILE,
    readCookie: readCookie,
    writeCookie: writeCookie,
    clearCookie: clearCookie,
    isCfUrl: isCfUrl
};
