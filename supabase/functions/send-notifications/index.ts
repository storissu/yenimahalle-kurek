// POST (pg_cron, every minute while something is pending; header x-cron-secret)
// Sends the notifications waiting in notification_outbox as Web Push to every device of the recipient.
// Required secrets: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
// The in-app inbox never depends on this: a row is visible to its recipient from the moment it exists.
import webpush from 'npm:web-push@3.6.7';
import { requireCron } from '../_shared/cron.ts';
import { handle, HttpError, json } from '../_shared/http.ts';
import { classifyStatus, decideOutcome, MAX_ATTEMPTS, payloadFor, pushOptions, type SendResult } from '../_shared/push.ts';

const BATCH = 200;
const CONCURRENCY = 10;

interface PendingRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  url: string;
  training_id: string | null;
  push_attempts: number;
}

interface Device {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

Deno.serve(
  handle(async (req) => {
    const admin = requireCron(req);

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT');
    if (!publicKey || !privateKey || !subject) throw new HttpError(500, 'Bildirim anahtarları yapılandırılmamış');
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const { data: rows, error } = await admin
      .from('notification_outbox')
      .select('id, user_id, type, title, body, url, training_id, push_attempts')
      .is('push_done_at', null)
      .lt('push_attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(BATCH);
    if (error) throw new HttpError(500, 'Bekleyen bildirimler okunamadı');
    const pending = (rows ?? []) as PendingRow[];
    if (pending.length === 0) return json({ processed: 0 });

    const userIds = [...new Set(pending.map((r) => r.user_id))];
    const { data: devicesData, error: devicesError } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', userIds);
    if (devicesError) throw new HttpError(500, 'Cihazlar okunamadı');
    const devicesByUser = new Map<string, Device[]>();
    for (const d of (devicesData ?? []) as Device[]) devicesByUser.set(d.user_id, [...(devicesByUser.get(d.user_id) ?? []), d]);

    const goneEndpoints = new Set<string>();
    const stats = { processed: 0, sent: 0, retrying: 0, gaveUp: 0, noDevice: 0 };

    const sendRow = async (row: PendingRow) => {
      const devices = devicesByUser.get(row.user_id) ?? [];
      const payload = JSON.stringify(payloadFor(row));
      const options = pushOptions(row.type);

      const results: SendResult[] = await Promise.all(
        devices.map(async (device): Promise<SendResult> => {
          try {
            await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, options);
            return 'ok';
          } catch (err) {
            const result = classifyStatus((err as { statusCode?: number }).statusCode);
            if (result === 'gone') goneEndpoints.add(device.endpoint);
            else console.error('push failed', (err as { statusCode?: number }).statusCode, (err as Error).message);
            return result;
          }
        }),
      );

      const outcome = decideOutcome(devices.length, results, row.push_attempts);
      await admin
        .from('notification_outbox')
        .update({
          push_done_at: outcome.done ? new Date().toISOString() : null,
          push_attempts: row.push_attempts + (outcome.countAttempt ? 1 : 0),
          push_error: outcome.error,
        })
        .eq('id', row.id);

      stats.processed++;
      if (results.includes('ok')) stats.sent++;
      else if (devices.length === 0) stats.noDevice++;
      else if (outcome.error === 'gave-up') stats.gaveUp++;
      else if (!outcome.done) stats.retrying++;
    };

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      await Promise.all(pending.slice(i, i + CONCURRENCY).map(sendRow));
    }

    if (goneEndpoints.size > 0) {
      await admin.from('push_subscriptions').delete().in('endpoint', [...goneEndpoints]);
    }
    return json({ ...stats, removedSubscriptions: goneEndpoints.size });
  }),
);
