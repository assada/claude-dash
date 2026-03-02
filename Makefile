VERSION=$(shell git describe --tags --abbrev=0 2>/dev/null || echo "dev")

.PHONY: build up down agent

# Build dashboard Docker image with current git tag version
build:
	AGENT_VERSION=$(VERSION) docker compose build

# Build and start dashboard
up:
	AGENT_VERSION=$(VERSION) docker compose up -d --build dashboard

down:
	docker compose down

# Cross-compile agent binaries
agent:
	$(MAKE) -C agent cross
