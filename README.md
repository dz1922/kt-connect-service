# kt-connect-service

A background service for managing kt-connect connections. This tool allows you to run kt-connect in the background, manage multiple connection profiles, and easily switch between different cluster configurations.

## Features

- **Background Service**: Run kt-connect as a background process that persists across terminal sessions
- **Profile Management**: Store and manage multiple connection configurations
- **Easy Installation**: Download and install ktctl directly from the command line
- **Environment Switching**: One-command switch between kubeconfig contexts with auto cleanup and reconnect
- **Namespace Switching**: Easily connect to different namespaces
- **Status Monitoring**: View connection status and logs in real-time
- **Auto Cleanup**: Automatic cleanup of kt-connect resources on disconnect
- **Auto Reconnect**: Opt-in watcher that auto-reconnects on connection drop with exponential backoff
- **Health Probing**: Verifies tunnel readiness instead of relying on fixed timeouts
- **Switch Rollback**: Automatically rolls back context on failed environment switch

## Installation

```bash
npm install -g kt-connect-service
```

### From source

```bash
git clone https://github.com/dz1922/kt-connect-service.git
cd kt-connect-service
npm install
npm run build
npm link
```

## Quick Start

ktctl is **automatically downloaded** on first use — no separate install step needed.

### 1. Add a Connection Profile

```bash
# Add a profile with all defaults (uses official kt-connect image, namespace: default)
ktcs profile add myprofile

# Add a profile with custom namespace
ktcs profile add dev -n dev

# Add a profile with custom image (override default)
ktcs profile add staging \
  -i your-custom-registry.com/kt-connect-shadow \
  -n staging \
  -d "Staging environment"
```

**Default values:**
- `-i` (image): `registry.cn-hangzhou.aliyuncs.com/rdc-incubator/kt-connect-shadow`
- `-n` (namespace): `default`
- `-d` (description): `default`

### 2. Connect to the Cluster

```bash
# Connect using the active profile
ktcs connect

# Connect using a specific profile
ktcs connect -p dev

# Connect with a namespace override
ktcs connect -n my-namespace
```

### 3. Check Status

```bash
ktcs status
```

### 4. View Logs

```bash
# View recent logs
ktcs logs

# Follow logs in real-time
ktcs logs -f

# View last 100 lines
ktcs logs -n 100
```

### 5. Disconnect

```bash
ktcs disconnect
```

## Commands Reference

### ktctl Management

ktctl is auto-downloaded on first use. These commands are for manual control:

| Command | Description |
|---------|-------------|
| `ktcs install` | Manually download ktctl (auto-done on first use) |
| `ktcs install -v <version>` | Install a specific version |
| `ktcs install -f` | Force reinstall / upgrade |
| `ktcs version` | Show installed and latest versions |

### Profile Management

| Command | Description |
|---------|-------------|
| `ktcs profile add <name>` | Add a new profile (all options have defaults) |
| `ktcs profile list` | List all profiles |
| `ktcs profile show <name>` | Show profile details |
| `ktcs profile use <name>` | Set active profile |
| `ktcs profile update <name>` | Update a profile |
| `ktcs profile remove <name>` | Remove a profile |

#### Profile Options

- `-i, --image <url>` - Shadow image URL (default: official kt-connect image)
- `-n, --namespace <ns>` - Default namespace (default: `default`)
- `-k, --kubeconfig <path>` - Path to kubeconfig file
- `-d, --description <desc>` - Profile description (default: `default`)
- `-a, --args <args...>` - Extra arguments for ktctl

### Connection Management

| Command | Description |
|---------|-------------|
| `ktcs connect` | Connect using active profile |
| `ktcs connect -p <profile>` | Connect using specific profile |
| `ktcs connect -n <namespace>` | Connect with namespace override |
| `ktcs disconnect` | Disconnect and cleanup |
| `ktcs status` | Show connection status |
| `ktcs logs` | View connection logs |
| `ktcs logs -f` | Follow logs in real-time |
| `ktcs clean` | Clean up kt-connect resources |
| `ktcs clean -f` | Force cleanup all kt-connect processes |
| `ktcs watch` | Connect with auto-reconnect on drop (foreground) |
| `ktcs watch --interval <ms>` | Set health check interval (default: 10000) |
| `ktcs watch --max-failures <n>` | Stop after N consecutive failures (default: 5) |

### Environment Switching

| Command | Description |
|---------|-------------|
| `ktcs switch -l` | List available kubeconfig contexts |
| `ktcs switch <context>` | Switch context and reconnect (auto cleanup) |
| `ktcs switch <context> -p <profile>` | Switch with specific profile |
| `ktcs switch <context> -n <namespace>` | Switch with namespace override |

### Configuration

| Command | Description |
|---------|-------------|
| `ktcs config` | Show current configuration |

### Global Options

| Option | Description |
|--------|-------------|
| `--verbose` | Show internal steps and commands |

## Configuration Storage

Configuration is stored in:
- **Linux**: `~/.config/kt-connect-service/config.json`
- **macOS**: `~/Library/Preferences/kt-connect-service/config.json`
- **Windows**: `%APPDATA%\kt-connect-service\Config\config.json`

Logs are stored in: `~/.kt-connect-service/logs/`

## Examples

### Setting up for multiple environments

```bash
# Add development profile (uses default image)
ktcs profile add dev -n dev -d "Development cluster"

# Add staging profile
ktcs profile add staging -n staging -d "Staging cluster"

# Add production profile with specific kubeconfig and custom image
ktcs profile add prod \
  -i your-registry.com/kt-connect-shadow \
  -n production \
  -k ~/.kube/prod-config \
  -d "Production cluster"
```

### Switching between environments

```bash
# List available kubeconfig contexts
sudo ktcs switch -l

# One-command switch: cleanup -> switch context -> reconnect
sudo ktcs switch my-other-context

# Switch with specific profile
sudo ktcs switch my-other-context -p staging

# Or manually: disconnect and switch to staging
ktcs disconnect
ktcs connect -p staging
```

### Verifying connectivity

After connecting, verify access to cluster resources:

```bash
# Test in-cluster service
nc -vz <service-name>.<namespace>.svc.cluster.local <port>

# Test RDS endpoint
nc -vz your-rds-endpoint.rds.amazonaws.com 5432
```

### Kubeconfig Management

kt-connect uses the currently active kubeconfig to connect to the cluster. You can manage kubeconfig in several ways:

#### Method 1: Use default kubeconfig (~/.kube/config)

```bash
# kt-connect will use ~/.kube/config by default
ktcs connect
```

#### Method 2: Set KUBECONFIG environment variable

```bash
# Switch kubeconfig before connecting
export KUBECONFIG=~/.kube/my-cluster-config
ktcs connect
```

#### Method 3: Specify kubeconfig in profile

```bash
# Create profile with specific kubeconfig
ktcs profile add my-cluster -k ~/.kube/my-cluster-config

# Connect using the profile
ktcs connect -p my-cluster
```

#### Switching clusters (reconnect)

Use the `switch` command for one-step environment switching:

```bash
# Recommended: One-command switch (auto cleanup -> switch context -> reconnect)
sudo ktcs switch <context-name>

# With profile and namespace
sudo ktcs switch <context-name> -p myprofile -n dev
```

Or manually disconnect and reconnect:

```bash
# Disconnect from current cluster
ktcs disconnect

# Option 1: Switch kubeconfig and reconnect
export KUBECONFIG=~/.kube/other-cluster-config
ktcs connect

# Option 2: Use a different profile with its own kubeconfig
ktcs connect -p other-cluster
```

**Note:** The `switch` command handles orphaned processes that may remain when kubeconfig is changed without proper disconnect.

## Notes

- kt-connect requires `sudo` privileges to modify routing tables
- Ensure your kubeconfig is properly configured before connecting
- The service runs ktctl in the background; logs are available via `ktcs logs`
- Use `ktcs clean` if you experience issues after an unclean shutdown

### Running with sudo

Since ktctl needs sudo privileges, run connect with sudo:

```bash
sudo ktcs connect
```

## Acknowledgments

This project is built on top of [kt-connect](https://github.com/alibaba/kt-connect) by Alibaba. Thanks to the kt-connect team for creating such a powerful tool for Kubernetes local development.

## License

GPL-3.0 (following [kt-connect](https://github.com/alibaba/kt-connect/blob/master/LICENSE) license)
