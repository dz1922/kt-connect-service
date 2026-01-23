"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.setKtctlPath = setKtctlPath;
exports.getKtctlPath = getKtctlPath;
exports.getLogDir = getLogDir;
exports.getPidFile = getPidFile;
exports.addProfile = addProfile;
exports.getProfile = getProfile;
exports.getAllProfiles = getAllProfiles;
exports.removeProfile = removeProfile;
exports.updateProfile = updateProfile;
exports.setActiveProfile = setActiveProfile;
exports.getActiveProfile = getActiveProfile;
exports.clearConfig = clearConfig;
const conf_1 = __importDefault(require("conf"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
// Use original user's home when running with sudo, otherwise use current user's home
function getRealHomeDir() {
    // Check if running with sudo and get the original user's home
    const sudoUser = process.env.SUDO_USER;
    if (sudoUser) {
        // On macOS, home is /Users/username; on Linux, it's /home/username
        if (process.platform === 'darwin') {
            return `/Users/${sudoUser}`;
        }
        else {
            return `/home/${sudoUser}`;
        }
    }
    return os.homedir();
}
const REAL_HOME = getRealHomeDir();
const CONFIG_DIR = path.join(REAL_HOME, '.kt-connect-service');
const DEFAULT_LOG_DIR = path.join(CONFIG_DIR, 'logs');
const DEFAULT_PID_FILE = path.join(CONFIG_DIR, 'ktctl.pid');
const config = new conf_1.default({
    projectName: 'kt-connect-service',
    cwd: CONFIG_DIR, // Use fixed config directory regardless of sudo
    defaults: {
        profiles: {},
        logDir: DEFAULT_LOG_DIR,
        pidFile: DEFAULT_PID_FILE,
    },
});
// Ensure directories exist
function ensureDirectories() {
    const logDir = config.get('logDir');
    const pidDir = path.dirname(config.get('pidFile'));
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    if (!fs.existsSync(pidDir)) {
        fs.mkdirSync(pidDir, { recursive: true });
    }
}
ensureDirectories();
function getConfig() {
    return {
        profiles: config.get('profiles'),
        activeProfile: config.get('activeProfile'),
        ktctlPath: config.get('ktctlPath'),
        logDir: config.get('logDir'),
        pidFile: config.get('pidFile'),
    };
}
function setKtctlPath(ktctlPath) {
    config.set('ktctlPath', ktctlPath);
}
function getKtctlPath() {
    return config.get('ktctlPath');
}
function getLogDir() {
    return config.get('logDir');
}
function getPidFile() {
    return config.get('pidFile');
}
// Profile management
function addProfile(profile) {
    const profiles = config.get('profiles');
    profiles[profile.name] = {
        ...profile,
        createdAt: profile.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    config.set('profiles', profiles);
}
function getProfile(name) {
    const profiles = config.get('profiles');
    return profiles[name];
}
function getAllProfiles() {
    const profiles = config.get('profiles');
    return Object.values(profiles);
}
function removeProfile(name) {
    const profiles = config.get('profiles');
    if (profiles[name]) {
        delete profiles[name];
        config.set('profiles', profiles);
        // Clear active profile if it was removed
        if (config.get('activeProfile') === name) {
            config.delete('activeProfile');
        }
        return true;
    }
    return false;
}
function updateProfile(name, updates) {
    const profiles = config.get('profiles');
    if (profiles[name]) {
        profiles[name] = {
            ...profiles[name],
            ...updates,
            name, // Ensure name cannot be changed
            updatedAt: new Date().toISOString(),
        };
        config.set('profiles', profiles);
        return true;
    }
    return false;
}
function setActiveProfile(name) {
    if (name === undefined) {
        config.delete('activeProfile');
    }
    else {
        config.set('activeProfile', name);
    }
}
function getActiveProfile() {
    return config.get('activeProfile');
}
function clearConfig() {
    config.clear();
    ensureDirectories();
}
exports.default = config;
//# sourceMappingURL=config.js.map