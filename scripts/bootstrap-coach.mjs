#!/usr/bin/env node
// Creates a COACH account directly with the service-role key.
// Use it once for the very first coach (nobody can log in yet, so the app cannot do it),
// and as the documented recovery path if every coach loses their password.
//
//   PowerShell:
//     $env:SUPABASE_URL = "https://<project-ref>.supabase.co"
//     $env:SUPABASE_SERVICE_ROLE_KEY = "<service_role / secret key>"
//     node bootstrap-coach.mjs --username ayse --name "Ayşe Yılmaz"
//     (optional) $env:LOGIN_EMAIL_DOMAIN = "kulup.invalid"
//
//   Recovery for an EXISTING coach who lost their password: add --reset
//
// The service-role key is read from the environment only (never a CLI argument, so it stays
// out of shell history) and must never be committed or pasted into the web app.
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    name: { type: 'string' },
    reset: { type: 'boolean', default: false },
  },
});

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const domain = process.env.LOGIN_EMAIL_DOMAIN || 'kulup.invalid';
const username = (values.username ?? '').trim().toLowerCase();
const fullName = (values.name ?? '').trim();

function fail(message) {
  console.error(`\nHata: ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) fail('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri gerekli.');
if (!/^[a-z0-9._-]{3,30}$/.test(username)) fail('--username 3–30 karakter olmalı (a-z, 0-9, . _ -).');
if (!values.reset && (fullName.length < 2 || fullName.length > 80)) fail('--name "Ad Soyad" gerekli (2–80 karakter).');

// Same alphabet/policy as supabase/functions/_shared/username.ts (no 0/O/1/l/I; letters + digits).
const LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
function generatePassword(length = 12) {
  const all = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)], DIGITS[randomInt(DIGITS.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const password = generatePassword();

const { data: existing, error: lookupError } = await admin
  .from('profiles')
  .select('id, role, is_active')
  .eq('username', username)
  .maybeSingle();
if (lookupError) fail(`Profil sorgulanamadı: ${lookupError.message}`);

if (values.reset) {
  if (!existing) fail(`"${username}" kullanıcısı bulunamadı.`);
  if (existing.role !== 'coach') fail(`"${username}" bir antrenör değil; şifreyi uygulamadan sıfırlayın.`);
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password, ban_duration: 'none' });
  if (error) fail(`Şifre sıfırlanamadı: ${error.message}`);
  await admin.from('profiles').update({ must_change_password: true, is_active: true }).eq('id', existing.id);
} else {
  if (existing) fail(`"${username}" kullanıcı adı zaten var. (Şifre sıfırlamak için --reset kullanın.)`);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: `${username}@${domain}`,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) fail(`Hesap oluşturulamadı: ${createError?.message ?? 'bilinmeyen hata'}`);
  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    username,
    full_name: fullName,
    role: 'coach',
    must_change_password: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    fail(`Profil oluşturulamadı: ${profileError.message}`);
  }
}

console.log(`
Antrenör hesabı hazır.
  Kullanıcı adı : ${username}
  Geçici şifre  : ${password}

Bu şifre bir daha gösterilmeyecek. İlk girişte yeni şifre belirlemeniz istenecek.
`);
