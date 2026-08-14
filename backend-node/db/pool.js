const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon/대부분의 관리형 Postgres는 SSL 필수
});

module.exports = pool;
