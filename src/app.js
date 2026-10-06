import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { foodFromRow } from './seed.js';

class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', errors) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const generateToken = () => randomBytes(32).toString('base64url');
const nowIso = () => new Date().toISOString();
const addMinutes = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const addDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function cleanPhone(value) {
  return normalizeDigits(value).replace(/[\s()+-]/g, '').trim();
}

function requiredString(value, field, { min = 1, max = 255 } = {}) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < min || clean.length > max) {
    throw new ApiError(422, 'اطلاعات واردشده معتبر نیست.', 'VALIDATION_ERROR', {
      [field]: [`مقدار ${field} معتبر نیست.`],
    });
  }
  return clean;
}

function userFromRow(row) {
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    avatar_url: row.avatar_url,
  };
}

function addressFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    city: row.city,
    district: row.district,
    full_address: row.full_address,
    house_number: row.house_number,
    phone: row.phone,
    note: row.note,
    is_default: Boolean(row.is_default),
  };
}

function notificationFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type,
    created_at: row.created_at,
    is_read: Boolean(row.is_read),
  };
}

function orderFromRow(row) {
  return {
    id: row.id,
    order_number: row.order_number,
    status: row.status,
    items: typeof row.items_json === 'string' ? JSON.parse(row.items_json) : row.items_json,
    address: typeof row.address_json === 'string' ? JSON.parse(row.address_json) : row.address_json,
    subtotal: Number(row.subtotal),
    delivery_fee: Number(row.delivery_fee),
    discount: Number(row.discount),
    total: Number(row.total),
    payment_method: row.payment_method,
    delivery_type: row.delivery_type,
    note: row.note,
    created_at: row.created_at,
  };
}

async function issueSession(db, userId) {
  const token = generateToken();
  const configuredDays = Number(process.env.SESSION_DAYS ?? 30);
  const sessionDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : 30;
  await db.run(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES ($1, $2, $3, $4)
  `, [sha256(token), userId, addDays(sessionDays), nowIso()]);
  return token;
}

function buildAuthMiddleware(db) {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') ?? '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) return next(new ApiError(401, 'نشست شما پایان یافته است.', 'UNAUTHENTICATED'));
      const tokenHash = sha256(match[1]);
      const user = await db.one(`
        SELECT u.* FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > $2
      `, [tokenHash, nowIso()]);
      if (!user) return next(new ApiError(401, 'نشست شما پایان یافته است.', 'UNAUTHENTICATED'));
      req.user = user;
      req.accessTokenHash = tokenHash;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function authRateLimiter({ windowMs = 60_000, limit = 30 } = {}) {
  const attempts = new Map();
  return (req, _res, next) => {
    const key = req.ip ?? 'unknown';
    const current = attempts.get(key);
    const now = Date.now();
    if (!current || current.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > limit) {
      return next(new ApiError(429, 'درخواست‌های زیادی فرستاده شد. کمی بعد دوباره تلاش کنید.', 'RATE_LIMITED'));
    }
    next();
  };
}

function parseAddressInput(body) {
  return {
    title: requiredString(body.title, 'title', { max: 80 }),
    city: requiredString(body.city, 'city', { max: 80 }),
    district: requiredString(body.district, 'district', { max: 100 }),
    fullAddress: requiredString(body.full_address, 'full_address', { max: 500 }),
    houseNumber: typeof body.house_number === 'string' ? body.house_number.trim().slice(0, 50) : '',
    phone: cleanPhone(requiredString(body.phone, 'phone', { min: 7, max: 30 })),
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '',
    isDefault: body.is_default === true,
  };
}

function normalizePayment(value) {
  const allowed = new Set(['cash_on_delivery', 'card', 'wallet']);
  return allowed.has(value) ? value : 'cash_on_delivery';
}

export function createApp(db) {
  const app = express();
  const auth = buildAuthMiddleware(db);
  const authLimit = authRateLimiter();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? '*' }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    await db.one('SELECT 1 AS healthy');
    res.json({ status: 'ok', service: 'zafferan-api', time: nowIso() });
  });

  const api = express.Router();

  api.post('/auth/login', authLimit, async (req, res) => {
    const phone = cleanPhone(requiredString(req.body?.phone, 'phone', { min: 7, max: 30 }));
    const password = requiredString(req.body?.password, 'password', { min: 6, max: 128 });
    const user = await db.one('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(401, 'شماره موبایل یا رمز عبور نادرست است.', 'INVALID_CREDENTIALS');
    }
    const accessToken = await issueSession(db, user.id);
    res.json({ data: { access_token: accessToken, token_type: 'Bearer', user: userFromRow(user) } });
  });

  api.post('/auth/register', authLimit, async (req, res) => {
    const firstName = requiredString(req.body?.first_name, 'first_name', { max: 80 });
    const lastName = requiredString(req.body?.last_name, 'last_name', { max: 80 });
    const phone = cleanPhone(requiredString(req.body?.phone, 'phone', { min: 7, max: 30 }));
    const password = requiredString(req.body?.password, 'password', { min: 6, max: 128 });
    if (req.body?.password_confirmation !== password) {
      throw new ApiError(422, 'تکرار رمز عبور یکسان نیست.', 'VALIDATION_ERROR', {
        password_confirmation: ['تکرار رمز عبور یکسان نیست.'],
      });
    }
    if (await db.one('SELECT 1 FROM users WHERE phone = $1', [phone])) {
      throw new ApiError(409, 'این شماره موبایل قبلاً ثبت شده است.', 'PHONE_EXISTS');
    }

    const id = randomUUID();
    const createdAt = nowIso();
    await db.run(`
      INSERT INTO users (id, first_name, last_name, phone, password_hash, avatar_url, created_at)
      VALUES ($1, $2, $3, $4, $5, NULL, $6)
    `, [id, firstName, lastName, phone, await bcrypt.hash(password, 12), createdAt]);
    await db.run(`
      INSERT INTO notifications (id, user_id, title, body, type, is_read, created_at)
      VALUES ($1, $2, $3, $4, 'general', FALSE, $5)
    `, [randomUUID(), id, 'به زعفران خوش آمدید', 'دنیایی از طعم‌های اصیل در انتظار شماست.', createdAt]);
    const user = await db.one('SELECT * FROM users WHERE id = $1', [id]);
    const accessToken = await issueSession(db, id);
    res.status(201).json({ data: { access_token: accessToken, token_type: 'Bearer', user: userFromRow(user) } });
  });

  api.post('/auth/logout', auth, async (req, res) => {
    await db.run('DELETE FROM sessions WHERE token_hash = $1', [req.accessTokenHash]);
    res.status(204).end();
  });

  api.get('/auth/me', auth, (req, res) => res.json({ data: userFromRow(req.user) }));

  api.post('/auth/forgot-password', authLimit, async (req, res) => {
    const phone = cleanPhone(requiredString(req.body?.phone, 'phone', { min: 7, max: 30 }));
    const user = await db.one('SELECT id FROM users WHERE phone = $1', [phone]);
    const challengeId = `pw_${randomBytes(8).toString('hex')}`;
    const otp = process.env.DEV_OTP ?? '1234';
    await db.run(`
      INSERT INTO password_resets (
        challenge_id, user_id, otp_hash, attempts, expires_at, created_at
      ) VALUES ($1, $2, $3, 0, $4, $5)
    `, [challengeId, user?.id ?? null, sha256(`${challengeId}:${otp}`), addMinutes(2), nowIso()]);
    res.status(202).json({
      message: 'اگر حسابی با این شماره وجود داشته باشد، کد تأیید ارسال می‌شود.',
      challenge_id: challengeId,
      expires_in: 120,
      ...(process.env.NODE_ENV === 'production' ? {} : { development_otp: otp }),
    });
  });

  api.post('/auth/verify-otp', authLimit, async (req, res) => {
    const challengeId = requiredString(req.body?.challenge_id, 'challenge_id', { max: 100 });
    const otp = normalizeDigits(requiredString(req.body?.otp, 'otp', { min: 4, max: 10 }));
    const challenge = await db.one(`
      SELECT * FROM password_resets
      WHERE challenge_id = $1 AND used_at IS NULL AND expires_at > $2
    `, [challengeId, nowIso()]);
    if (!challenge || challenge.attempts >= 5 || challenge.otp_hash !== sha256(`${challengeId}:${otp}`)) {
      if (challenge) await db.run('UPDATE password_resets SET attempts = attempts + 1 WHERE challenge_id = $1', [challengeId]);
      throw new ApiError(challenge?.attempts >= 4 ? 429 : 422, 'کد تأیید نادرست یا منقضی است.', 'INVALID_OTP');
    }
    const resetToken = generateToken();
    await db.run(`
      UPDATE password_resets SET reset_token_hash = $1, reset_expires_at = $2 WHERE challenge_id = $3
    `, [sha256(resetToken), addMinutes(5), challengeId]);
    res.json({ data: { reset_token: resetToken, expires_in: 300 } });
  });

  api.post('/auth/reset-password', authLimit, async (req, res) => {
    const resetToken = requiredString(req.body?.reset_token, 'reset_token', { min: 20, max: 200 });
    const password = requiredString(req.body?.password, 'password', { min: 6, max: 128 });
    if (req.body?.password_confirmation !== password) {
      throw new ApiError(422, 'تکرار رمز عبور یکسان نیست.', 'VALIDATION_ERROR');
    }
    const challenge = await db.one(`
      SELECT * FROM password_resets
      WHERE reset_token_hash = $1 AND reset_expires_at > $2 AND used_at IS NULL
    `, [sha256(resetToken), nowIso()]);
    if (!challenge) throw new ApiError(422, 'توکن بازیابی نامعتبر یا منقضی است.', 'INVALID_RESET_TOKEN');
    if (challenge.user_id) {
      await db.run('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 12), challenge.user_id]);
      await db.run('DELETE FROM sessions WHERE user_id = $1', [challenge.user_id]);
    }
    await db.run('UPDATE password_resets SET used_at = $1 WHERE challenge_id = $2', [nowIso(), challenge.challenge_id]);
    res.json({ message: 'رمز عبور تغییر کرد.' });
  });

  api.get('/categories', async (_req, res) => {
    const data = await db.many('SELECT id, name, image_url FROM categories ORDER BY sort_order');
    res.json({ data });
  });

  api.get('/foods', async (req, res) => {
    const clauses = [];
    const params = [];
    if (req.query.category_id && req.query.category_id !== 'all') {
      params.push(String(req.query.category_id));
      clauses.push(`category_id = $${params.length}`);
    }
    if (req.query.discounted === 'true') clauses.push('old_price IS NOT NULL');
    if (req.query.featured === 'true') clauses.push('is_featured = TRUE');
    if (req.query.max_price !== undefined) {
      const maxPrice = Number(req.query.max_price);
      if (!Number.isFinite(maxPrice) || maxPrice < 0) throw new ApiError(422, 'حداکثر قیمت معتبر نیست.', 'VALIDATION_ERROR');
      params.push(maxPrice);
      clauses.push(`price <= $${params.length}`);
    }
    const orderBy = {
      popular: 'review_count DESC',
      price_asc: 'price ASC',
      price_desc: 'price DESC',
      rating: 'rating DESC',
      newest: 'sort_order DESC',
    }[req.query.sort] ?? 'sort_order ASC';
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.many(`SELECT * FROM foods ${where} ORDER BY ${orderBy}`, params);
    res.json({ data: rows.map(foodFromRow), meta: { page: 1, last_page: 1 } });
  });

  api.get('/foods/search', async (req, res) => {
    const query = requiredString(req.query.q, 'q', { max: 100 }).toLocaleLowerCase('fa');
    const rows = await db.many('SELECT * FROM foods ORDER BY sort_order');
    const data = rows.map(foodFromRow).filter((food) =>
      food.name.toLocaleLowerCase('fa').includes(query)
      || food.description.toLocaleLowerCase('fa').includes(query));
    res.json({ data, meta: { page: 1, last_page: 1 } });
  });

  api.get('/foods/:id', async (req, res) => {
    const row = await db.one('SELECT * FROM foods WHERE id = $1', [req.params.id]);
    if (!row) throw new ApiError(404, 'غذای درخواستی پیدا نشد.', 'NOT_FOUND');
    res.json({ data: foodFromRow(row) });
  });

  api.get('/favorites', auth, async (req, res) => {
    const rows = await db.many(`
      SELECT f.* FROM favorites x JOIN foods f ON f.id = x.food_id
      WHERE x.user_id = $1 ORDER BY x.created_at DESC
    `, [req.user.id]);
    res.json({ data: rows.map(foodFromRow) });
  });

  api.post('/favorites/:foodId', auth, async (req, res) => {
    if (!await db.one('SELECT 1 FROM foods WHERE id = $1', [req.params.foodId])) {
      throw new ApiError(404, 'غذای درخواستی پیدا نشد.', 'NOT_FOUND');
    }
    const existing = await db.one('SELECT 1 FROM favorites WHERE user_id = $1 AND food_id = $2', [req.user.id, req.params.foodId]);
    if (existing) throw new ApiError(409, 'این غذا قبلاً ذخیره شده است.', 'ALREADY_FAVORITE');
    const createdAt = nowIso();
    await db.run('INSERT INTO favorites (user_id, food_id, created_at) VALUES ($1, $2, $3)', [req.user.id, req.params.foodId, createdAt]);
    res.status(201).json({ data: { food_id: req.params.foodId, created_at: createdAt } });
  });

  api.delete('/favorites/:foodId', auth, async (req, res) => {
    await db.run('DELETE FROM favorites WHERE user_id = $1 AND food_id = $2', [req.user.id, req.params.foodId]);
    res.status(204).end();
  });

  api.get('/addresses', auth, async (req, res) => {
    const rows = await db.many(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at',
      [req.user.id],
    );
    res.json({ data: rows.map(addressFromRow) });
  });

  api.post('/addresses', auth, async (req, res) => {
    const input = parseAddressInput(req.body ?? {});
    const id = randomUUID();
    const countRow = await db.one(
      'SELECT COUNT(*)::int AS count FROM addresses WHERE user_id = $1',
      [req.user.id],
    );
    const isDefault = input.isDefault || countRow.count === 0;
    if (isDefault) {
      await db.run('UPDATE addresses SET is_default = FALSE WHERE user_id = $1', [req.user.id]);
    }
    await db.run(`
      INSERT INTO addresses (
        id, user_id, title, city, district, full_address, house_number,
        phone, note, is_default, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      id, req.user.id, input.title, input.city, input.district,
      input.fullAddress, input.houseNumber, input.phone, input.note,
      isDefault, nowIso(),
    ]);
    const saved = await db.one('SELECT * FROM addresses WHERE id = $1', [id]);
    res.status(201).json({ data: addressFromRow(saved) });
  });

  api.put('/addresses/:id', auth, async (req, res) => {
    const current = await db.one(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!current) throw new ApiError(404, 'نشانی درخواستی پیدا نشد.', 'NOT_FOUND');
    const input = parseAddressInput(req.body ?? {});
    if (input.isDefault) {
      await db.run('UPDATE addresses SET is_default = FALSE WHERE user_id = $1', [req.user.id]);
    }
    await db.run(`
      UPDATE addresses SET title = $1, city = $2, district = $3, full_address = $4,
        house_number = $5, phone = $6, note = $7, is_default = $8
      WHERE id = $9 AND user_id = $10
    `, [
      input.title, input.city, input.district, input.fullAddress,
      input.houseNumber, input.phone, input.note, input.isDefault,
      req.params.id, req.user.id,
    ]);
    const saved = await db.one('SELECT * FROM addresses WHERE id = $1', [req.params.id]);
    res.json({ data: addressFromRow(saved) });
  });

  api.delete('/addresses/:id', auth, async (req, res) => {
    const current = await db.one(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!current) throw new ApiError(404, 'نشانی درخواستی پیدا نشد.', 'NOT_FOUND');
    const activeOrder = await db.one(`
      SELECT 1 FROM orders WHERE user_id = $1 AND address_id = $2
      AND status NOT IN ('delivered', 'cancelled') LIMIT 1
    `, [req.user.id, req.params.id]);
    if (activeOrder) throw new ApiError(409, 'این نشانی در یک سفارش فعال استفاده شده است.', 'ADDRESS_IN_USE');
    await db.run('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (current.is_default) {
      const next = await db.one(
        'SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [req.user.id],
      );
      if (next) await db.run('UPDATE addresses SET is_default = TRUE WHERE id = $1', [next.id]);
    }
    res.status(204).end();
  });

  api.get('/orders', auth, async (req, res) => {
    let clause = '';
    if (req.query.status === 'active') clause = "AND status NOT IN ('delivered', 'cancelled')";
    else if (req.query.status === 'past') clause = "AND status = 'delivered'";
    else if (req.query.status === 'cancelled') clause = "AND status = 'cancelled'";
    else if (req.query.status !== undefined) throw new ApiError(422, 'وضعیت سفارش معتبر نیست.', 'VALIDATION_ERROR');
    const rows = await db.many(
      `SELECT * FROM orders WHERE user_id = $1 ${clause} ORDER BY created_at DESC`,
      [req.user.id],
    );
    res.json({ data: rows.map(orderFromRow), meta: { page: 1, last_page: 1 } });
  });

  api.get('/orders/:id', auth, async (req, res) => {
    const row = await db.one(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!row) throw new ApiError(404, 'سفارش درخواستی پیدا نشد.', 'NOT_FOUND');
    res.json({ data: orderFromRow(row) });
  });

  api.post('/orders', auth, async (req, res) => {
    const idempotencyKey = req.get('idempotency-key')?.trim().slice(0, 200) || null;
    if (idempotencyKey) {
      const previous = await db.one(
        'SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2',
        [req.user.id, idempotencyKey],
      );
      if (previous) return res.json({ data: orderFromRow(previous) });
    }
    if (!Array.isArray(req.body?.items) || req.body.items.length === 0 || req.body.items.length > 50) {
      throw new ApiError(422, 'سبد سفارش معتبر نیست.', 'VALIDATION_ERROR');
    }
    const address = await db.one(
      'SELECT * FROM addresses WHERE id = $1 AND user_id = $2',
      [req.body.address_id, req.user.id],
    );
    if (!address) throw new ApiError(422, 'نشانی انتخاب‌شده معتبر نیست.', 'VALIDATION_ERROR');

    let subtotal = 0;
    const items = [];
    for (const selection of req.body.items) {
      const quantity = Number(selection.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new ApiError(422, 'تعداد غذا معتبر نیست.', 'VALIDATION_ERROR');
      }
      const foodRow = await db.one('SELECT * FROM foods WHERE id = $1', [selection.food_id]);
      if (!foodRow) throw new ApiError(409, 'یکی از غذاهای انتخاب‌شده دیگر موجود نیست.', 'FOOD_UNAVAILABLE');
      const food = foodFromRow(foodRow);
      const selectedSize = selection.selected_size == null ? null : String(selection.selected_size);
      const size = selectedSize == null ? null : food.options.find((option) => option.name === selectedSize);
      if (selectedSize != null && !size) throw new ApiError(409, 'اندازه انتخاب‌شده موجود نیست.', 'OPTION_UNAVAILABLE');
      const extraIds = Array.isArray(selection.extra_ids) ? [...new Set(selection.extra_ids.map(String))] : [];
      const selectedExtras = extraIds.map((id) => food.extras.find((extra) => extra.id === id));
      if (selectedExtras.some((extra) => !extra)) throw new ApiError(409, 'افزودنی انتخاب‌شده موجود نیست.', 'EXTRA_UNAVAILABLE');
      const unitPrice = food.price + (size?.price_delta ?? 0)
        + selectedExtras.reduce((sum, extra) => sum + extra.price, 0);
      subtotal += unitPrice * quantity;
      items.push({
        food,
        quantity,
        selected_extras: selectedExtras,
        selected_size: selectedSize,
        unit_price: unitPrice,
      });
    }

    const deliveryType = req.body.delivery_type === 'express' ? 'express' : 'standard';
    const deliveryFee = (subtotal >= 800 ? 0 : 40) + (deliveryType === 'express' ? 35 : 0);
    const couponCode = typeof req.body.coupon_code === 'string' ? req.body.coupon_code.trim().toUpperCase() : '';
    const discount = couponCode === 'WELCOME20' ? subtotal * 0.2 : 0;
    const total = subtotal - discount + deliveryFee;
    const createdAt = nowIso();
    const id = randomUUID();
    const orderNumber = `ORD-${randomBytes(6).toString('hex').toUpperCase()}`;
    const addressJson = addressFromRow(address);
    const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
    await db.run(`
      INSERT INTO orders (
        id, user_id, order_number, status, address_id, address_json, items_json,
        subtotal, delivery_fee, discount, total, payment_method, delivery_type,
        note, idempotency_key, created_at, updated_at
      ) VALUES ($1, $2, $3, 'pending', $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
    `, [
      id, req.user.id, orderNumber, address.id, addressJson, JSON.stringify(items),
      subtotal, deliveryFee, discount, total, normalizePayment(req.body.payment_method),
      deliveryType, note, idempotencyKey, createdAt,
    ].map((value, index) => index === 4 ? JSON.stringify(value) : value));
    await db.run(`
      INSERT INTO notifications (id, user_id, title, body, type, is_read, created_at)
      VALUES ($1, $2, $3, $4, 'order', FALSE, $5)
    `, [randomUUID(), req.user.id, 'سفارش ثبت شد', `سفارش ${orderNumber} با موفقیت ثبت شد.`, createdAt]);
    const row = await db.one('SELECT * FROM orders WHERE id = $1', [id]);
    res.status(201).json({ data: orderFromRow(row) });
  });

  api.post('/orders/:id/advance', auth, async (req, res) => {
    const row = await db.one(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!row) throw new ApiError(404, 'سفارش درخواستی پیدا نشد.', 'NOT_FOUND');
    const statuses = ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delivered'];
    const currentIndex = statuses.indexOf(row.status);
    if (currentIndex < 0 || currentIndex === statuses.length - 1) return res.json({ data: orderFromRow(row) });
    const status = statuses[currentIndex + 1];
    await db.run('UPDATE orders SET status = $1, updated_at = $2 WHERE id = $3', [status, nowIso(), row.id]);
    const updated = await db.one('SELECT * FROM orders WHERE id = $1', [row.id]);
    res.json({ data: orderFromRow(updated) });
  });

  api.post('/orders/:id/cancel', auth, async (req, res) => {
    const row = await db.one(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!row) throw new ApiError(404, 'سفارش درخواستی پیدا نشد.', 'NOT_FOUND');
    if (!['pending', 'confirmed'].includes(row.status)) {
      throw new ApiError(409, 'این سفارش دیگر قابل لغو نیست.', 'ORDER_NOT_CANCELLABLE');
    }
    await db.run("UPDATE orders SET status = 'cancelled', updated_at = $1 WHERE id = $2", [nowIso(), row.id]);
    const updated = await db.one('SELECT * FROM orders WHERE id = $1', [row.id]);
    res.json({ data: orderFromRow(updated) });
  });

  api.get('/notifications', auth, async (req, res) => {
    const rows = await db.many(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json({ data: rows.map(notificationFromRow) });
  });

  api.post('/notifications/read-all', auth, async (req, res) => {
    const result = await db.run(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id],
    );
    res.json({ data: { updated: Number(result.changes) } });
  });

  api.post('/notifications/:id/read', auth, async (req, res) => {
    const row = await db.one(
      'SELECT * FROM notifications WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id],
    );
    if (!row) throw new ApiError(404, 'اعلان درخواستی پیدا نشد.', 'NOT_FOUND');
    await db.run('UPDATE notifications SET is_read = TRUE WHERE id = $1', [row.id]);
    res.json({ data: { id: row.id, is_read: true } });
  });

  api.get('/profile', auth, (req, res) => res.json({ data: userFromRow(req.user) }));

  api.put('/profile', auth, async (req, res) => {
    const firstName = requiredString(req.body?.first_name, 'first_name', { max: 80 });
    const lastName = requiredString(req.body?.last_name, 'last_name', { max: 80 });
    const phone = cleanPhone(requiredString(req.body?.phone, 'phone', { min: 7, max: 30 }));
    const duplicate = await db.one(
      'SELECT id FROM users WHERE phone = $1 AND id <> $2',
      [phone, req.user.id],
    );
    if (duplicate) throw new ApiError(409, 'این شماره موبایل قبلاً ثبت شده است.', 'PHONE_EXISTS');
    await db.run(
      'UPDATE users SET first_name = $1, last_name = $2, phone = $3 WHERE id = $4',
      [firstName, lastName, phone, req.user.id],
    );
    const user = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    res.json({ data: userFromRow(user) });
  });

  app.use('/api/v1', api);

  app.use((_req, _res, next) => next(new ApiError(404, 'مسیر درخواستی پیدا نشد.', 'NOT_FOUND')));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ message: 'بدنه JSON معتبر نیست.', code: 'INVALID_JSON' });
    }
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    return res.status(status).json({
      message: status >= 500 ? 'خطای داخلی سرور رخ داد.' : error.message,
      code: error.code ?? 'INTERNAL_ERROR',
      ...(error.errors ? { errors: error.errors } : {}),
    });
  });

  return app;
}
