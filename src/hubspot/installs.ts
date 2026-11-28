import type { Store } from '../store/store.js';
import { HubSpotError } from './client.js';
import type { TokenManager } from './tokens.js';

/**
 * Uninstalls in HubSpot. HubSpot doesn't tell apps when an account uninstalls them, but it
 * revokes the refresh token, so a refresh fails from then on (TokenManager forgets the tokens
 * and the store records `disconnectedAt`). Once a day, checkInstalls():
 *
 * - refreshes the token of every connected account, so an uninstall is noticed within a day;
 * - deletes the data of accounts disconnected for DELETE_AFTER_DAYS (settings, the encrypted
 *   Supertext key, history, links, image records). Connecting again before that keeps everything.
 *
 * Other failures (HubSpot unreachable) change nothing; the next run tries again.
 */
export const DELETE_AFTER_DAYS = 30;
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export interface InstallCheck {
  checked: number;
  /** Accounts whose tokens HubSpot refused in this run. */
  uninstalled: string[];
  /** Accounts whose data was deleted in this run. */
  deleted: string[];
}

export async function checkInstalls(deps: { store: Store; tokens: TokenManager; now?: () => number }): Promise<InstallCheck> {
  const now = deps.now ?? Date.now;
  const result: InstallCheck = { checked: 0, uninstalled: [], deleted: [] };
  for (const state of await deps.store.accountStates()) {
    if (state.connected) {
      result.checked++;
      try {
        await deps.tokens.source(state).refreshed();
      } catch (error) {
        if (error instanceof HubSpotError && error.code === 'hubspotAuth') result.uninstalled.push(state.accountId);
      }
      continue;
    }
    const since = state.disconnectedAt ? Date.parse(state.disconnectedAt) : Number.NaN;
    if (Number.isNaN(since)) {
      // Disconnected before the app recorded when: start the period now.
      await deps.store.saveTokens(state.accountId, null);
    } else if (now() - since >= DELETE_AFTER_DAYS * 86_400_000) {
      await deps.store.deleteAccount(state.accountId);
      result.deleted.push(state.accountId);
      console.log(`Supertext: HubSpot account ${state.accountId} was disconnected for ${DELETE_AFTER_DAYS} days; its data was deleted.`);
    }
  }
  return result;
}

/** Runs checkInstalls() a minute after the start and then once a day (one instance). */
export function scheduleInstallChecks(deps: { store: Store; tokens: TokenManager }): () => void {
  const run = () =>
    void checkInstalls(deps).catch((error) => console.warn('Supertext: install check failed:', error instanceof Error ? error.message : error));
  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, CHECK_EVERY_MS);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
