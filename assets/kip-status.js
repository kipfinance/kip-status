(function () {
  "use strict";

  const STATUS_REPO = "kipfinance/kip-status";
  const RAW_BASE = `https://raw.githubusercontent.com/${STATUS_REPO}/main`;
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", ""]);
  const GITHUB_API_HOST = "api.github.com";
  const NAV_LINKS = [
    { label: "Kip", href: "https://app.kip-ai.com", kind: "link" },
    { label: "Support", href: "mailto:support@kip-ai.com", kind: "link" },
    { label: "Incidents", href: "https://github.com/kipfinance/kip-status/issues", kind: "button" },
  ];

  const components = [
    {
      id: "login_authentication",
      slug: "login-authentication",
      name: "Login and authentication",
      cadence: "Every 10 minutes",
      scope: "Login probe",
    },
    {
      id: "vault_document_upload",
      slug: "vault-document-upload",
      name: "Vault and document upload",
      cadence: "Every 10 minutes",
      scope: "Upload probe",
    },
    {
      id: "document_processing",
      slug: "document-processing",
      name: "Document processing",
      cadence: "Daily",
      scope: "Document probe",
    },
    {
      id: "tax_engine_artifacts",
      slug: "tax-engine-artifacts",
      name: "Tax engine and artifacts",
      cadence: "Daily",
      scope: "Tax artifact probe",
    },
  ];

  let windowDays = 90;
  let model = null;
  let bootPromise = null;
  let renderInProgress = false;

  function urlFromResource(resource) {
    const value = typeof resource === "string" ? resource : resource?.url;
    if (!value) return null;
    try {
      return new URL(value, window.location.href || "https://status.kip-ai.com/");
    } catch {
      return null;
    }
  }

  function isUpptimeIssueRequest(resource) {
    const url = urlFromResource(resource);
    return Boolean(
      url &&
        url.hostname === GITHUB_API_HOST &&
        url.pathname === `/repos/${STATUS_REPO}/issues`
    );
  }

  function installUpptimeIssueFetchGuard() {
    if (
      typeof window === "undefined" ||
      typeof window.fetch !== "function" ||
      typeof Response === "undefined" ||
      window.fetch.__kipStatusGuarded
    ) {
      return;
    }

    const nativeFetch = window.fetch.bind(window);
    const guardedFetch = (resource, options) => {
      if (isUpptimeIssueRequest(resource)) {
        return Promise.resolve(
          new Response("[]", {
            status: 200,
            headers: { "content-type": "application/json; charset=utf-8" },
          }),
        );
      }
      return nativeFetch(resource, options);
    };
    guardedFetch.__kipStatusGuarded = true;
    window.fetch = guardedFetch;
  }

  function getApp() {
    return document.getElementById("kip-status-app");
  }

  function statusJsonUrl() {
    if (LOCAL_HOSTS.has(window.location.hostname)) {
      return "https://status.kip-ai.com/synthetic-status.json";
    }
    return "/synthetic-status.json";
  }

  function summaryUrl() {
    return `${RAW_BASE}/history/summary.json`;
  }

  function historyUrl(slug) {
    return `${RAW_BASE}/history/${slug}.yml`;
  }

  async function fetchWithFallback(url, parse, fallback) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return await parse(response);
    } catch (error) {
      console.warn(error);
      return fallback;
    }
  }

  function fetchJson(url, fallback) {
    return fetchWithFallback(url, (response) => response.json(), fallback);
  }

  function fetchText(url, fallback) {
    return fetchWithFallback(url, (response) => response.text(), fallback);
  }

  function parseYamlLine(text, key) {
    const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateTime(value) {
    if (!value) return "Not checked yet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not checked yet";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown date";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(date, count) {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + count);
    return next;
  }

  function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  function formatDuration(ms) {
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "No sample";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} sec`;
    return `${Math.round(ms / 60000)} min`;
  }

  function minutesLabel(minutes) {
    if (!minutes) return "No downtime recorded";
    if (minutes === 1) return "1 minute down";
    if (minutes < 60) return `${minutes} minutes down`;
    const hours = minutes / 60;
    return `${hours.toFixed(hours < 10 ? 1 : 0)} hours down`;
  }

  function stateForComponent(snapshot, now) {
    if (!snapshot || snapshot.status === "down") return "down";
    const expiresAt = Date.parse(snapshot.expires_at || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return "warn";
    return "ok";
  }

  function stateLabel(state) {
    if (state === "down") return "Down";
    if (state === "warn") return "Monitoring delayed";
    return "Operational";
  }

  function barState(minutesDown, isBeforeStart) {
    if (isBeforeStart) return "none";
    if (!minutesDown) return "good";
    if (minutesDown >= 1440) return "down";
    if (minutesDown >= 60) return "degraded";
    return "partial";
  }

  function buildBars(componentModel, days, todayDate = new Date()) {
    const today = startOfUtcDay(todayDate);
    const firstDay = addDays(today, -(days - 1));
    const startTime = componentModel.startTime ? Date.parse(componentModel.startTime) : null;
    const startDay = Number.isFinite(startTime) ? startOfUtcDay(new Date(startTime)) : null;
    const downByDay = componentModel.summary?.dailyMinutesDown || {};
    const bars = [];

    for (let index = 0; index < days; index += 1) {
      const day = addDays(firstDay, index);
      const dateKey = isoDate(day);
      const minutesDown = Number(downByDay[dateKey] || 0);
      const isBeforeStart = startDay ? day < startDay : false;
      const state = barState(minutesDown, isBeforeStart);
      const label = isBeforeStart
        ? `${formatDate(day)}: no monitor data yet`
        : `${formatDate(day)}: ${minutesLabel(minutesDown)}`;
      bars.push({ dateKey, state, label, today: index === days - 1 });
    }
    return bars;
  }

  function uptimeFor(componentModel) {
    const raw = componentModel.summary?.uptime;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return "Unknown";
  }

  function monitoredSince(componentModel) {
    return componentModel.startTime ? `Since ${formatDate(componentModel.startTime)}` : "Monitoring history unavailable";
  }

  function resultForRow(row) {
    if (row.state === "down") return "Check failed.";
    if (row.id === "login_authentication") return "Login check passed.";
    if (row.id === "vault_document_upload") return "Upload check passed.";
    if (row.id === "document_processing") return "Document processing check passed.";
    if (row.id === "tax_engine_artifacts") return "Tax artifact check passed.";
    return "Check passed.";
  }

  async function loadModel() {
    const [status, summary] = await Promise.all([
      fetchJson(statusJsonUrl(), null),
      fetchJson(summaryUrl(), []),
    ]);

    const historyTexts = await Promise.all(
      components.map((component) => fetchText(historyUrl(component.slug), "")),
    );
    const summariesBySlug = new Map((Array.isArray(summary) ? summary : []).map((item) => [item.slug, item]));

    const now = new Date();
    const rows = components.map((component, index) => {
      const snapshot = status?.components?.[component.id] || null;
      const historyText = historyTexts[index] || "";
      const state = stateForComponent(snapshot, now);
      return {
        ...component,
        snapshot,
        summary: summariesBySlug.get(component.slug) || null,
        state,
        startTime: parseYamlLine(historyText, "startTime"),
        lastUpdated: parseYamlLine(historyText, "lastUpdated"),
      };
    });

    const hasDown = rows.some((row) => row.state === "down");
    const hasWarn = rows.some((row) => row.state === "warn");

    return {
      status,
      rows,
      overall: hasDown ? "down" : hasWarn ? "warn" : "ok",
      loadedAt: now,
    };
  }

  function renderBanner(data) {
    const downRows = data.rows.filter((row) => row.state === "down");
    const warnRows = data.rows.filter((row) => row.state === "warn");
    const alertClass = data.overall === "down" ? "ks-alert-down" : data.overall === "warn" ? "ks-alert-warn" : "ks-alert-ok";
    const title = data.overall === "down"
        ? "Service disruption"
        : data.overall === "warn"
          ? "Monitoring delayed"
          : "All systems operational";
    const summary = data.overall === "down"
        ? `${downRows.map((row) => row.name).join(", ")} unavailable.`
        : data.overall === "warn"
          ? `${warnRows.map((row) => row.name).join(", ")} checks are delayed.`
          : "All checks are passing.";
    const timestamp = data.status?.checked_at
      ? `Status snapshot generated ${formatDateTime(data.status.checked_at)}.`
      : `Loaded ${formatDateTime(data.loadedAt.toISOString())}.`;

    return `
      <section class="ks-alert ${alertClass}">
        <div class="ks-alert-head">
          <h2 class="ks-alert-title">${escapeHtml(title)}</h2>
          <a class="ks-button" href="mailto:support@kip-ai.com?subject=Kip%20status%20updates">Subscribe</a>
        </div>
        <div class="ks-alert-body">
          <p class="ks-alert-summary">${escapeHtml(summary)}</p>
          <div class="ks-alert-time">${escapeHtml(timestamp)}</div>
          <div class="ks-alert-meta">
            <a class="ks-chip" href="https://github.com/kipfinance/kip-status/issues">Incident history</a>
            <a class="ks-chip" href="https://github.com/kipfinance/kip-status/tree/main/history">Uptime history</a>
            <span class="ks-chip">10 min checks</span>
            <span class="ks-chip">Daily checks</span>
          </div>
        </div>
      </section>
    `;
  }

  function renderBars(row) {
    return buildBars(row, windowDays)
      .map(
        (bar) => `
          <button
            class="ks-bar ks-bar-${bar.state}${bar.today ? " ks-bar-today" : ""}"
            type="button"
            title="${escapeHtml(bar.label)}"
            aria-label="${escapeHtml(bar.label)}"
          ></button>
        `,
      )
      .join("");
  }

  function renderRow(row) {
    const state = stateLabel(row.state);
    const stateClass = row.state === "down" ? "ks-state-down" : row.state === "warn" ? "ks-state-warn" : "";
    const snapshot = row.snapshot || {};
    const duration = formatDuration(snapshot.duration_ms);
    const checkedAt = formatDateTime(snapshot.checked_at || row.lastUpdated);
    const expiresAt = snapshot.expires_at ? formatDateTime(snapshot.expires_at) : "No freshness window";
    const summary = resultForRow(row);
    const subtitle = [row.cadence, row.scope].filter(Boolean).join(" · ");

    return `
      <article class="ks-row">
        <div class="ks-row-top">
          <div>
            <h3 class="ks-row-title">${escapeHtml(row.name)}</h3>
            <p class="ks-row-subtitle">${escapeHtml(subtitle)}</p>
          </div>
          <div class="ks-state ${stateClass}">${escapeHtml(state)}</div>
        </div>
        <div class="ks-bars" aria-label="${escapeHtml(row.name)} uptime over ${windowDays} days">
          ${renderBars(row)}
        </div>
        <div class="ks-scale">
          <span>${windowDays} days ago</span>
          <span class="ks-scale-line" aria-hidden="true"></span>
          <span>${escapeHtml(uptimeFor(row))} uptime</span>
          <span class="ks-scale-line" aria-hidden="true"></span>
          <span>Today</span>
        </div>
        <div class="ks-details">
          <div class="ks-detail">
            <span>Check time</span>
            <strong>${escapeHtml(duration)}</strong>
          </div>
          <div class="ks-detail">
            <span>Last checked</span>
            <strong>${escapeHtml(checkedAt)}</strong>
          </div>
          <div class="ks-detail">
            <span>Valid until</span>
            <strong>${escapeHtml(expiresAt)}</strong>
          </div>
          <div class="ks-detail">
            <span>Result</span>
            <strong>${escapeHtml(summary)}</strong>
          </div>
        </div>
        <p class="ks-row-subtitle">${escapeHtml(monitoredSince(row))}</p>
      </article>
    `;
  }

  function renderShell(data) {
    return `
      <header class="ks-topbar">
        <div class="ks-wrap ks-nav">
          <a class="ks-brand" href="https://status.kip-ai.com">
            <span class="ks-mark" aria-hidden="true">K</span>
            <span>Kip Status</span>
          </a>
          <nav class="ks-actions" aria-label="Status navigation">
            ${NAV_LINKS.map((link) => `
              <a class="${link.kind === "button" ? "ks-button" : "ks-link"}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
            `).join("")}
          </nav>
        </div>
      </header>
      <main>
        <section class="ks-wrap ks-hero">
          <p class="ks-eyebrow">Status</p>
          <h1 class="ks-title">Kip Status</h1>
          <p class="ks-subtitle">
            Current status and uptime history for Kip services.
          </p>
        </section>
        <div class="ks-wrap">
          ${renderBanner(data)}
          <div class="ks-section-head">
            <div>
              <h2>Uptime over the past ${windowDays} days</h2>
              <p class="ks-section-note">View historical uptime.</p>
            </div>
            <div class="ks-window-switch" aria-label="Choose history window">
              ${[7, 30, 90]
                .map(
                  (days) => `
                    <button class="ks-window-button" type="button" data-days="${days}" aria-pressed="${days === windowDays}">
                      ${days}d
                    </button>
                  `,
                )
                .join("")}
            </div>
          </div>
          <section class="ks-components">
            ${data.rows.map(renderRow).join("")}
          </section>
          <div class="ks-legend" aria-label="Uptime legend">
            <span class="ks-legend-item"><span class="ks-dot ks-dot-good"></span>Operational</span>
            <span class="ks-legend-item"><span class="ks-dot ks-dot-partial"></span>Brief downtime</span>
            <span class="ks-legend-item"><span class="ks-dot ks-dot-degraded"></span>Extended downtime</span>
            <span class="ks-legend-item"><span class="ks-dot ks-dot-down"></span>Unavailable</span>
            <span class="ks-legend-item"><span class="ks-dot ks-dot-none"></span>No monitor data</span>
          </div>
        </div>
      </main>
      <footer class="ks-wrap ks-footer">
        Powered by Kip synthetic checks and Upptime.
      </footer>
    `;
  }

  function attachEvents() {
    const app = getApp();
    if (!app) return;
    app.querySelectorAll("[data-days]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextDays = Number(button.getAttribute("data-days"));
        if (!Number.isFinite(nextDays) || nextDays === windowDays) return;
        windowDays = nextDays;
        render();
      });
    });
  }

  function render() {
    const app = getApp();
    if (!model) return;
    if (!app) return;
    renderInProgress = true;
    try {
      app.innerHTML = renderShell(model);
      attachEvents();
    } finally {
      renderInProgress = false;
    }
  }

  function ensureRendered() {
    if (renderInProgress) return;
    const app = getApp();
    if (!app) return;
    if (model) {
      if (!app.querySelector(".ks-row")) render();
      return;
    }
    boot();
  }

  async function boot() {
    const app = getApp();
    if (!app) return;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      try {
        model = await loadModel();
        render();
      } catch (error) {
        console.error(error);
        const currentApp = getApp();
        if (!currentApp) return;
        currentApp.innerHTML = `
          <div class="ks-error">
            <div class="ks-mark" aria-hidden="true">K</div>
            <div>
              <strong>Status page could not load</strong>
              <span>Contact support@kip-ai.com.</span>
            </div>
          </div>
        `;
      } finally {
        bootPromise = null;
      }
    })();
    return bootPromise;
  }

  if (typeof window !== "undefined" && window.__KIP_STATUS_TEST__) {
    window.__kipStatusTestUtils = {
      barState,
      buildBars,
      isUpptimeIssueRequest,
      resultForRow,
      stateForComponent,
    };
  }

  installUpptimeIssueFetchGuard();
  boot();

  if (typeof window !== "undefined") {
    if (typeof window.addEventListener === "function") {
      window.addEventListener("DOMContentLoaded", ensureRendered);
      window.addEventListener("load", ensureRendered);
    }
    if (typeof window.setTimeout === "function") {
      window.setTimeout(ensureRendered, 500);
      window.setTimeout(ensureRendered, 1500);
    }
  }

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      if (!model || renderInProgress) return;
      if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
        window.setTimeout(ensureRendered, 0);
      } else {
        ensureRendered();
      }
    });
    const observe = () => {
      const sapper = document.getElementById("sapper");
      if (sapper) observer.observe(sapper, { childList: true, subtree: true });
    };
    if (document.readyState === "loading" && typeof document.addEventListener === "function") {
      document.addEventListener("DOMContentLoaded", observe, { once: true });
    } else {
      observe();
    }
  }
})();
