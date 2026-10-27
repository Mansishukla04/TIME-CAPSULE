require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcryptjs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallbacksecret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Initialize Supabase using environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// File upload setup (Memory storage for Supabase)
const upload = multer({ storage: multer.memoryStorage() });

// Auth middleware
function requireLogin(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Not logged in' });
  }
}

// ==========================================
// ROUTES
// ==========================================

// Root redirect
app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard.html');
  } else {
    res.redirect('/login.html');
  }
});

// Fetch Capsules
app.get('/api/capsules', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('capsules')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create Capsule (with Supabase Storage upload)
app.post('/api/capsules', upload.single('mediaFile'), async (req, res) => {
  try {
    const { text_content, unlock_at } = req.body;
    let mediaUrl = null;

    if (req.file) {
      const fileName = `${Date.now()}-${req.file.originalname}`;
      
      const { error: uploadError } = await supabase.storage
        .from('capsule-media')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('capsule-media')
        .getPublicUrl(fileName);

      mediaUrl = publicUrlData.publicUrl;
    }

    const { data: dbData, error: dbError } = await supabase
      .from('capsules')
      .insert([
        { 
          text_content: text_content, 
          media_url: mediaUrl, 
          unlock_at: unlock_at 
        }
      ])
      .select();

    if (dbError) throw dbError;

    res.status(200).json({ success: true, data: dbData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Login / Register with Email + Password
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password || password.length < 4) {
      return res.json({ success: false, message: 'Email and password (min 4 characters) required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user already exists in Supabase
    let { data: users, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('email', cleanEmail);

    if (fetchError) throw fetchError;

    let user = users && users.length > 0 ? users[0] : null;

    if (user) {
      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        return res.json({ success: false, message: 'Wrong email or password' });
      }
    } else {
      const passwordHash = bcrypt.hashSync(password, 8);
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{ email: cleanEmail, password_hash: passwordHash }])
        .select()
        .single();

      if (insertError) throw insertError;
      user = newUser;
    }

    req.session.userId = user.id;
    req.session.loggedIn = true;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ========== FOLDERS ==========

app.get('/api/folders', requireLogin, async (req, res) => {
  try {
    const showDeleted = req.query.deleted === 'true';
    let query = supabase
      .from('folders')
      .select('*')
      .eq('user_id', req.session.userId)
      .eq('is_deleted', showDeleted ? 1 : 0)
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders', requireLogin, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || name.trim() === '') {
      return res.json({ success: false, message: 'Folder name required' });
    }

    const colors = ['purple', 'pink', 'blue', 'green', 'orange', 'teal'];
    const finalColor = color || colors[Math.floor(Math.random() * colors.length)];

    const { data, error } = await supabase
      .from('folders')
      .insert([{ user_id: req.session.userId, name: name.trim(), color: finalColor }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, id: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/folders/:id', requireLogin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('folders')
      .update({ is_deleted: 1 })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders/:id/restore', requireLogin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('folders')
      .update({ is_deleted: 0 })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/folders/:id/favorite', requireLogin, async (req, res) => {
  try {
    const { data: folder, error: fetchErr } = await supabase
      .from('folders')
      .select('is_favorite')
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId)
      .single();

    if (fetchErr || !folder) return res.json({ success: false });

    const newValue = folder.is_favorite ? 0 : 1;
    const { error: updateErr } = await supabase
      .from('folders')
      .update({ is_favorite: newValue })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (updateErr) throw updateErr;
    res.json({ success: true, is_favorite: newValue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== MEMORIES ==========

app.get('/api/folders/:id/memories', requireLogin, async (req, res) => {
  try {
    const type = req.query.type;
    let query = supabase
      .from('memories')
      .select('*')
      .eq('folder_id', req.params.id)
      .eq('user_id', req.session.userId)
      .eq('is_deleted', 0)
      .order('created_at', { ascending: false });

    if (type && type !== 'all') {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memories', requireLogin, upload.single('file'), async (req, res) => {
  try {
    const { folder_id, type, title, content } = req.body;
    let filePath = null;

    if (!folder_id || !type) {
      return res.json({ success: false, message: 'Missing required fields' });
    }

    const { data: folder, error: folderErr } = await supabase
      .from('folders')
      .select('id')
      .eq('id', folder_id)
      .eq('user_id', req.session.userId)
      .single();

    if (folderErr || !folder) {
      return res.json({ success: false, message: 'Folder not found' });
    }

    if (req.file) {
      const fileName = `${Date.now()}-${req.file.originalname}`;
      const { error: uploadError } = await supabase.storage
        .from('capsule-media')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('capsule-media')
        .getPublicUrl(fileName);

      filePath = publicUrlData.publicUrl;
    }

    const { data: result, error: insertErr } = await supabase
      .from('memories')
      .insert([{
        folder_id: folder_id,
        user_id: req.session.userId,
        type: type,
        title: title || null,
        content: content || null,
        file_path: filePath
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;
    res.json({ success: true, id: result.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/memories/:id', requireLogin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('memories')
      .update({ is_deleted: 1 })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memories/:id/restore', requireLogin, async (req, res) => {
  try {
    const { error } = await supabase
      .from('memories')
      .update({ is_deleted: 0 })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/memories/:id/favorite', requireLogin, async (req, res) => {
  try {
    const { data: memory, error: fetchErr } = await supabase
      .from('memories')
      .select('is_favorite')
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId)
      .single();

    if (fetchErr || !memory) return res.json({ success: false });

    const newValue = memory.is_favorite ? 0 : 1;
    const { error: updateErr } = await supabase
      .from('memories')
      .update({ is_favorite: newValue })
      .eq('id', req.params.id)
      .eq('user_id', req.session.userId);

    if (updateErr) throw updateErr;
    res.json({ success: true, is_favorite: newValue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/memories', requireLogin, async (req, res) => {
  try {
    const type = req.query.type;
    const favorite = req.query.favorite === 'true';
    const deleted = req.query.deleted === 'true';

    let query = supabase
      .from('memories')
      .select('*, folders(name)')
      .eq('user_id', req.session.userId)
      .eq('is_deleted', deleted ? 1 : 0);

    if (favorite) {
      query = query.eq('is_favorite', 1);
    }

    if (type && type !== 'all') {
      query = query.eq('type', type);
    }

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    const formattedData = data.map(m => ({
      ...m,
      folder_name: m.folders ? m.folders.name : null
    }));

    res.json(formattedData);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`TIME CAPSULE running at http://localhost:${PORT}`);
});