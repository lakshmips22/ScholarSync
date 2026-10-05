"use strict";

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "frontend");
const host = process.env.SCHOLARSYNC_FRONTEND_HOST || "0.0.0.0";
const port = Number(process.env.SCHOLARSYNC_FRONTEND_PORT || 5500);
const apiProxyTarget = new URL("http://127.0.0.1:3000");
const hopByHopHeaders = new Set([
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host"
]);
const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
};

function send(res, status, message) {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
    res.end(message);
}

function proxyApi(req, res) {
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
        if (!hopByHopHeaders.has(name.toLowerCase())) headers[name] = value;
    }

    const upstream = http.request({
        hostname: apiProxyTarget.hostname,
        port: apiProxyTarget.port,
        method: req.method,
        path: req.url,
        headers
    }, (upstreamRes) => {
        const responseHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
            if (!hopByHopHeaders.has(name.toLowerCase())) responseHeaders[name] = value;
        }
        res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
        upstreamRes.pipe(res);
    });

    upstream.on("error", () => {
        if (res.headersSent) return res.destroy();
        res.writeHead(502, { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff" });
        res.end(JSON.stringify({ success: false, message: "API service is unavailable." }));
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
}

const server = http.createServer((req, res) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
        return send(res, 400, "Invalid URL");
    }
    if (pathname === "/api" || pathname.startsWith("/api/")) return proxyApi(req, res);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    if (pathname === "/") pathname = "/index.html";
    const target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) return send(res, 404, "Not found");
    fs.stat(target, (error, stat) => {
        if (error || !stat.isFile()) return send(res, 404, "Not found");
        res.writeHead(200, {
            "content-type": contentTypes[path.extname(target).toLowerCase()] || "application/octet-stream",
            "x-content-type-options": "nosniff",
            "cache-control": "no-cache"
        });
        if (req.method === "HEAD") return res.end();
        fs.createReadStream(target).pipe(res);
    });
});

server.listen(port, host, () => {
    console.log(`ScholarSync frontend: http://localhost:${port}`);
    if (host === "0.0.0.0" || host === "::") {
        const addresses = Object.values(os.networkInterfaces()).flat().filter((item) =>
            item && item.family === "IPv4" && !item.internal
        );
        for (const item of addresses) console.log(`Same-network device: http://${item.address}:${port}`);
        if (!addresses.length) console.log("No non-loopback IPv4 address was detected. Check the host network settings.");
    }
});

server.on("error", (error) => {
    console.error(`Frontend server could not start: ${error.message}`);
    process.exitCode = 1;
});
