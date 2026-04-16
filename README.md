# kt-connect-service

[![npm version](https://img.shields.io/npm/v/kt-connect-service.svg?style=flat-square)](https://www.npmjs.com/package/kt-connect-service)
[![GitHub stars](https://img.shields.io/github/stars/dz1922/kt-connect-service?style=flat-square)](https://github.com/dz1922/kt-connect-service/stargazers)
[![Last release](https://img.shields.io/github/release-date/dz1922/kt-connect-service?style=flat-square)](https://github.com/dz1922/kt-connect-service/releases)
[![License](https://img.shields.io/npm/l/kt-connect-service.svg?style=flat-square)](https://github.com/dz1922/kt-connect-service/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/kt-connect-service.svg?style=flat-square)](https://nodejs.org)

> **`ktcs`** — a kubectl-style CLI for [kt-connect](https://github.com/alibaba/kt-connect). Run Kubernetes local-dev VPN tunnels with auto-reconnect, readiness probing, and transactional context switching.

```bash
npm install -g kt-connect-service
sudo ktcs connect         # or: sudo ktcs switch <kubectl-context>
```

## Features

- **kubectl-aligned CLI**: `-c/--context`, `-n/--namespace`, `--kubeconfig` flags match kubectl
- **Auto-install**: ktctl binary downloads automatically on first connect
- **Switch command**: `ktcs switch <context>` swaps kubectl context and reconnects in one step, with rollback on failure
- **Auto-reconnect**: `ktcs watch` reconnects on drops with exponential backoff
- **Health probe**: Verifies ktctl tunnel readiness instead of fixed timeouts
- **Clean output**: Centralized spinner + log, `--verbose` for debug
- **Root-owned process handling**: Non-sudo `ktcs status` reports correctly even when ktctl was started via sudo

## Installation

```bash
npm install -g kt-connect-service
```

ktctl is automatically downloaded to `~/.kt-connect-service/bin/` on first use.

## Quick Start

```bash
# 1. (Optional) Set your shadow image if you need a custom registry
ktcs config set image your-registry.com/kt-connect-shadow

# 2. Connect using the current kubectl context
sudo ktcs connect

# 3. Or switch to a different context and connect
sudo ktcs switch <context-name>

# 4. Check status
ktcs status

# 5. Disconnect
sudo ktcs disconnect
```

## Commands

### Connection

| Command | Description |
|---------|-------------|
| `ktcs connect` | Connect using current context + defaults |
| `ktcs connect -c <ctx>` | Switch context and connect |
| `ktcs connect -n <ns>` | Override namespace |
| `ktcs connect -i <image>` | Override shadow image |
| `ktcs connect --kubeconfig <path>` | Use a specific kubeconfig file |
| `ktcs disconnect` | Stop ktctl and clean up |
| `ktcs switch <ctx>` | Switch kubectl context + reconnect (with rollback) |
| `ktcs watch` | Connect with auto-reconnect on drop (foreground) |
| `ktcs watch --interval <ms>` | Health check interval (default 10000) |
| `ktcs watch --max-failures <n>` | Stop after N consecutive failures (default 5) |
| `ktcs clean` | Run `ktctl clean` |
| `ktcs clean -f` | Force-kill all ktctl processes |

### Inspection

| Command | Description |
|---------|-------------|
| `ktcs status` | Show connection status |
| `ktcs logs` | Show last 50 lines of connection log |
| `ktcs logs -f` | Follow log output |
| `ktcs logs -n 200` | Last 200 lines |
| `ktcs get-contexts` | List available kubeconfig contexts (`*` marks current) |

### Config (global defaults)

Defaults apply to every `connect`, overridable per-command via flags.

| Command | Description |
|---------|-------------|
| `ktcs config show` | Print current defaults |
| `ktcs config get <key>` | Print one value |
| `ktcs config set <key> <value>` | Set a default |
| `ktcs config unset <key>` | Reset to built-in |
| `ktcs config raw` | Dump raw config file |

Valid keys: `image`, `namespace`, `kubeconfig`, `extraArgs`.

### ktctl binary management

| Command | Description |
|---------|-------------|
| `ktcs install` | Download or upgrade ktctl (also runs on first use) |
| `ktcs install -v <version>` | Install a specific version |
| `ktcs install -f` | Force reinstall |
| `ktcs install -m` | Use GitHub mirror (faster in China) |
| `ktcs ktctl-version` | Show installed + latest ktctl versions |

### Global options

| Option | Description |
|--------|-------------|
| `--verbose` | Show internal steps and commands |

## Storage

- Config: `~/.kt-connect-service/config.json` (on macOS also under `Library/Preferences/...` depending on `conf` version)
- Logs: `~/.kt-connect-service/logs/ktctl-*.log`
- PID file: `~/.kt-connect-service/ktctl.pid`
- ktctl binary: `~/.kt-connect-service/bin/ktctl`

## Notes

- ktctl needs root privileges to modify routing tables — run `connect`, `disconnect`, `switch`, `watch`, `clean` with `sudo`
- `ktcs status`, `ktcs logs`, `ktcs config` work without sudo
- If something gets stuck: `sudo ktcs clean -f`

## Acknowledgments

Built on top of [kt-connect](https://github.com/alibaba/kt-connect) by Alibaba.

## License

GPL-3.0
