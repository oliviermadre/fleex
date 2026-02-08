# ===========================================================================
# Agent Session Manager — local K8s dev environment
# ===========================================================================
#
# Quick-start:
#   make cluster-create   # one-time: bootstrap Kind + Ingress
#   make dev              # start Tilt (live-reload dev loop)
#   make dev-down         # tear down Tilt resources
#   make cluster-delete   # destroy the Kind cluster
#

CLUSTER_NAME   := asm-dev
KIND_CONFIG    := k8s/kind-config.yaml
NAMESPACE      := asm-dev
INGRESS_MANIFEST := https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.0/deploy/static/provider/kind/deploy.yaml

# Derive worktree name from current directory
WORKTREE_NAME  := $(shell basename "$$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
APP_NAME       := asm-$(WORKTREE_NAME)
HOSTNAME       := $(WORKTREE_NAME).127.0.0.1.nip.io

# ---- Prerequisites --------------------------------------------------------

.PHONY: check-prereqs
check-prereqs:
	@printf "Checking prerequisites…\n"
	@which docker  >/dev/null 2>&1 || { printf "  ✗ docker not found\n";  exit 1; }
	@which kind    >/dev/null 2>&1 || { printf "  ✗ kind not found\n";    exit 1; }
	@which kubectl >/dev/null 2>&1 || { printf "  ✗ kubectl not found\n"; exit 1; }
	@which tilt    >/dev/null 2>&1 || { printf "  ✗ tilt not found\n";    exit 1; }
	@printf "  All prerequisites OK\n"

# ---- Cluster lifecycle ----------------------------------------------------

.PHONY: cluster-create
cluster-create: check-prereqs
	@printf "Creating Kind cluster '$(CLUSTER_NAME)'…\n"
	kind create cluster --name $(CLUSTER_NAME) --config $(KIND_CONFIG)
	@printf "Installing NGINX Ingress Controller…\n"
	kubectl apply -f $(INGRESS_MANIFEST)
	@printf "Waiting for Ingress Controller deployment to roll out…\n"
	kubectl rollout status deployment/ingress-nginx-controller -n ingress-nginx --timeout=120s
	kubectl create namespace $(NAMESPACE) --dry-run=client -o yaml | kubectl apply -f -
	@printf "\nCluster ready. Run 'make dev' from any worktree.\n"

.PHONY: cluster-delete
cluster-delete:
	kind delete cluster --name $(CLUSTER_NAME)

.PHONY: cluster-status
cluster-status:
	@kubectl cluster-info --context kind-$(CLUSTER_NAME) 2>/dev/null || printf "Cluster '$(CLUSTER_NAME)' not running.\n"

# ---- Development with Tilt ------------------------------------------------

.PHONY: dev
dev:
	tilt up

.PHONY: dev-down
dev-down:
	tilt down

# ---- Manual deploy (without Tilt) -----------------------------------------

.PHONY: deploy
deploy:
	docker build -t $(APP_NAME):latest -f Dockerfile.dev .
	kind load docker-image $(APP_NAME):latest --name $(CLUSTER_NAME)
	@printf "Image loaded into cluster. Apply manifests with kubectl.\n"

.PHONY: undeploy
undeploy:
	kubectl delete deployment,service,ingress $(APP_NAME) -n $(NAMESPACE) --ignore-not-found

# ---- Status / info ---------------------------------------------------------

.PHONY: status
status:
	@printf "Worktree : $(WORKTREE_NAME)\n"
	@printf "App      : $(APP_NAME)\n"
	@printf "URL      : http://$(HOSTNAME)\n\n"
	@kubectl get pods,svc,ingress -n $(NAMESPACE) -l app=$(APP_NAME) 2>/dev/null || true

.PHONY: logs
logs:
	kubectl logs -n $(NAMESPACE) -l app=$(APP_NAME) -f --all-containers

.PHONY: list
list:
	@printf "All ASM deployments in namespace '$(NAMESPACE)':\n\n"
	@kubectl get deployments -n $(NAMESPACE) -o custom-columns='NAME:.metadata.name,READY:.status.readyReplicas,IMAGE:.spec.template.spec.containers[0].image' 2>/dev/null || true
	@printf "\nIngress rules:\n\n"
	@kubectl get ingress -n $(NAMESPACE) -o custom-columns='NAME:.metadata.name,HOST:.spec.rules[0].host' 2>/dev/null || true

# ---- Help ------------------------------------------------------------------

.PHONY: help
help:
	@printf "Usage:\n"
	@printf "  make cluster-create   Create Kind cluster + install Ingress\n"
	@printf "  make cluster-delete   Destroy the Kind cluster\n"
	@printf "  make cluster-status   Show cluster info\n"
	@printf "  make dev              Start Tilt (live-reload dev loop)\n"
	@printf "  make dev-down         Tear down Tilt resources\n"
	@printf "  make deploy           Build image & load into cluster (no Tilt)\n"
	@printf "  make undeploy         Remove this worktree from cluster\n"
	@printf "  make status           Show this worktree's pods/services/ingress\n"
	@printf "  make logs             Tail logs for this worktree\n"
	@printf "  make list             List all deployed worktrees\n"
	@printf "  make check-prereqs    Verify tools are installed\n"
