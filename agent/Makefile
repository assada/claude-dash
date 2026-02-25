BINARY=ccdash-agent
VERSION=$(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
LDFLAGS=-ldflags "-s -w -X main.version=$(VERSION)"

.PHONY: all build clean linux-amd64 linux-arm64 darwin-arm64

all: build

build:
	go build $(LDFLAGS) -o $(BINARY) .

linux-amd64:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o $(BINARY)-linux-amd64 .

linux-arm64:
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o $(BINARY)-linux-arm64 .

darwin-arm64:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o $(BINARY)-darwin-arm64 .

cross: linux-amd64 linux-arm64 darwin-arm64

clean:
	rm -f $(BINARY) $(BINARY)-*

test:
	go test -v ./...
