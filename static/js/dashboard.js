/**
 * AKS Dashboard — Logique Frontend
 * Appels API vers le backend Flask, rendu dynamique, filtrage.
 */

"use strict";

// ================================================================
// État global
// ================================================================
let allPods        = [];
let allDeployments = [];
let autoRefreshTimer = null;
const AUTO_REFRESH_MS = 30_000; // rafraîchissement toutes les 30 s

// ================================================================
// Navigation entre sections
// ================================================================
document.querySelectorAll(".sidebar-link[data-section]").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    navigate(link.dataset.section);
    document.getElementById("sidebar").classList.remove("open");
  });
});

function navigate(section) {
  document.querySelectorAll(".sidebar-link").forEach(l => l.classList.remove("active"));
  document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));

  const link = document.querySelector(`.sidebar-link[data-section="${section}"]`);
  if (link) link.classList.add("active");

  const el = document.getElementById(`section-${section}`);
  if (el) el.classList.add("active");

  if (section === "pods")        loadPods();
  if (section === "deployments") loadDeployments();
  if (section === "nodes")       loadNodes();
}

// Sidebar mobile
const sidebarToggle = document.getElementById("sidebar-toggle");
if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () =>
    document.getElementById("sidebar").classList.toggle("open")
  );
}

// ================================================================
// Utilitaires UI
// ================================================================

function showError(msg) {
  document.getElementById("error-message").textContent = msg;
  document.getElementById("error-banner").classList.remove("d-none");
  console.error("[Dashboard]", msg);
}

function hideError() {
  document.getElementById("error-banner").classList.add("d-none");
}

function updateTimestamp() {
  const el = document.getElementById("last-update");
  if (el) {
    el.innerHTML = `<i class="fa-regular fa-clock me-1"></i>Mis à jour à ${new Date().toLocaleTimeString("fr-FR")}`;
  }
}

function setBtnLoading(loading) {
  const btn = document.getElementById("btn-refresh");
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner-border spinner-border-sm me-1"></span>Chargement…'
    : '<i class="fa-solid fa-rotate-right me-1"></i>Rafraîchir';
}

// Classe CSS de badge selon le namespace
function nsBadgeClass(ns) {
  if (ns === "default")     return "ns-default";
  if (ns === "kube-system") return "ns-kube-system";
  return "ns-other";
}

// Badge coloré selon le statut du pod
function statusBadge(status) {
  const s = (status || "").toLowerCase();
  let cls = "status-unknown";

  if (s === "running")                cls = "status-running";
  else if (s === "pending")           cls = "status-pending";
  else if (s === "failed")            cls = "status-failed";
  else if (s === "terminating")       cls = "status-terminating";
  else if (s === "crashloopbackoff")  cls = "status-crashloop";
  else if (s === "containercreating") cls = "status-pending";
  else if (s === "oomkilled")         cls = "status-failed";

  return `<span class="status-badge ${cls}"><span class="dot"></span>${status}</span>`;
}

// ================================================================
// API — Vue d'ensemble
// ================================================================
async function loadOverview() {
  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Cartes statistiques
    const readyNodes = data.nodes ? data.nodes.filter(n => n.status === "Ready").length : 0;
    document.getElementById("stat-nodes").textContent       = readyNodes;
    document.getElementById("stat-running").textContent     = data.running_pods ?? "—";
    document.getElementById("stat-total-pods").textContent  = data.total_pods   ?? "—";

    // Version K8s (depuis le premier nœud)
    const version = data.nodes?.[0]?.version ?? "";
    document.getElementById("stat-version").textContent = version.replace(/^v/, "") || "—";

    // Tableau infos cluster
    document.getElementById("cluster-info-loading").classList.add("d-none");
    document.getElementById("cluster-info-table").classList.remove("d-none");
    document.getElementById("ci-name").textContent   = data.cluster_name   || "—";
    document.getElementById("ci-rg").textContent     = data.resource_group || "—";
    document.getElementById("ci-region").textContent = data.region          || "—";
    document.getElementById("ci-nginx").textContent  = data.nginx_ip        || "—";
    document.getElementById("ci-pods").textContent   = `${data.running_pods} / ${data.total_pods} en cours`;

  } catch (err) {
    showError(`Impossible de charger l'état du cluster : ${err.message}`);
  }
}

// ================================================================
// API — Pods
// ================================================================
async function loadPods() {
  const loading = document.getElementById("pods-loading");
  const wrapper = document.getElementById("pods-table-wrapper");
  const empty   = document.getElementById("pods-empty");

  loading.classList.remove("d-none");
  wrapper.classList.add("d-none");
  empty.classList.add("d-none");

  try {
    const resp = await fetch("/api/pods");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allPods = await resp.json();

    // Peupler le filtre namespace
    const namespaces = [...new Set(allPods.map(p => p.namespace))].sort();
    const nsSelect   = document.getElementById("ns-filter");
    const prevValue  = nsSelect.value;
    nsSelect.innerHTML = '<option value="">Tous les namespaces</option>';
    namespaces.forEach(ns => {
      const opt = new Option(ns, ns, ns === prevValue, ns === prevValue);
      nsSelect.appendChild(opt);
    });

    document.getElementById("nav-pod-count").textContent = allPods.length;

    loading.classList.add("d-none");
    renderPods(allPods);
  } catch (err) {
    loading.classList.add("d-none");
    showError(`Impossible de charger les pods : ${err.message}`);
  }
}

function renderPods(pods) {
  const wrapper = document.getElementById("pods-table-wrapper");
  const empty   = document.getElementById("pods-empty");
  const tbody   = document.getElementById("pods-tbody");
  const label   = document.getElementById("pod-count-label");

  label.textContent = `${pods.length} pod${pods.length !== 1 ? "s" : ""}`;

  if (!pods.length) {
    empty.classList.remove("d-none");
    wrapper.classList.add("d-none");
    return;
  }

  tbody.innerHTML = pods.map(p => {
    // Raccourcir le nom du nœud pour l'affichage
    const nodeShort = p.node
      ? p.node.replace("aks-agentpool-", "…pool-").slice(0, 30)
      : "—";

    const restartBadge = p.restarts > 0
      ? `<span class="badge bg-warning-subtle text-warning-emphasis">${p.restarts}</span>`
      : `<span class="text-muted">0</span>`;

    return `<tr>
      <td><span class="ns-badge ${nsBadgeClass(p.namespace)}">${p.namespace}</span></td>
      <td class="fw-medium text-break">${p.name}</td>
      <td>${statusBadge(p.status)}</td>
      <td><span class="font-monospace">${p.ready}</span></td>
      <td>${restartBadge}</td>
      <td class="text-muted">${p.age}</td>
      <td><span class="text-muted small">${nodeShort}</span></td>
    </tr>`;
  }).join("");

  wrapper.classList.remove("d-none");
  empty.classList.add("d-none");
}

function filterPods() {
  const search = document.getElementById("pod-search").value.toLowerCase().trim();
  const ns     = document.getElementById("ns-filter").value;
  const status = document.getElementById("status-filter").value;

  const filtered = allPods.filter(p =>
    (!search || p.name.toLowerCase().includes(search) || p.namespace.toLowerCase().includes(search)) &&
    (!ns     || p.namespace === ns) &&
    (!status || p.status    === status)
  );

  renderPods(filtered);
}

// ================================================================
// API — Deployments
// ================================================================
async function loadDeployments() {
  const loading = document.getElementById("deploy-loading");
  const wrapper = document.getElementById("deploy-table-wrapper");

  loading.classList.remove("d-none");
  wrapper.classList.add("d-none");

  try {
    const resp = await fetch("/api/deployments");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    allDeployments = await resp.json();

    const tbody = document.getElementById("deploy-tbody");
    tbody.innerHTML = allDeployments.map(d => {
      // BUG FIX : ready / available peuvent être null → forcer à 0
      const ready     = d.ready     ?? 0;
      const available = d.available ?? 0;
      const desired   = d.desired   ?? 0;
      const pct       = desired > 0 ? Math.round((ready / desired) * 100) : 0;
      const isHealthy = ready >= desired && desired > 0;

      const statBadge = isHealthy
        ? `<span class="status-badge status-running"><span class="dot"></span>Healthy</span>`
        : `<span class="status-badge status-pending"><span class="dot"></span>Degraded</span>`;

      return `<tr>
        <td><span class="ns-badge ${nsBadgeClass(d.namespace)}">${d.namespace}</span></td>
        <td class="fw-medium">${d.name}</td>
        <td class="text-center">${desired}</td>
        <td>
          <span class="fw-semibold ${isHealthy ? "text-success" : "text-warning"}">${ready}</span>
          <div class="replica-bar">
            <div class="replica-fill" style="width:${pct}%;background:${isHealthy ? "#16a34a" : "#f59e0b"}"></div>
          </div>
        </td>
        <td>${available}</td>
        <td class="text-muted">${d.age}</td>
        <td>${statBadge}</td>
      </tr>`;
    }).join("");

    loading.classList.add("d-none");
    wrapper.classList.remove("d-none");
  } catch (err) {
    loading.classList.add("d-none");
    showError(`Impossible de charger les deployments : ${err.message}`);
  }
}

// ================================================================
// API — Nœuds
// ================================================================
async function loadNodes() {
  const loading   = document.getElementById("nodes-loading");
  const container = document.getElementById("nodes-container");

  loading.classList.remove("d-none");
  container.innerHTML = "";

  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    loading.classList.add("d-none");

    if (!data.nodes?.length) {
      container.innerHTML = '<div class="col-12 text-center text-muted py-5">Aucun nœud trouvé.</div>';
      return;
    }

    container.innerHTML = data.nodes.map(n => {
      const isReady = n.status === "Ready";
      // memory en Ki → GiB  (ex: "3931352Ki" → 3.75 GiB)
      const memStr = n.memory ? n.memory.replace(/Ki$/, "") : "0";
      const memGB  = (parseInt(memStr, 10) / 1_048_576).toFixed(2) + " GiB";

      return `<div class="col-md-6 col-xl-4">
        <div class="node-card">
          <div class="d-flex align-items-center justify-content-between mb-3">
            <div class="d-flex align-items-center gap-2">
              <span class="node-status-indicator" style="background:${isReady ? "#16a34a" : "#dc2626"}"></span>
              <span class="fw-semibold">Nœud Worker</span>
            </div>
            <span class="badge ${isReady
              ? "bg-success-subtle text-success-emphasis border border-success-subtle"
              : "bg-danger-subtle text-danger-emphasis border border-danger-subtle"}">
              ${n.status}
            </span>
          </div>
          <div class="node-detail-row">
            <span>Nom</span>
            <span class="text-muted small" style="word-break:break-all;text-align:right;max-width:170px">${n.name}</span>
          </div>
          <div class="node-detail-row">
            <span>Version Kubelet</span>
            <code>${n.version}</code>
          </div>
          <div class="node-detail-row">
            <span>Système d'exploitation</span>
            <span class="small">${n.os}</span>
          </div>
          <div class="node-detail-row">
            <span>CPU</span>
            <strong>${n.cpu} vCPU</strong>
          </div>
          <div class="node-detail-row">
            <span>Mémoire</span>
            <strong>${memGB}</strong>
          </div>
          <div class="node-detail-row">
            <span>Âge</span>
            <span>${n.age}</span>
          </div>
        </div>
      </div>`;
    }).join("");

  } catch (err) {
    loading.classList.add("d-none");
    showError(`Impossible de charger les nœuds : ${err.message}`);
  }
}

// ================================================================
// Test Nginx — appel réel HTTP via l'endpoint dédié du backend
// ================================================================
async function checkNginx() {
  const el = document.getElementById("nginx-health");
  el.innerHTML = '<span class="text-muted"><i class="fa-solid fa-spinner fa-spin me-1"></i>Test HTTP en cours…</span>';

  try {
    const resp = await fetch("/api/nginx-health", { signal: AbortSignal.timeout(8000) });
    const data = await resp.json();

    if (data.status === "ok") {
      el.innerHTML = `<span class="text-success">
        <i class="fa-solid fa-circle-check me-1"></i>
        Nginx répond HTTP ${data.http_code} · Serveur : ${data.server}
      </span>`;
    } else {
      el.innerHTML = `<span class="text-danger">
        <i class="fa-solid fa-circle-xmark me-1"></i>${data.message}
      </span>`;
    }
  } catch (err) {
    el.innerHTML = `<span class="text-danger">
      <i class="fa-solid fa-circle-xmark me-1"></i>Erreur : ${err.message}
    </span>`;
  }

  setTimeout(() => { el.innerHTML = ""; }, 6000);
}

// ================================================================
// Rafraîchissement global (bouton + auto)
// ================================================================
async function refreshAll() {
  setBtnLoading(true);
  hideError();

  try {
    await loadOverview();

    const activeId = document.querySelector(".content-section.active")?.id;
    if (activeId === "section-pods")        await loadPods();
    if (activeId === "section-deployments") await loadDeployments();
    if (activeId === "section-nodes")       await loadNodes();

    updateTimestamp();
  } finally {
    setBtnLoading(false);
  }
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(refreshAll, AUTO_REFRESH_MS);
}

// ================================================================
// Initialisation
// ================================================================
(async function init() {
  await loadOverview();
  updateTimestamp();
  startAutoRefresh();
})();
