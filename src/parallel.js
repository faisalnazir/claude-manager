import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { PROFILES_DIR } from './constants.js';

/**
 * Launch a single Claude instance with a specific profile
 * @param {Object} profile - The profile object with label and value
 * @param {number} index - The instance index for temp file naming
 * @param {boolean} dangerMode - Whether to use --dangerously-skip-permissions
 * @returns {Promise<Object>} Result object with success status and info
 */
export const launchSingleInstance = async (profile, index, dangerMode = false) => {
  const tempSettingsPath = path.join(process.env.HOME, `.claude-parallel-${index}.json`);
  const profilePath = path.join(PROFILES_DIR, profile.value);

  try {
    const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    fs.writeFileSync(tempSettingsPath, JSON.stringify(profileData, null, 2));

    const claudeArgs = ['--settings', tempSettingsPath];
    if (dangerMode) {
      claudeArgs.push('--dangerously-skip-permissions');
    }

    const child = spawn('claude', claudeArgs, {
      detached: true,
      stdio: 'ignore'
    });

    child.unref();

    return {
      success: true,
      profile: profile.label,
      settingsFile: tempSettingsPath,
      pid: child.pid
    };
  } catch (error) {
    return {
      success: false,
      profile: profile.label,
      error: error.message
    };
  }
};

/**
 * Launch multiple Claude instances in parallel
 * @param {Array<Object>} profiles - Array of profile objects to launch
 * @param {boolean} dangerMode - Whether to use --dangerously-skip-permissions
 * @returns {Promise<Array<Object>>} Array of launch results
 */
export const launchParallelInstances = async (profiles, dangerMode = false) => {
  const results = [];

  for (let i = 0; i < profiles.length; i++) {
    const result = await launchSingleInstance(profiles[i], i, dangerMode);
    results.push(result);

    if (result.success) {
      console.log(`\x1b[32m✓\x1b[0m Setting up: ${result.profile}`);
    } else {
      console.log(`\x1b[31m✗ Failed to launch ${result.profile}: ${result.error}\x1b[0m`);
    }

    // Brief delay between launches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return results;
};

/**
 * Format and display parallel launch results
 * @param {Array<Object>} results - Array of launch results
 */
export const displayLaunchResults = (results) => {
  const launched = results.filter(r => r.success);

  if (launched.length > 0) {
    console.log(`\n\x1b[32m✓ Successfully launched ${launched.length} Claude instances!\x1b[0m`);
    console.log(`\nRunning instances:`);
    launched.forEach((instance, i) => {
      console.log(`  ${i + 1}. ${instance.profile} (PID: ${instance.pid})`);
    });

    console.log(`\nSettings files created:`);
    launched.forEach((instance, i) => {
      console.log(`  ~/.claude-parallel-${i}.json`);
    });

    console.log(`\n\x1b[33mTo clean up settings files later:\x1b[0m`);
    console.log(`  rm ~/.claude-parallel-*.json`);
  } else {
    console.log(`\x1b[31mNo instances were launched successfully\x1b[0m`);
  }
};
