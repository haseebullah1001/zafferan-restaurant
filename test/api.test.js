import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';
import request from 'supertest';

import { createApp } from '../src/app.js';
import { initializeDatabase } from '../src/db.js';

let db;
let api;
let token;

before(async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = memory.adapters.createPg();
  db = await initializeDatabase(new adapter.Pool());
  api = request(createApp(db));
  const response = await api
    .post('/api/v1/auth/login')
    .send({ phone: '0700000000', password: '123456' })
    .expect(200);
  token = response.body.data.access_token;
});

after(async () => db.close());

test('health endpoint is available', async () => {
  const response = await api.get('/health').expect(200);
  assert.equal(response.body.status, 'ok');
});

test('login rejects incorrect credentials', async () => {
  const response = await api
    .post('/api/v1/auth/login')
    .send({ phone: '0700000000', password: 'incorrect' })
    .expect(401);
  assert.equal(response.body.code, 'INVALID_CREDENTIALS');
});

test('menu returns seeded categories and foods', async () => {
  const categories = await api.get('/api/v1/categories').expect(200);
  const foods = await api.get('/api/v1/foods').expect(200);
  assert.equal(categories.body.data.length, 8);
  assert.equal(foods.body.data.length, 25);
  assert.equal(foods.body.data[0].name, 'قابلی پلو');
});

test('protected endpoints require a bearer token', async () => {
  await api.get('/api/v1/orders').expect(401);
});

test('order totals are recalculated from server prices', async () => {
  const response = await api
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', 'server-price-test')
    .send({
      address_id: 'a1',
      delivery_type: 'standard',
      payment_method: 'cash_on_delivery',
      coupon_code: 'WELCOME20',
      subtotal: 1,
      total: 1,
      items: [
        {
          food_id: 'food-1',
          quantity: 2,
          selected_size: 'متوسط',
          extra_ids: ['extra-drink'],
          unit_price: 1,
        },
      ],
    })
    .expect(201);

  assert.equal(response.body.data.subtotal, 330);
  assert.equal(response.body.data.discount, 66);
  assert.equal(response.body.data.delivery_fee, 40);
  assert.equal(response.body.data.total, 304);
});

test('order creation is idempotent', async () => {
  const payload = {
    address_id: 'a1',
    delivery_type: 'standard',
    payment_method: 'cash_on_delivery',
    items: [{ food_id: 'food-2', quantity: 1, selected_size: 'کوچک', extra_ids: [] }],
  };
  const first = await api
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', 'same-request')
    .send(payload)
    .expect(201);
  const second = await api
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', 'same-request')
    .send(payload)
    .expect(200);
  assert.equal(first.body.data.id, second.body.data.id);
});

test('a registered user can manage an address and profile', async () => {
  const phone = `07${Date.now().toString().slice(-8)}`;
  const registered = await api
    .post('/api/v1/auth/register')
    .send({
      first_name: 'مریم',
      last_name: 'احمدی',
      phone,
      password: 'secret12',
      password_confirmation: 'secret12',
    })
    .expect(201);
  const userToken = registered.body.data.access_token;

  const address = await api
    .post('/api/v1/addresses')
    .set('Authorization', `Bearer ${userToken}`)
    .send({
      title: 'خانه',
      city: 'کابل',
      district: 'ناحیه ۳',
      full_address: 'کارته چهار',
      house_number: '۲',
      phone,
      is_default: true,
    })
    .expect(201);
  assert.equal(address.body.data.is_default, true);

  const profile = await api
    .put('/api/v1/profile')
    .set('Authorization', `Bearer ${userToken}`)
    .send({ first_name: 'مریم', last_name: 'محمدی', phone })
    .expect(200);
  assert.equal(profile.body.data.last_name, 'محمدی');
});

test('password reset changes the login password', async () => {
  const forgot = await api
    .post('/api/v1/auth/forgot-password')
    .send({ phone: '0700000000' })
    .expect(202);
  const verified = await api
    .post('/api/v1/auth/verify-otp')
    .send({ challenge_id: forgot.body.challenge_id, otp: '1234' })
    .expect(200);
  await api
    .post('/api/v1/auth/reset-password')
    .send({
      reset_token: verified.body.data.reset_token,
      password: 'new-pass-123',
      password_confirmation: 'new-pass-123',
    })
    .expect(200);
  await api
    .post('/api/v1/auth/login')
    .send({ phone: '0700000000', password: 'new-pass-123' })
    .expect(200);
});
