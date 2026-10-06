import pg from 'pg';

import { seedDatabase } from './seed.js';

const { Pool } = pg;

class Database {
  constructor(pool) {
    this.pool = pool;
  }

  async query(sql, params = []) {
    return this.pool.query(sql, params);
  }

  async one(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0];
  }

  async many(sql, params = []) {
    return (await this.query(sql, params)).rows;
  }

  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return { changes: result.rowCount ?? 0, rows: result.rows };
  }

  async close() {
    await this.pool.end();
  }
}

export async function initializeDatabase(pool) {
  const db = new Database(pool);
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      challenge_id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      otp_hash TEXT NOT NULL,
      reset_token_hash TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      reset_expires_at TIMESTAMPTZ,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS foods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT NOT NULL,
      price DOUBLE PRECISION NOT NULL CHECK(price >= 0),
      old_price DOUBLE PRECISION,
      rating DOUBLE PRECISION NOT NULL,
      review_count INTEGER NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      preparation_minutes INTEGER NOT NULL,
      calories INTEGER,
      is_popular BOOLEAN NOT NULL DEFAULT FALSE,
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      options_json JSONB NOT NULL,
      extras_json JSONB NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      full_address TEXT NOT NULL,
      house_number TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (user_id, food_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      address_id TEXT NOT NULL,
      address_json JSONB NOT NULL,
      items_json JSONB NOT NULL,
      subtotal DOUBLE PRECISION NOT NULL,
      delivery_fee DOUBLE PRECISION NOT NULL,
      discount DOUBLE PRECISION NOT NULL,
      total DOUBLE PRECISION NOT NULL,
      payment_method TEXT NOT NULL,
      delivery_type TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      UNIQUE (user_id, idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_addresses_user ON addresses(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
  `);
  await seedDatabase(db);
  return db;
}

export async function createDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use a Neon PostgreSQL connection string.');
  }
  const ssl = process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: false };
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  return initializeDatabase(pool);
}
