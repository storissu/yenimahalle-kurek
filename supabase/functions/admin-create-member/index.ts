// POST { full_name, username, role?: 'member' | 'coach', phone? }
// Coach-only. Creates the auth user + profile and returns a ONE-TIME password.
// The password is never stored or logged; the coach hands it to the member, who must change it at first login.
import { loginEmailDomain, requireCoach } from '../_shared/auth.ts';
import { handle, HttpError, json, readJson } from '../_shared/http.ts';
import { generatePassword, isValidUsername, normalizeUsername, toLoginEmail } from '../_shared/username.ts';

Deno.serve(
  handle(async (req) => {
    const { admin } = await requireCoach(req);
    const body = await readJson(req);

    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
    const username = typeof body.username === 'string' ? normalizeUsername(body.username) : '';
    const role = body.role === 'coach' ? 'coach' : 'member';
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

    if (fullName.length < 2 || fullName.length > 80) throw new HttpError(400, 'Ad soyad 2–80 karakter olmalı');
    if (!isValidUsername(username)) {
      throw new HttpError(400, 'Kullanıcı adı 3–30 karakter olmalı; yalnızca küçük harf (a-z), rakam, nokta, tire ve alt çizgi kullanılabilir');
    }
    if (phone && phone.length > 30) throw new HttpError(400, 'Telefon numarası çok uzun');

    const { data: existing, error: existingError } = await admin
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existingError) throw new HttpError(500, 'Kullanıcı adı kontrol edilemedi');
    if (existing) throw new HttpError(409, 'Bu kullanıcı adı zaten kullanılıyor');

    const password = generatePassword(10);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: toLoginEmail(username, loginEmailDomain()),
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      console.error('createUser failed', createError?.message);
      throw new HttpError(500, 'Hesap oluşturulamadı');
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      username,
      full_name: fullName,
      role,
      phone,
      must_change_password: true,
    });
    if (profileError) {
      // Roll back the auth user so no orphan account is left behind.
      await admin.auth.admin.deleteUser(created.user.id);
      console.error('profile insert failed', profileError.message);
      throw new HttpError(profileError.code === '23505' ? 409 : 500, 'Üye kaydedilemedi');
    }

    return json({ id: created.user.id, username, full_name: fullName, role, password }, 201);
  }),
);
