// POST { user_id }
// Coach-only. Deletes a member: the PERSON is removed (login, username, phone, devices, notifications, answers and
// places in upcoming trainings) while the club's HISTORY stays. What happens to the profile row is decided by the
// database function delete_member():
//   'deleted'    nothing referred to the member -> the profile and the login are gone completely
//   'anonymized' attendance / past crews / past answers refer to them -> the row stays as "Eski üye" (no name, phone or
//                login name, inactive) and the login is scrambled, so statistics and other members' history do not change
// The last active coach cannot be deleted (the database refuses), and nobody can delete themselves.
import { loginEmailDomain, requireCoach } from '../_shared/auth.ts';
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
    if (userId === callerId) throw new HttpError(400, 'Kendi hesabınızı silemezsiniz');

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, full_name, username, is_active, deleted_at')
      .eq('id', userId)
      .maybeSingle();
    if (targetError) throw new HttpError(500, 'Kullanıcı okunamadı');
    if (!target || target.deleted_at) throw new HttpError(404, 'Kullanıcı bulunamadı');

    // 1. Nobody can log in as this account from now on, whatever happens next.
    const { error: banError } = await admin.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
    if (banError) {
      console.error('ban failed', banError.message);
      throw new HttpError(500, 'Hesap kapatılamadı');
    }

    // 2. The database decides between deleting the row and keeping an anonymous tombstone.
    const { data: outcome, error: deleteError } = await admin.rpc('delete_member', { p_member: userId });
    if (deleteError) {
      if (target.is_active) await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' }); // nothing changed: reopen
      const lastCoach = deleteError.message.includes('Son aktif antrenör');
      if (!lastCoach) console.error('delete_member failed', deleteError.message);
      throw new HttpError(lastCoach ? 409 : 500, lastCoach ? 'Son aktif antrenör silinemez' : 'Üye silinemedi');
    }
    const keptHistory = outcome === 'anonymized';

    // 3. The login itself.
    if (keptHistory) {
      // The profile row stays (history refers to it), so the login stays too — but unusable and without the old name.
      const { error } = await admin.auth.admin.updateUserById(userId, {
        email: `silinen-${userId}@${loginEmailDomain()}`,
        password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
        user_metadata: {},
        ban_duration: BAN_FOREVER,
      });
      if (error) console.error('login scramble failed', error.message);
    } else {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.error('deleteUser failed', error.message); // the profile is gone, so the login is unusable anyway
    }

    await logAudit(admin, {
      action: 'member.delete',
      memberId: userId,
      actorId: callerId,
      summary: `Üye silindi: ${target.full_name} (@${target.username})`,
      detail: { history_kept: keptHistory },
    });

    return json({ ok: true, history_kept: keptHistory });
  }),
);
