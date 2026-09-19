// POST { user_id, is_active }
// Coach-only. Deactivating blocks login at the Auth level (ban) and by RLS (profiles.is_active).
// History is kept: members are never deleted. The DB refuses to deactivate the last active coach.
import { requireCoach } from '../_shared/auth.ts';
import { logAudit } from '../_shared/audit.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = '876000h'; // ~100 years

Deno.serve(
  handle(async (req) => {
    const { admin, callerId } = await requireCoach(req);
    const body = await readJson(req);
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!UUID.test(userId)) throw new HttpError(400, 'Geçersiz kullanıcı');
    if (typeof body.is_active !== 'boolean') throw new HttpError(400, 'is_active true/false olmalı');
    const isActive = body.is_active;
    if (userId === callerId && !isActive) throw new HttpError(400, 'Kendi hesabınızı devre dışı bırakamazsınız');

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, full_name, username, is_active')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) throw new HttpError(500, 'Kullanıcı okunamadı');
    if (!target) throw new HttpError(404, 'Kullanıcı bulunamadı');
    if (target.is_active === isActive) return json({ ok: true, is_active: isActive });

    // Profile first: the last-coach trigger may reject this change.
    const { error: profileError } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId);
    if (profileError) {
      throw new HttpError(profileError.message.includes('Son aktif antrenör') ? 409 : 500,
        profileError.message.includes('Son aktif antrenör')
          ? 'Son aktif antrenör devre dışı bırakılamaz'
          : 'Durum güncellenemedi');
    }

    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: isActive ? 'none' : BAN_FOREVER,
    });
    if (banError) {
      await admin.from('profiles').update({ is_active: !isActive }).eq('id', userId); // revert
      console.error('ban update failed', banError.message);
      throw new HttpError(500, 'Giriş izni güncellenemedi');
    }

    await logAudit(admin, {
      action: isActive ? 'member.activate' : 'member.deactivate',
      memberId: userId,
      actorId: callerId,
      summary: `${isActive ? 'Hesap yeniden etkinleştirildi' : 'Hesap devre dışı bırakıldı'}: ${target.full_name} (@${target.username})`,
    });

    return json({ ok: true, is_active: isActive });
  }),
);
