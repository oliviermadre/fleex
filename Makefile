NAMESPACE      := asm-dev
INGRESS_MANIFEST := https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.0/deploy/static/provider/kind/deploy.yaml

# Derive worktree name from current directory
WORKTREE_NAME  := $(shell basename "$$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
APP_NAME       := asm-$(WORKTREE_NAME)
HOSTNAME       := $(WORKTREE_NAME).127.0.0.1.nip.io

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
	@printf "  make status           Show this worktree's pods/services/ingress\n"
	@printf "  make logs             Tail logs for this worktree\n"
	@printf "  make list             List all deployed worktrees\n"
