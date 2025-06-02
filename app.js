const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = './data/db.sqlite3';
const db = new sqlite3.Database(DB_PATH);

const RARITIES = [
  { key: "common", label: "Gewöhnlich", color: "gray", price: 0, xp: 1, chance: 0.7 },
  { key: "uncommon", label: "Ungewöhnlich", color: "green", price: 150, xp: 3, chance: 0.18 },
  { key: "rare", label: "Selten", color: "blue", price: 500, xp: 10, chance: 0.08 },
  { key: "epic", label: "Episch", color: "purple", price: 1500, xp: 30, chance: 0.03 },
  { key: "legendary", label: "Legendär", color: "gold", price: 5000, xp: 100, chance: 0.01 }
];
const SHINY_CHANCE = 1 / 512;

const LEGENDARY_IDS = [144, 145, 146, 150, 151];
const EPIC_IDS = [149];
const RARE_IDS = [131, 143, 142, 135, 130, 134, 133, 132];
const UNCOMMON_IDS = [6, 9, 65, 68, 76, 94, 97, 105, 110, 112, 113, 115, 122, 123, 124, 125, 126, 127, 128, 137, 139, 141];
const COMMON_IDS = Array.from({ length: 151 }, (_, i) => i + 1)
  .filter(i => !LEGENDARY_IDS.includes(i) && !EPIC_IDS.includes(i) && !RARE_IDS.includes(i) && !UNCOMMON_IDS.includes(i));

// --- Middleware ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "pokesecret",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: './data' }),
  cookie: { maxAge: 14 * 24 * 60 * 60 * 1000 }
}));

// --- DB Setup ---
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    coins INTEGER DEFAULT 0,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    is_admin INTEGER DEFAULT 0
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    pokemon_id INTEGER,
    pokemon_name TEXT,
    display_name TEXT,
    rarity TEXT,
    is_shiny INTEGER DEFAULT 0,
    count INTEGER DEFAULT 1,
    date_obtained INTEGER,
    gen TEXT,
    typen TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// --- Hilfsfunktionen ---
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function getRarityByKey(key) {
  return RARITIES.find(r => r.key === key);
}
function selectRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
async function getPokemonDetails(id) {
  const poke = await fetch(`https://pokeapi.co/api/v2/pokemon/${id}`).then(r => r.json());
  const species = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`).then(r => r.json());
  const deName = (species.names.find(n => n.language.name === "de") || species.names[0]).name;
  const generation = (species.generation.name.replace("generation-", "") || "").toUpperCase();
  const typen = poke.types.map(t => t.type.name);
  return {
    id,
    name: poke.name,
    display_name: deName,
    typen: typen.join(','),
    gen: generation,
    img: poke.sprites.other['official-artwork'].front_default
  };
}
function getRandomRarity() {
  const r = Math.random();
  let sum = 0;
  for (let rar of RARITIES) {
    sum += rar.chance;
    if (r < sum) return rar;
  }
  return RARITIES[0];
}
function getRandomPokemonIdByRarity(rarity) {
  if (rarity === "legendary") return selectRandom(LEGENDARY_IDS);
  if (rarity === "epic") return selectRandom(EPIC_IDS);
  if (rarity === "rare") return selectRandom(RARE_IDS);
  if (rarity === "uncommon") return selectRandom(UNCOMMON_IDS);
  return selectRandom(COMMON_IDS);
}

// --- Auth ---
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', (req, res) => {
  let username = req.body.username;
  let password = req.body.password;
  if (!/^[a-zA-Z0-9]+$/.test(username)) return res.render('register', { error: 'Nur Buchstaben und Zahlen erlaubt!' });
  db.get("SELECT * FROM users WHERE LOWER(username)=?", [username.toLowerCase()], (err, row) => {
    if (row) return res.render('register', { error: 'Benutzername existiert bereits!' });
    bcrypt.hash(password, 10, (err, hash) => {
      db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hash], function () {
        res.redirect('/login');
      });
    });
  });
});
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

// --- Startseite (Eier öffnen) ---
app.get('/', requireLogin, (req, res) => {
  db.get("SELECT * FROM users WHERE id=?", [req.session.user.id], (err, user) => {
    res.render('index', { user, rarities: RARITIES });
  });
});

// --- Ei öffnen (API) ---
app.post('/api/open-egg', requireLogin, async (req, res) => {
  let rarity = req.body.rarity || "common";
  let rarityObj = getRarityByKey(rarity);
  let userId = req.session.user.id;

  if (rarity !== "common") {
    db.get("SELECT coins FROM users WHERE id=?", [userId], (err, row) => {
      if (!row || row.coins < rarityObj.price) return res.json({ error: "Nicht genug Coins!" });
      db.run("UPDATE users SET coins = coins - ? WHERE id=?", [rarityObj.price, userId], () => openEgg(rarity, userId, res));
    });
  } else {
    openEgg(rarity, userId, res);
  }
});

async function openEgg(rarity, userId, res) {
  let pid = getRandomPokemonIdByRarity(rarity);
  let shiny = Math.random() < SHINY_CHANCE ? 1 : 0;
  let poke = await getPokemonDetails(pid);

  db.get("SELECT * FROM inventory WHERE user_id=? AND pokemon_id=? AND is_shiny=? AND rarity=?", [userId, pid, shiny, rarity], (err, found) => {
    if (found) {
      db.run("UPDATE inventory SET count = count + 1, date_obtained=? WHERE id=?", [Date.now(), found.id]);
    } else {
      db.run(`INSERT INTO inventory (user_id, pokemon_id, pokemon_name, display_name, rarity, is_shiny, count, date_obtained, gen, typen) 
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [userId, pid, poke.name, poke.display_name, rarity, shiny, Date.now(), poke.gen, poke.typen]);
    }
    let xpAdd = getRarityByKey(rarity).xp;
    db.run("UPDATE users SET xp = xp + ?, level = 1 + FLOOR(xp/100) WHERE id=?", [xpAdd, userId]);
    res.json({
      id: pid,
      name: poke.name,
      display_name: poke.display_name,
      img: poke.img,
      rarity,
      shiny,
      typen: poke.typen,
      gen: poke.gen,
      xpAdd
    });
  });
}

// --- Inventar (nur eigenes!) ---
app.get('/inventory', requireLogin, (req, res) => {
  db.all(`SELECT * FROM inventory WHERE user_id=? ORDER BY date_obtained DESC`, [req.session.user.id], (err, mons) => {
    res.render('inventory', { pokemon: mons, user: req.session.user });
  });
});

// --- Verkaufen (nur doppelte) ---
app.post('/sell', requireLogin, (req, res) => {
  let id = req.body.id;
  db.get("SELECT * FROM inventory WHERE id=? AND user_id=?", [id, req.session.user.id], (err, mon) => {
    if (!mon || mon.count <= 1) return res.redirect('/inventory');
    let coins = getRarityByKey(mon.rarity).price / 2;
    db.run("UPDATE inventory SET count = count - 1 WHERE id=?", [id]);
    db.run("UPDATE users SET coins=coins+? WHERE id=?", [coins, req.session.user.id]);
    res.redirect('/inventory');
  });
});

// --- Leaderboard ---
app.get('/leaderboard', requireLogin, (req, res) => {
  db.all("SELECT username, xp, level FROM users ORDER BY xp DESC LIMIT 10", [], (err, users) => {
    res.render('leaderboard', { users: users || [], user: req.session.user });
  });
});

app.listen(PORT, () => console.log('Pokémon Egg Game läuft auf Port ' + PORT));