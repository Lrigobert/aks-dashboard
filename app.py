"""
AKS Dashboard — Backend Flask
Expose des endpoints REST pour visualiser le cluster Kubernetes.
"""

from flask import Flask, jsonify, render_template
import subprocess
import json
import urllib.request
import urllib.error
from datetime import datetime, timezone

app = Flask(__name__)

NGINX_IP     = "51.11.206.29"
CLUSTER_NAME = "aks-tp-cluster"
RESOURCE_GROUP = "rg-aks-tp"
REGION       = "francecentral"


# ------------------------------------------------------------------
# Utilitaires
# ------------------------------------------------------------------

def run_kubectl(args: list) -> tuple:
    """
    Exécute une commande kubectl et retourne (dict, None) ou (None, message_erreur).
    Garantit que le premier élément est toujours un dict ou None, jamais une string.
    """
    try:
        result = subprocess.run(
            ["kubectl"] + args,
            capture_output=True,
            text=True,
            timeout=15
        )
        if result.returncode != 0:
            return None, result.stderr.strip() or "kubectl a retourné une erreur."
        try:
            return json.loads(result.stdout), None
        except json.JSONDecodeError:
            # Ne devrait pas arriver avec -o json, mais protection défensive
            return None, f"Réponse kubectl non-JSON : {result.stdout[:200]}"
    except subprocess.TimeoutExpired:
        return None, "Timeout : kubectl n'a pas répondu dans les délais."
    except FileNotFoundError:
        return None, "kubectl introuvable. Vérifiez votre installation."
    except Exception as e:
        return None, str(e)


def age_from_timestamp(ts: str) -> str:
    """Calcule l'âge lisible depuis un timestamp ISO 8601 Kubernetes."""
    try:
        created = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        delta   = datetime.now(timezone.utc) - created
        j       = delta.days
        h       = delta.seconds // 3600
        m       = (delta.seconds % 3600) // 60
        if j > 0:
            return f"{j}j{h}h"
        if h > 0:
            return f"{h}h{m}m"
        return f"{m}m"
    except Exception:
        return "?"


def pod_phase_label(pod: dict) -> str:
    """
    Détermine le statut précis d'un pod.
    Gère : Terminating, CrashLoopBackOff, ContainerCreating, etc.
    """
    status = pod.get("status", {})
    phase  = status.get("phase", "Unknown")

    if pod.get("metadata", {}).get("deletionTimestamp"):
        return "Terminating"

    for cs in status.get("containerStatuses", []):
        waiting = cs.get("state", {}).get("waiting", {})
        if waiting:
            return waiting.get("reason", phase)

    return phase


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------

@app.route("/")
def index():
    """Sert la page principale du dashboard."""
    return render_template("index.html", nginx_ip=NGINX_IP)


@app.route("/api/pods")
def api_pods():
    """Retourne la liste de tous les pods (tous namespaces)."""
    data, err = run_kubectl(["get", "pods", "--all-namespaces", "-o", "json"])
    if err:
        return jsonify({"error": err}), 500

    pods = []
    for item in data.get("items", []):
        meta    = item.get("metadata", {})
        status  = item.get("status", {})
        spec    = item.get("spec", {})
        cs_list = status.get("containerStatuses", [])

        ready_count = sum(1 for c in cs_list if c.get("ready", False))
        total_count = len(cs_list)
        restarts    = sum(c.get("restartCount", 0) for c in cs_list)

        pods.append({
            "name":      meta.get("name", ""),
            "namespace": meta.get("namespace", ""),
            "status":    pod_phase_label(item),
            "ready":     f"{ready_count}/{total_count}",
            "restarts":  restarts,
            "age":       age_from_timestamp(meta.get("creationTimestamp", "")),
            "node":      spec.get("nodeName", "")
        })

    order = {"default": 0, "kube-system": 1}
    pods.sort(key=lambda p: (order.get(p["namespace"], 2), p["namespace"], p["name"]))
    return jsonify(pods)


@app.route("/api/status")
def api_status():
    """Retourne l'état général du cluster (nœuds + compteurs pods)."""
    nodes_data, _ = run_kubectl(["get", "nodes", "-o", "json"])
    pods_data,  _ = run_kubectl(["get", "pods", "--all-namespaces", "-o", "json"])

    nodes = []
    if nodes_data:
        for n in nodes_data.get("items", []):
            conditions = n.get("status", {}).get("conditions", [])
            ready      = any(
                c.get("type") == "Ready" and c.get("status") == "True"
                for c in conditions
            )
            info     = n.get("status", {}).get("nodeInfo", {})
            capacity = n.get("status", {}).get("capacity", {})
            nodes.append({
                "name":    n["metadata"]["name"],
                "status":  "Ready" if ready else "NotReady",
                "version": info.get("kubeletVersion", ""),
                "os":      info.get("osImage", ""),
                "cpu":     capacity.get("cpu", "?"),
                "memory":  capacity.get("memory", "?"),
                "age":     age_from_timestamp(n["metadata"]["creationTimestamp"])
            })

    total_pods = running_pods = 0
    if pods_data:
        for p in pods_data.get("items", []):
            total_pods += 1
            if p.get("status", {}).get("phase") == "Running":
                running_pods += 1

    return jsonify({
        "cluster_name":   CLUSTER_NAME,
        "resource_group": RESOURCE_GROUP,
        "region":         REGION,
        "nginx_ip":       NGINX_IP,
        "nodes":          nodes,
        "total_pods":     total_pods,
        "running_pods":   running_pods,
        "timestamp":      datetime.now(timezone.utc).isoformat()
    })


@app.route("/api/namespaces")
def api_namespaces():
    """Retourne la liste des namespaces."""
    data, err = run_kubectl(["get", "namespaces", "-o", "json"])
    if err:
        return jsonify({"error": err}), 500
    ns = [item["metadata"]["name"] for item in data.get("items", [])]
    return jsonify(ns)


@app.route("/api/deployments")
def api_deployments():
    """Retourne la liste des Deployments (tous namespaces)."""
    data, err = run_kubectl(["get", "deployments", "--all-namespaces", "-o", "json"])
    if err:
        return jsonify({"error": err}), 500

    deployments = []
    for item in data.get("items", []):
        meta   = item.get("metadata", {})
        spec   = item.get("spec", {})
        status = item.get("status", {})

        # BUG FIX : readyReplicas / availableReplicas peuvent être None dans l'API K8s
        # (quand aucun replica n'est prêt, le champ est absent ou null)
        desired   = spec.get("replicas") or 0
        ready     = status.get("readyReplicas") or 0      # None → 0
        available = status.get("availableReplicas") or 0  # None → 0

        deployments.append({
            "name":      meta.get("name", ""),
            "namespace": meta.get("namespace", ""),
            "desired":   desired,
            "ready":     ready,
            "available": available,
            "age":       age_from_timestamp(meta.get("creationTimestamp", ""))
        })

    return jsonify(deployments)


@app.route("/api/nginx-health")
def api_nginx_health():
    """
    Teste la connectivité HTTP vers l'application nginx déployée.
    Effectue une vraie requête HTTP depuis le backend.
    """
    try:
        req  = urllib.request.urlopen(f"http://{NGINX_IP}", timeout=5)
        body = req.read(64).decode("utf-8", errors="ignore")
        return jsonify({
            "status":    "ok",
            "http_code": req.status,
            "server":    req.headers.get("Server", ""),
            "preview":   body[:40].strip()
        })
    except urllib.error.HTTPError as e:
        return jsonify({"status": "error", "http_code": e.code, "message": str(e)}), 503
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 503


# ------------------------------------------------------------------
# Point d'entrée
# ------------------------------------------------------------------

if __name__ == "__main__":
    print("=" * 52)
    print("  AKS Dashboard  —  http://localhost:5000")
    print("  Cluster  : aks-tp-cluster (francecentral)")
    print("  Nginx    : http://51.11.206.29")
    print("=" * 52)
    app.run(debug=False, host="0.0.0.0", port=5000)
