// Web Push client helpers. A subscription is per browser installation; the server stores it via
// the register_push_subscription RPC so a shared phone always notifies whoever logged in last.
import { detectPlatform, isStandalone } from './platform';
import { invokeFunction } from './functions';
import { supabase, vapidPublicKey } from './supabase';

export type PushSupport = { supported: true } | { supported: false; reason: 'ios-needs-install' | 'unsupported' };

export function getPushSupport(): PushSupport {
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (hasApis) return { supported: true };
  // iOS Safari only exposes Push to apps added to the Home Screen.
  if (detectPlatform() === 'ios' && !isStandalone()) return { supported: false, reason: 'ios-needs-install' };
  return { supported: false, reason: 'unsupported' };
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration();
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!getPushSupport().supported) return null;
  const registration = await getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function registerOnServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('Geçersiz bildirim aboneliği');
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

async function subscribe(): Promise<PushSubscription> {
  if (!vapidPublicKey) throw new Error('missing-vapid-key');
  const registration = await getRegistration();
  if (!registration) throw new Error('no-service-worker');
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}

export type EnableResult = 'enabled' | 'denied';

/** Must be called from a user gesture (iOS requirement). */
export async function enablePush(): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  await registerOnServer(await subscribe());
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  const subscription = await getCurrentSubscription();
  if (!subscription) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

/**
 * Keeps the server's record of this device in step after login: if the user already granted
 * permission, (re-)register the subscription for the account that is signed in now.
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!getPushSupport().supported || Notification.permission !== 'granted' || !vapidPublicKey) return;
    await registerOnServer(await subscribe());
  } catch (error) {
    console.warn('Push sync skipped', error);
  }
}

/** Called before logout so the next person on this phone doesn't receive the previous user's pushes. */
export async function forgetThisDeviceOnServer(): Promise<void> {
  try {
    const subscription = await getCurrentSubscription();
    if (subscription) await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  } catch (error) {
    console.warn('Could not remove push subscription', error);
  }
}

export async function sendTestPush(): Promise<{ sent: number; removed: number; failed: number }> {
  return invokeFunction('push-test');
}
