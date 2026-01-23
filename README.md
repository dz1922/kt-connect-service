# kt-connect-service

A background service for managing kt-connect connections. This tool allows you to run kt-connect in the background, manage multiple connection profiles, and easily switch between different cluster configurations.

## Features

- **Background Service**: Run kt-connect as a background process that persists across terminal sessions
- **Profile Management**: Store and manage multiple connection configurations
- **Easy Installation**: Download and install ktctl directly from the command line
- **Namespace Switching**: Easily connect to different namespaces
- **Status Monitoring**: View connection status and logs in real-time
- **Auto Cleanup**: Automatic cleanup of kt-connect resources on disconnect

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd kt-connect-service

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional, for using 'ktcs' command)
npm link
```

## Quick Start

### 1. Install ktctl

```bash
# Install the latest version of ktctl
ktcs install

# Or install a specific version
ktcs install -v v0.3.7
```

### 2. Add a Connection Profile

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

### 3. Connect to the Cluster

```bash
# Connect using the active profile
ktcs connect

# Connect using a specific profile
ktcs connect -p dev

# Connect with a namespace override
ktcs connect -n my-namespace
```

### 4. Check Status

```bash
ktcs status
```

### 5. View Logs

```bash
# View recent logs
ktcs logs

# Follow logs in real-time
ktcs logs -f

# View last 100 lines
ktcs logs -n 100
```

### 6. Disconnect

```bash
ktcs disconnect
```

## Commands Reference

### Installation Commands

| Command | Description |
|---------|-------------|
| `ktcs install` | Download and install ktctl |
| `ktcs install -v <version>` | Install a specific version |
| `ktcs install -f` | Force reinstall |
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

### Configuration

| Command | Description |
|---------|-------------|
| `ktcs config` | Show current configuration |

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
# Connect to dev
ktcs connect -p dev

# Check status
ktcs status

# Disconnect and switch to staging
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

## Notes

- kt-connect requires `sudo` privileges to modify routing tables
- Ensure your kubeconfig is properly configured before connecting
- The service runs ktctl in the background; logs are available via `ktcs logs`
- Use `ktcs clean` if you experience issues after an unclean shutdown

## Acknowledgments

This project is built on top of [kt-connect](https://github.com/alibaba/kt-connect) by Alibaba. Thanks to the kt-connect team for creating such a powerful tool for Kubernetes local development.

## License

GPL-3.0 (following [kt-connect](https://github.com/alibaba/kt-connect/blob/master/LICENSE) license)
