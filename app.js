// Kompletter Server (siehe vorherige Nachricht für Details, alles wie beschrieben)
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = './data/db.sqlite3';
const db = new sqlite3.Database(DB_PATH);

// --- Middleware & Setup ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'pokesecret',
  resave: false,
  saveUninitialized: false
}));

// --- Raritäten-Konfiguration ---
const RARITIES = [
  { key: "common",      label: "Gewöhnlich",   color: "gray",    price: 100,    value: 20,    chance: 0.5 },
  { key: "uncommon",    label: "Ungewöhnlich", color: "green",   price: 250,    value: 80,    chance: 0.25 },
  { key: "rare",        label: "Selten",       color: "blue",    price: 600,    value: 250,   chance: 0.15 },
  { key: "epic",        label: "Episch",       color: "purple",  price: 1500,   value: 800,   chance: 0.08 },
  { key: "legendary",   label: "Legendär",     color: "gold",    price: 4000,   value: 3000,  chance: 0.02 }
];
const SHINY_CHANCE = 1/512;

// --- DB Setup ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    coins INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    packs_common INTEGER DEFAULT 10,
    last_pack_claim INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    pokemon_id INTEGER,
    pokemon_name TEXT,
    rarity TEXT,
    is_shiny INTEGER DEFAULT 0,
    value INTEGER,
    date_obtained INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS eggs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    rarity TEXT,
    opened INTEGER DEFAULT 0,
    date_obtained INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS packs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    rarity TEXT,
    amount INTEGER DEFAULT 0
  )`);
});

// --- Hilfsfunktionen ---
function validUsername(username) {
  return /^[a-zA-Z0-9]+$/.test(username);
}
function normalizeUsername(username) {
  return username.toLowerCase();
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getRarityByKey(key) {
  return RARITIES.find(r => r.key === key);
}
function getRarityByChance(rand) {
  let sum = 0;
  for (let r of RARITIES) {
    sum += r.chance;
    if (rand < sum) return r;
  }
  return RARITIES[0];
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.username.toLowerCase() !== 'haiq') return res.redirect('/login');
  next();
}

// --- Registrierung ---
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  if (!validUsername(username)) return res.render('register', { error: 'Nur Buchstaben und Zahlen erlaubt!' });
  let norm = normalizeUsername(username);
  db.get("SELECT * FROM users WHERE LOWER(username)=?", [norm], (err, row) => {
    if (row) return res.render('register', { error: 'Benutzername existiert bereits!' });
    bcrypt.hash(password, 10, (err, hash) => {
      db.run("INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)", [username, hash, norm === 'haiq' ? 1 : 0], function() {
        db.run("UPDATE users SET packs_common=10 WHERE id=?", [this.lastID]);
        res.redirect('/login');
      });
    });
  });
});

// --- Login / Logout ---
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  db.get("SELECT * FROM users WHERE LOWER(username)=?", [username.toLowerCase()], (err, user) => {
    if (!user) return res.render('login', { error: 'Falscher Benutzername oder Passwort!' });
    bcrypt.compare(password, user.password, (err, result) => {
      if (!result) return res.render('login', { error: 'Falscher Benutzername oder Passwort!' });
      req.session.user = { id: user.id, username: user.username, is_admin: !!user.is_admin };
      res.redirect('/');
    });
  });
});
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Dashboard ---
app.get('/', requireLogin, (req, res) => {
  db.get("SELECT * FROM users WHERE id=?", [req.session.user.id], (err, user) => {
    db.get("SELECT COUNT(*) AS eggCount FROM eggs WHERE user_id=? AND opened=0", [user.id], (err2, data) => {
      res.render('index', { user, eggCount: data.eggCount, rarities: RARITIES });
    });
  });
});

// --- Eier kaufen ---
app.post('/buy-egg', requireLogin, (req, res) => {
  let rarityKey = req.body.rarity;
  let rarity = getRarityByKey(rarityKey);
  if (!rarity) return res.redirect('/');
  db.get("SELECT coins FROM users WHERE id=?", [req.session.user.id], (err, row) => {
    if (row.coins < rarity.price) return res.send("Nicht genug Coins!");
    db.run("UPDATE users SET coins = coins - ? WHERE id=?", [rarity.price, req.session.user.id], () => {
      db.run("INSERT INTO eggs (user_id, rarity, date_obtained) VALUES (?, ?, ?)", [req.session.user.id, rarity.key, Date.now()], () => {
        res.redirect('/');
      });
    });
  });
});

// --- Eier öffnen (Seite + Animation) ---
app.get('/open-egg', requireLogin, (req, res) => {
  db.get("SELECT * FROM eggs WHERE user_id=? AND opened=0 ORDER BY date_obtained ASC LIMIT 1", [req.session.user.id], (err, egg) => {
    if (!egg) return res.send("Kein Ei zum Öffnen!");
    res.render('open_egg', { egg, rarities: RARITIES });
  });
});

// --- Eier öffnen (API) ---
app.post('/api/open-egg', requireLogin, async (req, res) => {
  db.get("SELECT * FROM eggs WHERE user_id=? AND opened=0 ORDER BY date_obtained ASC LIMIT 1", [req.session.user.id], async (err, egg) => {
    if (!egg) return res.json({ error: "Kein Ei vorhanden" });
    // Pokémon passend zur Rarität ziehen (Demo: zufällig von 1-151)
    let pid = randomInt(1, 151);
    let pokeData = await fetch(`https://pokeapi.co/api/v2/pokemon/${pid}`).then(r=>r.json());
    let shiny = Math.random() < SHINY_CHANCE ? 1 : 0;
    let rarity = getRarityByKey(egg.rarity);
    db.run("INSERT INTO inventory (user_id, pokemon_id, pokemon_name, rarity, is_shiny, value, date_obtained) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.session.user.id, pid, pokeData.name, rarity.key, shiny, shiny ? rarity.value * 10 : rarity.value, Date.now()]);
    db.run("UPDATE eggs SET opened=1 WHERE id=?", [egg.id]);
    res.json({
      name: pokeData.name,
      id: pid,
      img: pokeData.sprites.other['official-artwork'].front_default,
      rarity: rarity,
      shiny: shiny
    });
  });
});

// --- Inventar ---
app.get('/inventory', requireLogin, (req, res) => {
  let sortBy = req.query.sort || "date_obtained";
  db.all(`SELECT * FROM inventory WHERE user_id=? ORDER BY ${sortBy} DESC`, [req.session.user.id], (err, mons) => {
    res.render('inventory', { pokemon: mons, rarities: RARITIES, sortBy });
  });
});

// --- Pokémon verkaufen ---
app.post('/sell', requireLogin, (req, res) => {
  let id = req.body.id;
  db.get("SELECT * FROM inventory WHERE id=? AND user_id=?", [id, req.session.user.id], (err, mon) => {
    if (!mon) return res.redirect('/inventory');
    db.run("DELETE FROM inventory WHERE id=?", [id]);
    db.run("UPDATE users SET coins=coins+? WHERE id=?", [mon.value, req.session.user.id]);
    res.redirect('/inventory');
  });
});

// --- Packs claimen (jede Stunde 3 Packs) ---
app.post('/claim-packs', requireLogin, (req, res) => {
  db.get("SELECT * FROM users WHERE id=?", [req.session.user.id], (err, user) => {
    let now = Date.now();
    let last = user.last_pack_claim || 0;
    if (now - last < 60*60*1000) return res.send("Noch keine Stunde vergangen!");
    db.run("UPDATE users SET packs_common = packs_common + 3, last_pack_claim = ? WHERE id = ?", [now, user.id]);
    res.redirect('/');
  });
});

// --- Packs öffnen (Demo: Pack = Ei) ---
app.post('/open-pack', requireLogin, (req, res) => {
  db.get("SELECT packs_common FROM users WHERE id=?", [req.session.user.id], (err, user) => {
    if (user.packs_common <= 0) return res.send("Keine Packs mehr!");
    db.run("UPDATE users SET packs_common = packs_common - 1 WHERE id=?", [req.session.user.id], () => {
      db.run("INSERT INTO eggs (user_id, rarity, date_obtained) VALUES (?, ?, ?)", [req.session.user.id, 'common', Date.now()], () => {
        res.redirect('/');
      });
    });
  });
});

// --- Admin-Panel ---
app.get('/admin', requireAdmin, (req, res) => {
  db.all("SELECT * FROM users", [], (err, users) => {
    res.render('admin', { users });
  });
});
app.post('/admin/addcoins', requireAdmin, (req, res) => {
  let uid = req.body.user_id;
  let coins = parseInt(req.body.coins, 10);
  if (isNaN(coins)) return res.redirect('/admin');
  db.run("UPDATE users SET coins = coins + ? WHERE id = ?", [coins, uid], () => res.redirect('/admin'));
});
app.post('/admin/addpacks', requireAdmin, (req, res) => {
  let uid = req.body.user_id;
  let packs = parseInt(req.body.packs, 10);
  if (isNaN(packs)) return res.redirect('/admin');
  db.run("UPDATE users SET packs_common = packs_common + ? WHERE id = ?", [packs, uid], () => res.redirect('/admin'));
});

// --- User suchen ---
app.get('/user-search', requireLogin, (req, res) => {
  res.render('user_search', { results: null, query: "" });
});
app.post('/user-search', requireLogin, (req, res) => {
  let query = req.body.query;
  db.all("SELECT id, username FROM users WHERE LOWER(username) LIKE ?", [`%${query.toLowerCase()}%`], (err, users) => {
    res.render('user_search', { results: users, query });
  });
});
app.get('/user/:id/inventory', requireLogin, (req, res) => {
  let userId = req.params.id;
  db.all("SELECT * FROM inventory WHERE user_id=? ORDER BY date_obtained DESC", [userId], (err, mons) => {
    res.render('inventory', { pokemon: mons, rarities: RARITIES, sortBy: "date_obtained" });
  });
});

// --- Leaderboard (Top 10 nach Coins) ---
app.get('/leaderboard', requireLogin, (req, res) => {
  db.all("SELECT username, coins, level FROM users ORDER BY coins DESC LIMIT 10", [], (err, users) => {
    res.render('leaderboard', { users });
  });
});

// --- Serverstart ---
app.listen(PORT, () => console.log('Pokémon Egg Game läuft auf Port ' + PORT));