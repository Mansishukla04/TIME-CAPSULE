require('dotenv').config();
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;


// Create database
const db = new Database('database.db');

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT 'purple',
    is_favorite INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    file_path TEXT,
    is_favorite INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
  );
`);


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallbacksecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// File upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

// Auth middleware
function requireLogin(req, res, next) {
  if (req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login.html');
  }
}



// ========== ROUTES ==========

// ========== ROUTES ==========

app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.PASSWORD) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.json({ success: false, message: 'Wrong password' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ========== FOLDERS ==========

// Get all folders (only root, no nesting)
app.get('/api/folders', requireLogin, (req, res) => {
  const showDeleted = req.query.deleted === 'true';
  let folders;

  if (showDeleted) {
    folders = db.prepare('SELECT * FROM folders WHERE is_deleted = 1 ORDER BY created_at DESC').all();
  } else {
    folders = db.prepare('SELECT * FROM folders WHERE is_deleted = 0 ORDER BY created_at DESC').all();
  }
  res.json(folders);
});

// Create folder
app.post('/api/folders', requireLogin, (req, res) => {
  const { name, color } = req.body;
  if (!name || name.trim() === '') {
    return res.json({ success: false, message: 'Folder name required' });
  }

  const colors = ['purple', 'pink', 'blue', 'green', 'orange', 'teal'];
  const finalColor = color || colors[Math.floor(Math.random() * colors.length)];

  const result = db.prepare('INSERT INTO folders (name, color) VALUES (?, ?)').run(name.trim(), finalColor);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Soft delete folder
app.delete('/api/folders/:id', requireLogin, (req, res) => {
  db.prepare('UPDATE folders SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Restore folder
app.post('/api/folders/:id/restore', requireLogin, (req, res) => {
  db.prepare('UPDATE folders SET is_deleted = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Toggle favorite folder
app.post('/api/folders/:id/favorite', requireLogin, (req, res) => {
  const folder = db.prepare('SELECT is_favorite FROM folders WHERE id = ?').get(req.params.id);
  const newValue = folder.is_favorite ? 0 : 1;
  db.prepare('UPDATE folders SET is_favorite = ? WHERE id = ?').run(newValue, req.params.id);
  res.json({ success: true, is_favorite: newValue });
});

// ========== MEMORIES ==========

// Get memories of a folder
app.get('/api/folders/:id/memories', requireLogin, (req, res) => {
  const type = req.query.type;
  let memories;

  if (type && type !== 'all') {
    memories = db.prepare(`
      SELECT * FROM memories 
      WHERE folder_id = ? AND type = ? AND is_deleted = 0 
      ORDER BY created_at DESC
    `).all(req.params.id, type);
  } else {
    memories = db.prepare(`
      SELECT * FROM memories 
      WHERE folder_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC
    `).all(req.params.id);
  }
  res.json(memories);
});

// Add memory
app.post('/api/memories', requireLogin, upload.single('file'), (req, res) => {
  const { folder_id, type, title, content } = req.body;
  let file_path = null;

  if (req.file) {
    file_path = '/uploads/' + req.file.filename;
  }

  if (!folder_id || !type) {
    return res.json({ success: false, message: 'Missing required fields' });
  }

  const result = db.prepare(`
    INSERT INTO memories (folder_id, type, title, content, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(folder_id, type, title || null, content || null, file_path);

  res.json({ success: true, id: result.lastInsertRowid });
});

// Soft delete memory
app.delete('/api/memories/:id', requireLogin, (req, res) => {
  db.prepare('UPDATE memories SET is_deleted = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Restore memory
app.post('/api/memories/:id/restore', requireLogin, (req, res) => {
  db.prepare('UPDATE memories SET is_deleted = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Toggle favorite memory
app.post('/api/memories/:id/favorite', requireLogin, (req, res) => {
  const memory = db.prepare('SELECT is_favorite FROM memories WHERE id = ?').get(req.params.id);
  const newValue = memory.is_favorite ? 0 : 1;
  db.prepare('UPDATE memories SET is_favorite = ? WHERE id = ?').run(newValue, req.params.id);
  res.json({ success: true, is_favorite: newValue });
});

// Get all memories (for All / Favorites / Trash)
app.get('/api/memories', requireLogin, (req, res) => {
  const type = req.query.type;
  const favorite = req.query.favorite === 'true';
  const deleted = req.query.deleted === 'true';

  let query = 'SELECT m.*, f.name as folder_name FROM memories m LEFT JOIN folders f ON m.folder_id = f.id WHERE 1=1';
  const params = [];

  if (deleted) {
    query += ' AND m.is_deleted = 1';
  } else {
    query += ' AND m.is_deleted = 0';
  }

  if (favorite) {
    query += ' AND m.is_favorite = 1';
  }

  if (type && type !== 'all') {
    query += ' AND m.type = ?';
    params.push(type);
  }

  query += ' ORDER BY m.created_at DESC';
  const memories = db.prepare(query).all(...params);
  res.json(memories);
});

// Start server
app.listen(PORT, () => {
  console.log(`TIME CAPSULE running at http://localhost:${PORT}`);
});