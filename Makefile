.DEFAULT_GOAL := help
.PHONY: help setup run down restart status health smoke check

PORT ?= 8137
BASE := http://localhost:$(PORT)
PID := .server.pid
# Memory ceiling for the test gate, in MB. Raise it for a bigger run:
#   make check CHECK_MEM_MB=4096
CHECK_MEM_MB ?= 1024
CAP := $(shell systemd-run --user --scope -q true 2>/dev/null && echo "systemd-run --user --scope -q -p MemoryMax=$(CHECK_MEM_MB)M -p MemorySwapMax=0")

help:  ## List targets
	@grep -E '^[a-z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n",$$1,$$2}'

setup:  ## Check the two tools this project needs (node, python3)
	@command -v node >/dev/null || { echo "node is required (tests)"; exit 1; }
	@command -v python3 >/dev/null || { echo "python3 is required (local server)"; exit 1; }
	@echo "setup: OK (no dependency to install, no secret needed)"

define wait_health
	@for i in $$(seq 1 40); do \
	   curl -sf -o /dev/null $(BASE)/index.html && { echo "serving on $(BASE)"; exit 0; }; sleep 0.25; \
	 done; echo "no answer on $(BASE) after 10 s. Read: .server.log"; exit 1
endef

run:  ## Serve the app on http://localhost:8137 (PORT=… to change)
	@if [ -f $(PID) ] && kill -0 $$(cat $(PID)) 2>/dev/null; then echo "already running"; else \
	   python3 -m http.server $(PORT) --bind 127.0.0.1 >.server.log 2>&1 & echo $$! >$(PID); fi
	$(call wait_health)

down:  ## Stop the local server
	@if [ -f $(PID) ]; then kill $$(cat $(PID)) 2>/dev/null || true; rm -f $(PID); fi; echo "stopped"

restart:  ## Stop, then serve again
	@$(MAKE) --no-print-directory down
	@$(MAKE) --no-print-directory run

status:  ## Say whether the local server is running
	@if [ -f $(PID) ] && kill -0 $$(cat $(PID)) 2>/dev/null; then echo "running on $(BASE)"; else echo "stopped"; fi

health:  ## Fetch the page once
	@curl -sf -o /dev/null -w "%{http_code} $(BASE)/\n" $(BASE)/

smoke:  ## Prove the served page and every file it loads answer
	@for f in index.html sw.js manifest.webmanifest icons/icon.svg css/styles.css \
	          $$(grep -o 'js/[a-z]*\.js' index.html); do \
	   curl -sf -o /dev/null $(BASE)/$$f || { echo "smoke: FAILED on $$f (is 'make run' up?)"; exit 1; }; \
	 done; echo "smoke: OK"

check:  ## Run every test (memory-capped), the gate CI runs
	@[ -n "$(CAP)" ] || echo "NOTE: no systemd user scope here, tests run without the memory cap"
	$(CAP) node --test tests/*.test.js
