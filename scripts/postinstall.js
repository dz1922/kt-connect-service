#!/usr/bin/env node

/**
 * Postinstall script: auto-download ktctl binary on npm install.
 * Fails gracefully — if download fails, user can still use `ktcs install` manually.
 */

async function main() {
  try {
    const { ensureKtctl } = require('../dist/installer');
    await ensureKtctl();
  } catch (err) {
    // Don't fail the npm install — ktctl will be auto-downloaded on first use
    console.log('Note: Could not auto-download ktctl. It will be downloaded on first use.');
    console.log(`  (${err.message})`);
  }
}

main();
