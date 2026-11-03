'use strict';

/*
 * tools/_ai.js
 * Minimal OpenAI-compatible chat client shared by tools/ai-client.js and
 * tools/cph-statement.js. No npm dependencies: plain Node http/https.
 *
 * Config resolution (first hit wins):
 *   1. environment: AI_API_KEY / AI_BASE_URL / AI_MODEL
 *   2. training/ai-config.json:
 *        { "baseUrl": "https://api.deepseek.com", "apiKey": "sk-...",
 *          "model": "deepseek-chat", "temperature": 0.3, "timeoutMs": 180000 }
 *
 * baseUrl may be:
 *   https://api.deepseek.com                     -> .../v1/chat/completions
 *   https://api.deepseek.com/v1                  -> .../v1/chat/completions
 *   https://example.com/v1/chat/completions      -> used as-is
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'training', 'ai-config.json');

function loadConfig() {
    let fileCfg = {};
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            fileCfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
        }
    } catch (e) {
        fileCfg = {};
    }
    const env = process.env;
    return {
        baseUrl: String(env.AI_BASE_URL || fileCfg.baseUrl || 'https://api.deepseek.com').trim(),
        apiKey: String(env.AI_API_KEY || fileCfg.apiKey || '').trim(),
        model: String(env.AI_MODEL || fileCfg.model || 'deepseek-flash').trim(),
        temperature: Number(env.AI_TEMPERATURE || fileCfg.temperature || 0.3),
        timeoutMs: Number(fileCfg.timeoutMs || 180000),
        maxTokens: Number(fileCfg.maxTokens || 0)
    };
}

function isConfigured(cfg) {
    const c = cfg || loadConfig();
    return !!(c.baseUrl && c.apiKey && c.model);
}

function endpoint(baseUrl) {
    let b = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(b)) return b;
    if (/\/v1$/.test(b)) return b + '/chat/completions';
    return b + '/v1/chat/completions';
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
}

// DeepSeek (and some gateways) answer HTTP 400 with the list of valid model names,
// e.g. "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed ...".
function supportedModelsFromError(err) {
    const msg = String(err && err.message ? err.message : (err || ''));
    const m = /supported API model names are\s+([^.;:]+)/i.exec(msg);
    if (!m) return [];
    return m[1].split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function postJson(rawUrl, payload, timeoutMs, apiKey) {
    return new Promise(function (resolve, reject) {
        let u;
        try { u = new URL(rawUrl); } catch (e) { return reject(e); }
        let mod = null;
        if (u.protocol === 'http:') mod = http;
        else if (u.protocol === 'https:') mod = https;
        if (!mod) return reject(new Error('unsupported protocol: ' + u.protocol));
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        const req = mod.request(u, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': body.length,
                'Authorization': 'Bearer ' + apiKey,
                'Accept': 'application/json'
            },
            timeout: timeoutMs
        }, function (res) {
            const chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () {
                const text = Buffer.concat(chunks).toString('utf8');
                let json = null;
                try { json = JSON.parse(text); } catch (e) { json = null; }
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let msg = text.slice(0, 300);
                    if (json && json.error) {
                        if (typeof json.error === 'string') msg = json.error;
                        else if (json.error.message) msg = String(json.error.message);
                    }
                    return reject(new Error('HTTP ' + res.statusCode + ': ' + msg));
                }
                if (!json) return reject(new Error('响应不是 JSON: ' + text.slice(0, 200)));
                resolve(json);
            });
            res.on('error', reject);
        });
        req.on('timeout', function () { req.destroy(new Error('API 请求超时（' + timeoutMs + 'ms）')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function chat(messages, options) {
    const cfg = Object.assign({}, loadConfig(), options || {});
    if (!isConfigured(cfg)) {
        throw new Error('AI API 未配置：在插件里点「设置 AI API」，或填写 training/ai-config.json');
    }
    const basePayload = {
        messages: messages,
        temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
        stream: false
    };
    if (cfg.maxTokens && cfg.maxTokens > 0) basePayload.max_tokens = cfg.maxTokens;

    let model = cfg.model;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const payload = Object.assign({}, basePayload, { model: model });
        try {
            const json = await postJson(endpoint(cfg.baseUrl), payload, cfg.timeoutMs || 180000, cfg.apiKey);
            const msgObj = json && json.choices && json.choices[0] && json.choices[0].message;
            const content = msgObj && msgObj.content;
            if (typeof content !== 'string' || !content.trim()) {
                // Hybrid reasoning models (e.g. deepseek-flash) may spend the whole
                // max_tokens budget on reasoning_content and return empty content.
                // Retry once with a bigger token budget.
                if (attempt < 3 && (!basePayload.max_tokens || basePayload.max_tokens < 4096)) {
                    basePayload.max_tokens = 8192;
                    continue;
                }
                throw new Error('API 返回空内容（推理模型可能把 token 用在了 reasoning 上，请加大 maxTokens）');
            }
            if (model !== cfg.model) {
                console.error('[ai] 配置的模型 "' + cfg.model + '" 不可用，已自动改用 "' + model +
                    '"；建议把 training/ai-config.json 的 model 改成 "' + model + '"');
            }
            return content.trim();
        } catch (e) {
            lastErr = e;
            const supported = supportedModelsFromError(e);
            if (supported.length && supported.indexOf(model) < 0 && attempt < 3) {
                model = supported[0];
                continue;
            }
            if (attempt === 1) { await sleep(900); continue; }
            break;
        }
    }
    throw lastErr;
}

module.exports = {
    loadConfig: loadConfig,
    isConfigured: isConfigured,
    endpoint: endpoint,
    chat: chat,
    CONFIG_PATH: CONFIG_PATH,
    ROOT: ROOT
};
