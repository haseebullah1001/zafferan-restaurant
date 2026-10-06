import bcrypt from 'bcryptjs';

const categoryRows = [
  ['all', 'همه', ''],
  ['afghan', 'غذای افغانی', 'https://images.unsplash.com/photo-1547592180-85f173990554?w=300'],
  ['kebab', 'کباب', 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=300'],
  ['pizza', 'پیتزا', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=300'],
  ['burger', 'برگر', 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=300'],
  ['chicken', 'مرغ', 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?w=300'],
  ['drink', 'نوشیدنی', 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=300'],
  ['dessert', 'دسر', 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300'],
];

const foodNames = [
  'قابلی پلو', 'منتو', 'آشک', 'بولانی سبزی', 'کباب سلطانی',
  'کباب مرغ', 'چلو کباب', 'کباب کوبیده', 'پیتزا مخصوص', 'پیتزا مرغ',
  'پیتزا سبزیجات', 'برگر مخصوص', 'چیزبرگر دوبل', 'برگر مرغ', 'مرغ بریان',
  'مرغ سوخاری', 'سیب‌زمینی ویژه', 'سالاد فصل', 'سوپ روز', 'دوغ محلی',
  'نوشابه', 'آب انار', 'چای سبز', 'کیک شکلاتی', 'فرنی زعفرانی',
];

const foodCategories = [
  'afghan', 'afghan', 'afghan', 'afghan', 'kebab', 'kebab', 'kebab', 'kebab',
  'pizza', 'pizza', 'pizza', 'burger', 'burger', 'burger', 'chicken', 'chicken',
  'afghan', 'afghan', 'afghan', 'drink', 'drink', 'drink', 'drink', 'dessert', 'dessert',
];

const foodImages = [
  'https://images.unsplash.com/photo-1547592180-85f173990554?w=900',
  'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=900',
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=900',
  'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=900',
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=900',
  'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=900',
];

const options = [
  { name: 'کوچک', price_delta: 0 },
  { name: 'متوسط', price_delta: 45 },
  { name: 'بزرگ', price_delta: 80 },
];

const extras = [
  { id: 'extra-cheese', name: 'پنیر اضافه', price: 35 },
  { id: 'extra-sauce', name: 'سس مخصوص', price: 20 },
  { id: 'extra-fries', name: 'سیب‌زمینی', price: 55 },
  { id: 'extra-drink', name: 'نوشابه', price: 30 },
];

export function foodFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    image_url: row.image_url,
    price: Number(row.price),
    old_price: row.old_price == null ? null : Number(row.old_price),
    rating: Number(row.rating),
    review_count: Number(row.review_count),
    category_id: row.category_id,
    preparation_minutes: Number(row.preparation_minutes),
    calories: row.calories == null ? null : Number(row.calories),
    is_popular: Boolean(row.is_popular),
    is_featured: Boolean(row.is_featured),
    options: typeof row.options_json === 'string' ? JSON.parse(row.options_json) : row.options_json,
    extras: typeof row.extras_json === 'string' ? JSON.parse(row.extras_json) : row.extras_json,
  };
}

export async function seedDatabase(db) {
  for (let index = 0; index < categoryRows.length; index += 1) {
    const [id, name, imageUrl] = categoryRows[index];
    await db.run(`
      INSERT INTO categories (id, name, image_url, sort_order)
      VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING
    `, [id, name, imageUrl, index]);
  }

  for (let index = 0; index < foodNames.length; index += 1) {
    const price = 90 + (index % 8) * 45;
    const hasDiscount = index % 5 === 0;
    await db.run(`
      INSERT INTO foods (
        id, name, description, image_url, price, old_price, rating, review_count,
        category_id, preparation_minutes, calories, is_popular, is_featured,
        options_json, extras_json, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)
      ON CONFLICT (id) DO NOTHING
    `, [
      `food-${index + 1}`,
      foodNames[index],
      'تهیه‌شده با مواد تازه، ادویه‌های اصیل و دستور مخصوص رستوران زعفران.',
      foodImages[index % foodImages.length],
      price,
      hasDiscount ? price + 50 : null,
      4.3 + (index % 6) * 0.1,
      24 + index * 7,
      foodCategories[index],
      15 + (index % 4) * 5,
      280 + index * 14,
      index < 8 || index % 6 === 0,
      hasDiscount,
      JSON.stringify(options),
      JSON.stringify(extras),
      index,
    ]);
  }

  let user = await db.one('SELECT id FROM users WHERE phone = $1', ['0700000000']);
  const userId = user?.id ?? 'u1';
  if (!user) {
    await db.run(`
      INSERT INTO users (id, first_name, last_name, phone, password_hash, avatar_url, created_at)
      VALUES ($1, $2, $3, $4, $5, NULL, $6)
    `, [userId, 'احمد', 'احمدی', '0700000000', bcrypt.hashSync('123456', 12), new Date().toISOString()]);
  }

  const addressCount = await db.one('SELECT COUNT(*)::int AS count FROM addresses WHERE user_id = $1', [userId]);
  if (addressCount.count === 0) {
    const now = new Date().toISOString();
    const addresses = [
      ['a1', 'خانه', 'کابل', 'ناحیه ۱۰', 'شهرنو، کوچه گل‌ها، روبه‌روی پارک', '۱۲', true],
      ['a2', 'دفتر', 'کابل', 'ناحیه ۴', 'وزیر اکبرخان، سرک پانزدهم', '۸', false],
      ['a3', 'خانه خانواده', 'هرات', 'مرکز شهر', 'جاده لیسه مهری', '۲۴', false],
    ];
    for (const [id, title, city, district, fullAddress, houseNumber, isDefault] of addresses) {
      await db.run(`
        INSERT INTO addresses (
          id, user_id, title, city, district, full_address, house_number,
          phone, note, is_default, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', $9, $10)
      `, [id, userId, title, city, district, fullAddress, houseNumber, '۰۷۰۰۰۰۰۰۰۰', isDefault, now]);
    }
  }

  const notificationCount = await db.one('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1', [userId]);
  if (notificationCount.count === 0) {
    const titles = [
      'سفارش تأیید شد', 'در حال آماده‌سازی', 'سفارش ارسال شد', 'تخفیف ویژه امروز',
      'سفارش تحویل شد', 'پیشنهاد زعفران', 'نشانی شما ذخیره شد', 'به زعفران خوش آمدید',
    ];
    const bodies = [
      'رستوران سفارش شما را تأیید کرد.', 'غذای شما با دقت در حال آماده‌شدن است.',
      'سفارش شما ارسال شد و به‌زودی می‌رسد.', 'امروز از ۲۰٪ تخفیف غذاهای منتخب استفاده کنید.',
      'امیدواریم از غذای خود لذت برده باشید.', 'قابلی پلوی ویژه امروز را امتحان کنید.',
      'نشانی جدید با موفقیت ذخیره شد.', 'دنیایی از طعم‌های اصیل در انتظار شماست.',
    ];
    for (let index = 0; index < titles.length; index += 1) {
      const type = index === 3 || index === 5 ? 'promotion' : index >= 6 ? 'general' : 'order';
      await db.run(`
        INSERT INTO notifications (id, user_id, title, body, type, is_read, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        `n${index}`, userId, titles[index], bodies[index], type, index > 3,
        new Date(Date.now() - index * 5 * 60 * 60 * 1000).toISOString(),
      ]);
    }
  }

  const orderCount = await db.one('SELECT COUNT(*)::int AS count FROM orders WHERE user_id = $1', [userId]);
  if (orderCount.count === 0) {
    const addressRow = await db.one('SELECT * FROM addresses WHERE id = $1', ['a1']);
    const address = {
      id: addressRow.id,
      title: addressRow.title,
      city: addressRow.city,
      district: addressRow.district,
      full_address: addressRow.full_address,
      house_number: addressRow.house_number,
      phone: addressRow.phone,
      note: addressRow.note,
      is_default: Boolean(addressRow.is_default),
    };
    const statuses = ['on_the_way', 'preparing', 'delivered', 'delivered', 'cancelled'];
    for (let index = 0; index < 5; index += 1) {
      const food = foodFromRow(await db.one('SELECT * FROM foods WHERE id = $1', [`food-${index + 1}`]));
      const quantity = index % 2 === 0 ? 2 : 1;
      const unitPrice = food.price + 45;
      const item = { food, quantity, selected_extras: [], selected_size: 'متوسط', unit_price: unitPrice };
      const subtotal = unitPrice * quantity;
      const discount = index === 2 ? 30 : 0;
      const createdAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000).toISOString();
      await db.run(`
        INSERT INTO orders (
          id, user_id, order_number, status, address_id, address_json, items_json,
          subtotal, delivery_fee, discount, total, payment_method, delivery_type,
          note, idempotency_key, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, 40, $9, $10, 'cash_on_delivery', 'standard', '', NULL, $11, $11)
      `, [
        `order-${index}`, userId, `ORD-${10248 - index}`, statuses[index], address.id,
        JSON.stringify(address), JSON.stringify([item]), subtotal, discount,
        subtotal + 40 - discount, createdAt,
      ]);
    }
  }
}
