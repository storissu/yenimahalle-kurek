import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {}, vapidPublicKey: undefined }));

import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array (VAPID key decoding)', () => {
  it('decodes url-safe base64 without padding', () => {
    // "hello" -> aGVsbG8 (unpadded base64url)
    expect(Array.from(urlBase64ToUint8Array('aGVsbG8'))).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles the url-safe alphabet (- and _)', () => {
    // bytes [251, 255, 191] -> "+/+/" in base64, "-_-_" in base64url
    expect(Array.from(urlBase64ToUint8Array('-_-_'))).toEqual([251, 255, 191]);
  });

  it('decodes a 65-byte P-256 public key to the right length', () => {
    const key = Buffer.alloc(65, 7).toString('base64url');
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });
});
