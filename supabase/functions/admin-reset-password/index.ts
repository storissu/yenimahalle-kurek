// POST { user_id }
// Coach-only. Sets a new ONE-TIME password and forces a change at next login.
import { requireCoach } from '../_shared/auth.ts';
import { logAudit } from '../_shared/audit.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { generatePassword } from '../_shared/username.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(
  handle(async (req) => {
    const { admin, callerId } = await requireCoach(req);
    const body = await readJson(req);
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!UUID.test(userId)) throw new HttpError(400, 'Geçersiz kullanıcı');

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, username, full_name, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) throw new HttpError(500, 'Kullanıcı okunamadı');
    if (!target) throw new HttpError(404, 'Kullanıcı bulunamadı');

    const password = generatePassword(10);
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      console.error('updateUserById failed', updateError.message);
      throw new HttpError(500, 'Şifre sıfırlanamadı');
    }
    const { error: flagError } = await admin.from('profiles').update({ must_change_password: true }).eq('id', userId);
    if (flagError) console.error('must_change_password update failed', flagError.message);

    await logAudit(admin, {
      action: 'member.reset_password',
      memberId: userId,
      actorId: callerId,
      summary: `Şifre sıfırlandı: ${target.full_name} (@${target.username})`,
    });

    return json({ username: target.username, password });
  }),
);
