import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { queryClient } from './queryClient';

afterEach(() => onlineManager.setOnline(true));

describe('queryClient', () => {
  it('saves are attempted immediately even when the phone is offline (they fail fast instead of hanging)', async () => {
    onlineManager.setOnline(false);
    const observer = new MutationObserver(queryClient, {
      mutationFn: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(observer.mutate()).rejects.toThrow('Failed to fetch');
    expect(observer.getCurrentResult().isPaused).toBe(false);
    expect(observer.getCurrentResult().status).toBe('error');
  });

  it('reads keep the online-only default, so offline screens show what is already loaded instead of erroring', () => {
    expect(queryClient.getDefaultOptions().queries?.networkMode).toBeUndefined();
    expect(queryClient.getDefaultOptions().mutations?.retry).toBe(0);
  });
});
