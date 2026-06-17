require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
// TEST ENDPOINTS
// ============================================

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Advice API is running!',
    endpoints: {
      test: '/api/test',
      professionals: '/api/professionals',
      register: '/api/auth/register (POST)',
      login: '/api/auth/login (POST)',
      bookings: '/api/bookings (POST)'
    }
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Professionals endpoint
app.get('/api/professionals', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, p.expertise, p.bio, p.hourly_rate 
      FROM users u
      JOIN professionals p ON u.id = p.user_id
      WHERE u.role = 'professional' AND p.is_available = true
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// 1. REGISTER ENDPOINT
// ============================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role',
      [name, email, hashedPassword, role]
    );
    
    const user = result.rows[0];
    
    if (role === 'professional') {
      await pool.query(
        'INSERT INTO professionals (user_id, expertise, bio, hourly_rate) VALUES ($1, $2, $3, $4)',
        [user.id, 'Expert', 'I provide advice in this field', 50]
      );
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET);
    
    res.status(201).json({ user, token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// 2. LOGIN ENDPOINT
// ============================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET);
    
    res.json({ 
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// 3. CREATE BOOKING
// ============================================
app.post('/api/bookings', async (req, res) => {
  try {
    const { client_id, professional_id, booking_date, message } = req.body;
    
    const result = await pool.query(
      'INSERT INTO bookings (client_id, professional_id, booking_date, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [client_id, professional_id, booking_date, message]
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// 4. GET BOOKINGS FOR A USER
// ============================================
app.get('/api/bookings/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;
    
    const result = await pool.query(`
      SELECT b.*, 
             u1.name as client_name, 
             u2.name as professional_name
      FROM bookings b
      JOIN users u1 ON b.client_id = u1.id
      JOIN users u2 ON b.professional_id = u2.id
      WHERE b.client_id = $1 OR b.professional_id = $1
    `, [user_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================
// START SERVER
// ============================================
const startServer = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE,
        password_hash VARCHAR(255),
        role VARCHAR(20)
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS professionals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        expertise VARCHAR(255),
        bio TEXT,
        hourly_rate INTEGER,
        is_available BOOLEAN DEFAULT true
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id),
        professional_id INTEGER REFERENCES users(id),
        booking_date TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        message TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('✅ Tables created successfully');
    
    const count = await pool.query('SELECT COUNT(*) FROM professionals');
    if (parseInt(count.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO users (name, email, password_hash, role) VALUES 
        ('Dr. Sarah Chen', 'sarah@advice.com', '$2b$10$dummyhash', 'professional'),
        ('James Wilson', 'james@advice.com', '$2b$10$dummyhash', 'professional')
      `);
      
      await pool.query(`
        INSERT INTO professionals (user_id, expertise, bio, hourly_rate) VALUES
        ((SELECT id FROM users WHERE email = 'sarah@advice.com'), 'Career Counseling', '10 years in tech recruitment. Helped 500+ people land their dream jobs.', 75),
        ((SELECT id FROM users WHERE email = 'james@advice.com'), 'Financial Planning', 'CFA with 15 years experience. Specializing in retirement planning.', 100)
      `);
      console.log('✅ Sample professionals added');
    }
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔗 Test: http://localhost:${PORT}/api/test`);
      console.log(`🔗 Professionals: http://localhost:${PORT}/api/professionals`);
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
};

startServer();