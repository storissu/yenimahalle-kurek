// POST {}   (any active user)
// Phase 1 push spike: sends a test Web Push to the CALLER's own subscriptions only.
// Required secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (an https:// URL or mailto:).
// Dead subscriptions (404/410) are pruned.
import webpush from 'npm:web-push@3.6.7';
import { requireUser } from '../_shared/auth.ts';
import { handle, HttpError, json } from '../_shared/http.ts';

Deno.serve(
  handle(async (req) => {
    const { admin, callerId } = await requireUser(req);

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT');
    if (!publicKey || !privateKey || !subject) throw new HttpError(500, 'Bildirim anahtarları yapılandırılmamış');
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', callerId);
    if (error) throw new HttpError(500, 'Abonelikler okunamadı');
    if (!subs || subs.length === 0) throw new HttpError(404, 'Bu hesap için kayıtlı bildirim cihazı yok');

    const payload = JSON.stringify({
      title: 'Yeni Mahalle Kürek',
      body: 'Test bildirimi başarıyla ulaştı 🚣',
      url: '/',
    });

    let sent = 0;
    const dead: string[] = [];
    const failures: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 });
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
          else failures.push(`${status ?? 'ağ hatası'}`);
          console.error('push failed', status, (err as Error).message);
        }
      }),
    );
    if (dead.length > 0) await admin.from('push_subscriptions').delete().in('id', dead);
    if (sent > 0) {
      await admin.from('push_subscriptions').update({ last_success_at: new Date().toISOString() }).eq('user_id', callerId);
    }

    return json({ sent, removed: dead.length, failed: failures.length });
  }),
);
