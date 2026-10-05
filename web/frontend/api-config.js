(function () {
    "use strict";

    const configuredBase = window.SCHOLARSYNC_API_BASE;
    const host = window.location.hostname || "localhost";
    // HTTPS deployments use the same public origin; the frontend server proxies
    // /api to Express. Plain HTTP keeps the existing localhost/LAN setup.
    const defaultBase = window.location.protocol === "https:"
        ? `${window.location.origin}/api`
        : `http://${host}:3000/api`;

    window.SCHOLARSYNC_API_BASE = String(configuredBase || defaultBase).replace(/\/+$/, "");
})();
