'use strict';

/**
 * capture/activeWindowWin.js
 *
 * Windows-only active window reader using PowerShell — no native addons.
 * Replaces the ffi-napi path in active-win v7 which is incompatible with Node 24+.
 *
 * Returns the same shape as active-win v7 (the subset we use):
 *   { title, owner: { name, processId } }
 */

const { execFileSync } = require('child_process');
const path = require('path');

const PS1_PATH = path.join(__dirname, 'getActiveWindow.ps1');

/**
 * Returns the currently active window info, or null on failure.
 * @returns {{ title: string, owner: { name: string, processId: number } } | null}
 */
function getActiveWindowSync() {
  try {
    // Force PowerShell output to UTF-8 so Node can decode it correctly.
    // '[Console]::OutputEncoding' must be set inside the process.
    const raw = execFileSync(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-Command',
        `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '${PS1_PATH}'`,
      ],
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    ).trim();
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title || '',
      owner: {
        name: parsed.appName || 'Unknown',
        processId: parsed.processId || 0,
      },
    };
  } catch {
    return null;
  }
}

module.exports = { getActiveWindowSync };
