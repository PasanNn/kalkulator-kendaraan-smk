const COOKIE = 'kalkulator_session';
const SESSION_DAYS = 7;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function parseCookies(request) {
  const raw = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function randomBytes(n = 32) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

function b64(bytes) {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64(new Uint8Array(digest));
}

async function hashPassword(password, saltBytes = randomBytes(16), iterations = 210000) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${iterations}$${b64(saltBytes)}$${b64(new Uint8Array(bits))}`;
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = fromB64(parts[2]);
  const expected = fromB64(parts[3]);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256
  ));
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

async function ensureSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin','staff')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();

  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
  )`).run();

  // Bootstrap akun admin otomatis saat database masih kosong.
  // Ini memastikan login awal tetap bisa dibuat tanpa membuka endpoint bootstrap secara manual.
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_users').first('n');
  if (Number(count) === 0) {
    const passwordHash = await hashPassword('admin123');
    await env.DB.prepare(
      'INSERT INTO app_users(username,password_hash,role) VALUES(?,?,?)'
    ).bind('admin', passwordHash, 'admin').run();
  }
}

async function currentUser(env, request) {
  const token = parseCookies(request)[COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  return await env.DB.prepare(`
    SELECT u.id, u.username, u.role
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now')
    LIMIT 1
  `).bind(tokenHash).first();
}

function publicUser(u) {
  return u ? { id: Number(u.id), username: u.username, role: u.role } : null;
}

async function handleAuth(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  try {
    await ensureSchema(env);
  } catch (e) {
    return json({
      ok: false,
      message: 'D1 belum terhubung. Pastikan binding DB mengarah ke database kalkulator-kendaraan-db.'
    }, 500);
  }

  if (action === 'bootstrap' && request.method === 'POST') {
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_users').first('n');
    if (Number(count) === 0) {
      const passwordHash = await hashPassword('admin123');
      await env.DB.prepare(
        'INSERT INTO app_users(username,password_hash,role) VALUES(?,?,?)'
      ).bind('admin', passwordHash, 'admin').run();
      return json({ ok: true, created: true });
    }
    return json({ ok: true, created: false });
  }

  if (action === 'me' && request.method === 'GET') {
    const u = await currentUser(env, request);
    return json({ ok: true, user: publicUser(u) });
  }

  if (action === 'login' && request.method === 'POST') {
    const data = await body(request);
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    const u = await env.DB.prepare(
      'SELECT id,username,password_hash,role FROM app_users WHERE username=? LIMIT 1'
    ).bind(username).first();

    if (!u || !(await verifyPassword(password, u.password_hash))) {
      return json({ ok: false, message: 'Username atau password salah.' }, 401);
    }

    const token = b64(randomBytes(32));
    const tokenHash = await sha256(token);
    await env.DB.prepare("DELETE FROM app_sessions WHERE expires_at <= datetime('now')").run();
    await env.DB.prepare(
      "INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+7 days'))"
    ).bind(Number(u.id), tokenHash).run();

    return json(
      { ok: true, user: publicUser(u) },
      200,
      { 'Set-Cookie': cookie(COOKIE, token, SESSION_DAYS * 86400) }
    );
  }

  if (action === 'logout' && request.method === 'POST') {
    const token = parseCookies(request)[COOKIE];
    if (token) {
      const tokenHash = await sha256(token);
      await env.DB.prepare('DELETE FROM app_sessions WHERE token_hash=?').bind(tokenHash).run();
    }
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(COOKIE, '', 0) });
  }

  const user = await currentUser(env, request);
  if (!user) {
    return json({ ok: false, message: 'Sesi login tidak ditemukan atau sudah kedaluwarsa.' }, 401);
  }
  if (user.role !== 'admin') {
    return json({ ok: false, message: 'Hanya admin yang boleh mengelola akun.' }, 403);
  }

  if (action === 'list_users' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,username,role FROM app_users ORDER BY id').all();
    return json({
      ok: true,
      users: rows.results.map(r => ({ id: Number(r.id), username: r.username, role: r.role }))
    });
  }

  if (action === 'add_user' && request.method === 'POST') {
    const data = await body(request);
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    const role = data.role === 'admin' ? 'admin' : 'staff';

    if (!/^[A-Za-z0-9._-]{3,80}$/.test(username)) {
      return json({ ok: false, message: 'Username 3-80 karakter, gunakan huruf/angka/titik/underscore/minus.' }, 422);
    }
    if (password.length < 6) return json({ ok: false, message: 'Password minimal 6 karakter.' }, 422);

    try {
      const hash = await hashPassword(password);
      await env.DB.prepare('INSERT INTO app_users(username,password_hash,role) VALUES(?,?,?)')
        .bind(username, hash, role).run();
      return json({ ok: true });
    } catch {
      return json({ ok: false, message: 'Username sudah digunakan.' }, 409);
    }
  }

  if (action === 'update_user' && request.method === 'POST') {
    const data = await body(request);
    const id = Number(data.id || 0);
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    const role = data.role === 'admin' ? 'admin' : 'staff';

    if (!id || !username) return json({ ok: false, message: 'Data akun tidak valid.' }, 422);
    const target = await env.DB.prepare('SELECT id,role FROM app_users WHERE id=?').bind(id).first();
    if (!target) return json({ ok: false, message: 'Akun tidak ditemukan.' }, 404);

    if (target.role === 'admin' && role !== 'admin') {
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='admin'").first('n');
      if (Number(c) <= 1) return json({ ok: false, message: 'Minimal harus ada satu admin.' }, 422);
    }

    try {
      if (password) {
        if (password.length < 6) return json({ ok: false, message: 'Password minimal 6 karakter.' }, 422);
        const hash = await hashPassword(password);
        await env.DB.prepare(
          'UPDATE app_users SET username=?,password_hash=?,role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).bind(username, hash, role, id).run();
      } else {
        await env.DB.prepare(
          'UPDATE app_users SET username=?,role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?'
        ).bind(username, role, id).run();
      }
      return json({ ok: true });
    } catch {
      return json({ ok: false, message: 'Username sudah digunakan.' }, 409);
    }
  }

  if (action === 'delete_user' && request.method === 'POST') {
    const data = await body(request);
    const id = Number(data.id || 0);
    if (!id) return json({ ok: false, message: 'ID akun tidak valid.' }, 422);
    if (id === Number(user.id)) return json({ ok: false, message: 'Akun yang sedang dipakai tidak boleh dihapus.' }, 422);

    const target = await env.DB.prepare('SELECT id,role FROM app_users WHERE id=?').bind(id).first();
    if (!target) return json({ ok: false, message: 'Akun tidak ditemukan.' }, 404);

    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM app_users').first('n');
    if (Number(total) <= 1) return json({ ok: false, message: 'Minimal harus ada satu akun.' }, 422);

    if (target.role === 'admin') {
      const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='admin'").first('n');
      if (Number(admins) <= 1) return json({ ok: false, message: 'Minimal harus ada satu admin.' }, 422);
    }

    await env.DB.prepare('DELETE FROM app_users WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, message: 'Aksi tidak dikenal.' }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/auth') {
      return handleAuth(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};
