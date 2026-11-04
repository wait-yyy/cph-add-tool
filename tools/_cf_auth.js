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
const UA_FILE = path.join(ROOT, 'training', 'cf-ua.txt');
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractCookieFromCurl(text) {
    const m1 = /(?:-H|--header)\s+['"]cookie:\s*([^'"]+)['"]/i.exec(text);
    if (m1) return m1[1];
    const m2 = /(?:^|\s)-b\s+['"]([^'"]+)['"]/i.exec(text);
    return m2 ? m2[1] : '';
}

function normalizeCookie(value) {
    let text = String(value == null ? '' : value).trim();
    if (/\bcurl(\.exe)?\b/i.test(text) || /(?:^|\s)-H\s/.test(text) || /(?:^|\s)-b\s/.test(text)) {
        const extracted = extractCookieFromCurl(text);
        if (extracted) text = extracted;
    }
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

function extractUserAgentFromCurl(text) {
    const m = /(?:-A|--user-agent)\s+['"]([^'"]+)['"]/i.exec(String(text || ''));
    return m ? m[1] : '';
}

function writeUserAgent(value) {
    const ua = extractUserAgentFromCurl(value) || String(value == null ? '' : value).replace(/\r?\n/g, ' ').trim();
    if (!ua) return false;
    try {
        fs.mkdirSync(path.dirname(UA_FILE), { recursive: true });
        fs.writeFileSync(UA_FILE, ua + '\n', 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

function getUserAgent() {
    try {
        const ua = String(fs.readFileSync(UA_FILE, 'utf8')).trim();
        if (ua) return ua;
    } catch (e) { /* ignore */ }
    return DEFAULT_UA;
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
    UA_FILE: UA_FILE,
    getUserAgent: getUserAgent,
    writeUserAgent: writeUserAgent,
    readCookie: readCookie,
    writeCookie: writeCookie,
    clearCookie: clearCookie,
    isCfUrl: isCfUrl
};
