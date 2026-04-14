import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "restaurant.db");

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

async function init() {
  try {
    // Clean rebuild (safe for dev/demo)
    await run("DROP TABLE IF EXISTS order_items");
    await run("DROP TABLE IF EXISTS orders");
    await run("DROP TABLE IF EXISTS menu_items");
    await run("DROP TABLE IF EXISTS shops");
    await run("DROP TABLE IF EXISTS users");

    await run(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('admin','owner','kitchen')),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        assigned_shop_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE shops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        location TEXT,
        owner_user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_user_id) REFERENCES users(id)
      )
    `);

    await run(`
      CREATE TABLE menu_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        price REAL NOT NULL,
        stock INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        description TEXT,
        image_url TEXT,
        FOREIGN KEY (shop_id) REFERENCES shops(id)
      )
    `);

    await run(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shop_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        total_amount REAL NOT NULL,
        payment_method TEXT NOT NULL,
        payment_txn TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (shop_id) REFERENCES shops(id)
      )
    `);

    await run(`
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        menu_item_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
      )
    `);

    const adminPass = hashPassword("admin123");
    const ownerPass = hashPassword("owner123");
    const kitchenPass = hashPassword("kitchen123");

    const admin = await run(
      "INSERT INTO users (username, role, password_hash, password_salt) VALUES (?, 'admin', ?, ?)",
      ["admin", adminPass.hash, adminPass.salt]
    );
    const owner = await run(
      "INSERT INTO users (username, role, password_hash, password_salt) VALUES (?, 'owner', ?, ?)",
      ["owner", ownerPass.hash, ownerPass.salt]
    );

    const shop = await run(
      "INSERT INTO shops (name, location, owner_user_id) VALUES (?, ?, ?)",
      ["Jeeavan South Kitchen", "Chennai", owner.lastID]
    );

    await run(
      "INSERT INTO users (username, role, password_hash, password_salt, assigned_shop_id) VALUES (?, 'kitchen', ?, ?, ?)",
      ["kitchen", kitchenPass.hash, kitchenPass.salt, shop.lastID]
    );

    const sampleItems = [
      [
        shop.lastID,
        "Idli",
        40,
        45,
        "Breakfast",
        "Soft steamed rice cakes served with chutney and sambar.",
        "https://images.unsplash.com/photo-1610192244261-3f33de3f55e3?auto=format&fit=crop&w=800&q=80"
      ],
      [
        shop.lastID,
        "Masala Dosa",
        90,
        32,
        "Breakfast",
        "Crispy dosa stuffed with spiced potato masala.",
        "https://images.unsplash.com/photo-1666190092159-3171cf0f402f?auto=format&fit=crop&w=800&q=80"
      ],
      [
        shop.lastID,
        "Samosa",
        25,
        60,
        "Snacks",
        "Golden-fried pastry filled with potato and peas.",
        "https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=800&q=80"
      ],
      [
        shop.lastID,
        "Masala Tea",
        20,
        110,
        "Beverages",
        "Freshly brewed chai with aromatic spices.",
        "https://images.unsplash.com/photo-1571934811356-5cc061b6821f?auto=format&fit=crop&w=800&q=80"
      ],
      [
        shop.lastID,
        "Veg Biryani",
        160,
        24,
        "Main Course",
        "Fragrant basmati rice cooked with mixed vegetables and spices.",
        "https://images.unsplash.com/photo-1563379091339-03246963d96c?auto=format&fit=crop&w=800&q=80"
      ],
      [
        shop.lastID,
        "Gulab Jamun",
        55,
        28,
        "Desserts",
        "Soft milk-solid dumplings soaked in saffron sugar syrup.",
        "https://images.unsplash.com/photo-1601050690117-94f5f6fa6159?auto=format&fit=crop&w=800&q=80"
      ]
    ];

    for (const item of sampleItems) {
      await run(
        `
          INSERT INTO menu_items (shop_id, name, price, stock, category, description, image_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        item
      );
    }

    console.log("Database initialized successfully at:", dbPath);
    console.log("Seed users:");
    console.log("- admin / admin123");
    console.log("- owner / owner123");
    console.log("- kitchen / kitchen123");
  } catch (error) {
    console.error("Failed to initialize database:", error.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

init();
