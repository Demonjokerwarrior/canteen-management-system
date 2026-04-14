import express from "express";
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "restaurant.db");

const app = express();
const port = process.env.PORT || 3000;
const db = new sqlite3.Database(dbPath);
const designPath = path.join(__dirname, "frontend-design");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/design", express.static(designPath));

// Minimal cookie + in-memory session (demo-friendly)
const sessions = new Map(); // sid -> { id, username, role, assignedShopId }
function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) return acc;
      const k = decodeURIComponent(pair.slice(0, idx));
      const v = decodeURIComponent(pair.slice(idx + 1));
      acc[k] = v;
      return acc;
    }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push("Path=/");
  parts.push("HttpOnly");
  if (options.maxAgeSeconds) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  res.setHeader("Set-Cookie", `${encodeURIComponent(name)}=; Path=/; HttpOnly; Max-Age=0`);
}

app.use(async (req, _res, next) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const sid = cookies.sid;
    req.user = sid ? sessions.get(sid) : null;
    next();
  } catch (error) {
    next(error);
  }
});

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

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function ensureTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
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
    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      location TEXT,
      owner_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS menu_items (
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
    CREATE TABLE IF NOT EXISTS orders (
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
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      menu_item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
    )
  `);
}

function layout(title, body, script = "", currentPath = "/", user = null) {
  const role = user?.role || "public";
  const navLinks =
    role === "admin"
      ? `
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/admin" ? "nav-link-active" : ""}" href="/admin">Admin</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/kitchen" ? "nav-link-active" : ""}" href="/kitchen">Kitchen</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/owner" ? "nav-link-active" : ""}" href="/owner">Owner</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm" href="/logout">Logout</a>
      `
      : role === "owner"
        ? `
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/owner" ? "nav-link-active" : ""}" href="/owner">Owner</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm" href="/logout">Logout</a>
      `
        : role === "kitchen"
          ? `
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/kitchen" ? "nav-link-active" : ""}" href="/kitchen">Kitchen</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm" href="/logout">Logout</a>
      `
          : `
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/" ? "nav-link-active" : ""}" href="/">Products</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/order-status" ? "nav-link-active" : ""}" href="/order-status">Order Status</a>
        <a class="px-3 py-2 rounded text-white/90 bg-white/10 text-sm ${currentPath === "/login" ? "nav-link-active" : ""}" href="/login">Staff Login</a>
      `;
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root { --saffron:#ff9933; --chakra:#000080; --green:#138808; --gold:#d4af37; }
      html { scroll-behavior:smooth; }
      body { font-family: Inter, sans-serif; background:
        radial-gradient(circle at 10% 0%, rgba(255,153,51,0.16), transparent 35%),
        radial-gradient(circle at 100% 20%, rgba(19,136,8,0.14), transparent 35%),
        linear-gradient(160deg, #020617, #061142 40%, #030d33 100%);
      }
      .brand-heading { font-family: Cinzel, serif; letter-spacing: 0.02em; }
      .glass { background: linear-gradient(130deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06)); border:1px solid rgba(255,255,255,0.25); backdrop-filter: blur(10px); }
      .pattern-bg::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.09; background:
        radial-gradient(circle at 50% 50%, transparent 28%, rgba(212,175,55,0.3) 29%, transparent 31%),
        repeating-conic-gradient(from 0deg, rgba(255,153,51,.20) 0 7deg, transparent 7deg 14deg); background-size: 520px 520px, 300px 300px; }
      .sparkle { position:fixed; inset:0; z-index:-1; pointer-events:none; }
      .nav-link-active { background: linear-gradient(120deg, rgba(255,153,51,.95), rgba(212,175,55,.95)); color:#fff; }
      .page-shell { position:relative; }
    </style>
  </head>
  <body class="text-slate-100 min-h-screen">
    <canvas id="sparkleCanvas" class="sparkle"></canvas>
    <div class="max-w-7xl mx-auto p-4 md:p-8 page-shell">
      <header class="mb-6 glass rounded-2xl p-4 md:p-6 pattern-bg relative overflow-hidden">
        <h1 class="text-3xl font-bold brand-heading">${title}</h1>
        <p class="text-sm text-blue-100 mt-1">${role === "public" ? "Mealqueue — Order Experience" : `Logged in as ${user?.username} (${role})`}</p>
        <nav class="mt-4 flex flex-wrap gap-2">
          ${navLinks}
        </nav>
      </header>
      ${body}
    </div>
    <script>
      const c = document.getElementById("sparkleCanvas");
      const ctx = c.getContext("2d");
      function fit(){ c.width = window.innerWidth; c.height = window.innerHeight; }
      fit(); window.addEventListener("resize", fit);
      const dots = Array.from({ length: 55 }, () => ({ x: Math.random()*c.width, y: Math.random()*c.height, r: Math.random()*2 + .4, v: Math.random()*0.35 + .1 }));
      (function loop(){
        ctx.clearRect(0,0,c.width,c.height);
        dots.forEach((d) => { ctx.beginPath(); ctx.arc(d.x,d.y,d.r,0,Math.PI*2); ctx.fillStyle = "rgba(255,170,85,.6)"; ctx.fill(); d.y -= d.v; if(d.y < -8){ d.y = c.height + 8; d.x = Math.random()*c.width; } });
        requestAnimationFrame(loop);
      })();
    </script>
    <script>${script}</script>
  </body>
  </html>`;
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      return;
    }
    next();
  };
}

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

app.get("/api/public/shops", async (_req, res) => {
  try {
    const shops = await all("SELECT id, name, location FROM shops ORDER BY id DESC");
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch shops." });
  }
});

app.get("/api/public/menu", async (req, res) => {
  try {
    const shopId = Number(req.query.shopId);
    if (!Number.isInteger(shopId) || shopId <= 0) {
      res.status(400).json({ error: "shopId is required." });
      return;
    }
    const rows = await all(
      "SELECT id, shop_id, name, price, stock, category, description, image_url FROM menu_items WHERE shop_id = ? ORDER BY category, name",
      [shopId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch menu items." });
  }
});

app.get("/api/public/order/:id", async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      res.status(400).json({ error: "Invalid order id." });
      return;
    }
    const order = await get(
      "SELECT id, customer_name, total_amount, status, created_at, payment_method, payment_txn FROM orders WHERE id = ?",
      [orderId]
    );
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch order." });
  }
});

app.post("/api/payment/simulate", async (req, res) => {
  const amount = Number(req.body.amount);
  const method = String(req.body.method || "upi").toLowerCase();
  const validMethods = ["upi", "card", "cod"];

  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: "Valid payment amount is required." });
    return;
  }

  if (!validMethods.includes(method)) {
    res.status(400).json({ error: "Invalid payment method." });
    return;
  }

  // Simulate payment gateway latency.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const success = Math.random() < (method === "cod" ? 0.98 : 0.9);

  if (!success) {
    res.status(402).json({ error: "Payment simulation failed. Please try again." });
    return;
  }

  const transactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
  res.json({ message: "Payment successful.", transactionId });
});

app.post("/api/order", async (req, res) => {
  const { customerName, items, shopId, paymentMethod, paymentTxn } = req.body;
  const parsedShopId = Number(shopId);

  if (!Number.isInteger(parsedShopId) || parsedShopId <= 0) {
    res.status(400).json({ error: "shopId is required." });
    return;
  }

  if (!customerName || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "Customer name and items are required." });
    return;
  }

  if (!paymentMethod || !paymentTxn) {
    res.status(400).json({ error: "Payment details are required." });
    return;
  }

  try {
    await run("BEGIN IMMEDIATE TRANSACTION");

    const normalizedItems = items
      .map((item) => ({
        menuItemId: Number(item.menuItemId),
        quantity: Number(item.quantity)
      }))
      .filter((item) => Number.isInteger(item.menuItemId) && item.quantity > 0);

    if (normalizedItems.length === 0) {
      throw new Error("No valid order items were provided.");
    }

    let totalAmount = 0;
    const lineItems = [];

    for (const item of normalizedItems) {
      const menuItem = await get(
        "SELECT id, shop_id, name, price, stock FROM menu_items WHERE id = ?",
        [item.menuItemId]
      );

      if (!menuItem) {
        throw new Error(`Menu item ${item.menuItemId} does not exist.`);
      }

      if (menuItem.shop_id !== parsedShopId) {
        throw new Error(`Menu item ${menuItem.name} does not belong to this shop.`);
      }

      if (menuItem.stock < item.quantity) {
        throw new Error(
          `Insufficient stock for ${menuItem.name}. Available: ${menuItem.stock}`
        );
      }

      const lineTotal = menuItem.price * item.quantity;
      totalAmount += lineTotal;
      lineItems.push({
        menuItemId: menuItem.id,
        quantity: item.quantity,
        unitPrice: menuItem.price
      });
    }

    const orderResult = await run(
      "INSERT INTO orders (shop_id, customer_name, total_amount, payment_method, payment_txn, status) VALUES (?, ?, ?, ?, ?, ?)",
      [parsedShopId, customerName, totalAmount, String(paymentMethod), String(paymentTxn), "pending"]
    );

    for (const lineItem of lineItems) {
      await run(
        `
          INSERT INTO order_items (order_id, menu_item_id, quantity, price)
          VALUES (?, ?, ?, ?)
        `,
        [orderResult.lastID, lineItem.menuItemId, lineItem.quantity, lineItem.unitPrice]
      );

      await run(
        "UPDATE menu_items SET stock = stock - ? WHERE id = ?",
        [lineItem.quantity, lineItem.menuItemId]
      );
    }

    await run("COMMIT");

    res.status(201).json({
      message: "Order placed successfully.",
      orderId: orderResult.lastID,
      totalAmount
    });
  } catch (error) {
    try {
      await run("ROLLBACK");
    } catch (_rollbackError) {
      // Ignore rollback errors and return original error.
    }
    res.status(400).json({ error: error.message || "Could not place order." });
  }
});

app.post("/api/order/:id/status", requireRole("admin", "kitchen"), async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body;
  const validStatuses = ["pending", "accepted", "preparing", "ready", "completed", "cancelled"];

  if (!Number.isInteger(orderId) || orderId <= 0) {
    res.status(400).json({ error: "Invalid order ID." });
    return;
  }

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status provided." });
    return;
  }

  try {
    if (req.user.role === "kitchen") {
      const order = await get("SELECT id, shop_id FROM orders WHERE id = ?", [orderId]);
      if (!order) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      if (Number(order.shop_id) !== Number(req.user.assignedShopId)) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }

    const result = await run("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);
    if (result.changes === 0) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    res.json({ message: "Order status updated successfully." });
  } catch (error) {
    res.status(500).json({ error: "Failed to update order status." });
  }
});

app.post("/api/inventory/update", requireRole("admin", "owner"), async (req, res) => {
  const menuItemId = Number(req.body.menuItemId);
  const stock = Number(req.body.stock);

  if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
    res.status(400).json({ error: "Invalid menu item ID." });
    return;
  }

  if (!Number.isInteger(stock) || stock < 0) {
    res.status(400).json({ error: "Stock must be a non-negative integer." });
    return;
  }

  try {
    if (req.user.role === "owner") {
      const owns = await get(
        `
        SELECT mi.id
        FROM menu_items mi
        INNER JOIN shops s ON s.id = mi.shop_id
        WHERE mi.id = ? AND s.owner_user_id = ?
        `,
        [menuItemId, req.user.id]
      );
      if (!owns) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }

    const result = await run("UPDATE menu_items SET stock = ? WHERE id = ?", [stock, menuItemId]);
    if (result.changes === 0) {
      res.status(404).json({ error: "Menu item not found." });
      return;
    }

    res.json({ message: "Stock updated successfully." });
  } catch (error) {
    res.status(500).json({ error: "Failed to update stock." });
  }
});

app.post("/api/menu", requireRole("admin", "owner"), async (req, res) => {
  const { shopId, name, price, stock, category, description, imageUrl } = req.body;
  const parsedShopId = Number(shopId);
  const parsedPrice = Number(price);
  const parsedStock = Number(stock);

  if (!Number.isInteger(parsedShopId) || parsedShopId <= 0) {
    res.status(400).json({ error: "shopId is required." });
    return;
  }

  if (!name || !category || !Number.isFinite(parsedPrice) || !Number.isInteger(parsedStock)) {
    res.status(400).json({ error: "Name, category, valid price, and integer stock are required." });
    return;
  }

  if (parsedPrice <= 0 || parsedStock < 0) {
    res.status(400).json({ error: "Price must be positive and stock cannot be negative." });
    return;
  }

  try {
    if (req.user.role === "owner") {
      const ownsShop = await get("SELECT id FROM shops WHERE id = ? AND owner_user_id = ?", [
        parsedShopId,
        req.user.id
      ]);
      if (!ownsShop) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }

    const result = await run(
      `
      INSERT INTO menu_items (shop_id, name, price, stock, category, description, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        parsedShopId,
        String(name).trim(),
        parsedPrice,
        parsedStock,
        String(category).trim(),
        description || "",
        imageUrl || ""
      ]
    );
    res.status(201).json({ message: "Menu item created.", id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: "Failed to create menu item." });
  }
});

app.post("/api/menu/:id/update", requireRole("admin", "owner"), async (req, res) => {
  const menuItemId = Number(req.params.id);
  const { shopId, name, price, stock, category, description, imageUrl } = req.body;
  const parsedShopId = Number(shopId);
  const parsedPrice = Number(price);
  const parsedStock = Number(stock);

  if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
    res.status(400).json({ error: "Invalid menu item ID." });
    return;
  }

  if (!Number.isInteger(parsedShopId) || parsedShopId <= 0) {
    res.status(400).json({ error: "shopId is required." });
    return;
  }

  if (!name || !category || !Number.isFinite(parsedPrice) || !Number.isInteger(parsedStock)) {
    res.status(400).json({ error: "Name, category, valid price, and integer stock are required." });
    return;
  }

  if (parsedPrice <= 0 || parsedStock < 0) {
    res.status(400).json({ error: "Price must be positive and stock cannot be negative." });
    return;
  }

  try {
    if (req.user.role === "owner") {
      const owns = await get(
        `
        SELECT mi.id
        FROM menu_items mi
        INNER JOIN shops s ON s.id = mi.shop_id
        WHERE mi.id = ? AND s.owner_user_id = ? AND mi.shop_id = ?
        `,
        [menuItemId, req.user.id, parsedShopId]
      );
      if (!owns) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }

    const result = await run(
      `
      UPDATE menu_items
      SET shop_id = ?, name = ?, price = ?, stock = ?, category = ?, description = ?, image_url = ?
      WHERE id = ?
      `,
      [
        parsedShopId,
        String(name).trim(),
        parsedPrice,
        parsedStock,
        String(category).trim(),
        description || "",
        imageUrl || "",
        menuItemId
      ]
    );
    if (result.changes === 0) {
      res.status(404).json({ error: "Menu item not found." });
      return;
    }
    res.json({ message: "Menu item updated." });
  } catch (error) {
    res.status(500).json({ error: "Failed to update menu item." });
  }
});

app.post("/api/menu/:id/delete", requireRole("admin", "owner"), async (req, res) => {
  const menuItemId = Number(req.params.id);
  if (!Number.isInteger(menuItemId) || menuItemId <= 0) {
    res.status(400).json({ error: "Invalid menu item ID." });
    return;
  }

  try {
    if (req.user.role === "owner") {
      const owns = await get(
        `
        SELECT mi.id
        FROM menu_items mi
        INNER JOIN shops s ON s.id = mi.shop_id
        WHERE mi.id = ? AND s.owner_user_id = ?
        `,
        [menuItemId, req.user.id]
      );
      if (!owns) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }

    const inUse = await get(
      `
      SELECT oi.id
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE oi.menu_item_id = ? AND o.status IN ('pending', 'accepted', 'preparing')
      LIMIT 1
      `,
      [menuItemId]
    );

    if (inUse) {
      res.status(400).json({ error: "Cannot delete item while it exists in active orders." });
      return;
    }

    const result = await run("DELETE FROM menu_items WHERE id = ?", [menuItemId]);
    if (result.changes === 0) {
      res.status(404).json({ error: "Menu item not found." });
      return;
    }
    res.json({ message: "Menu item deleted." });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete menu item." });
  }
});

app.get("/", (req, res) => {
  const body = `
    <section class="relative overflow-hidden glass rounded-3xl p-6 md:p-10 border border-white/30">
      <div id="introOverlay" class="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-xl z-20">
        <div class="text-center">
          <div class="mx-auto w-28 h-28 rounded-full border border-white/20 flex items-center justify-center mb-5 shadow-[0_0_50px_rgba(255,153,51,.25)]">
            <div class="w-20 h-20 rounded-full border border-white/20 animate-[spin_10s_linear_infinite]"></div>
          </div>
          <h2 class="text-4xl md:text-5xl brand-heading font-bold bg-gradient-to-r from-orange-300 via-white to-green-300 bg-clip-text text-transparent">
            Mealqueue
          </h2>
          <p class="mt-3 text-slate-200">A new era of Indian-futuristic ordering</p>
          <p class="mt-5 text-xs text-slate-300">Loading experience…</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-12 gap-6 items-start">
        <div class="lg:col-span-8">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 class="text-3xl brand-heading font-bold text-white">Discover Dishes</h2>
              <p class="text-slate-200 mt-1">Choose a shop, add items, pay, and track your order.</p>
            </div>
            <div class="flex gap-2">
              <select id="shopSelect" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2">
                <option value="" class="text-slate-900">Select shop…</option>
              </select>
              <input id="searchInput" class="border border-white/30 bg-white/10 text-white placeholder:text-slate-300 rounded-xl px-3 py-2 w-full md:w-64" placeholder="Search…" />
            </div>
          </div>

          <div class="mt-5 grid md:grid-cols-4 gap-3">
            <div class="glass rounded-2xl p-4 border border-white/20">
              <p class="text-xs text-slate-300">Payment</p>
              <p class="text-lg font-semibold">Simulated Gateway</p>
            </div>
            <div class="glass rounded-2xl p-4 border border-white/20">
              <p class="text-xs text-slate-300">Theme</p>
              <p class="text-lg font-semibold">Indian Futuristic</p>
            </div>
            <div class="glass rounded-2xl p-4 border border-white/20">
              <p class="text-xs text-slate-300">Status</p>
              <p class="text-lg font-semibold">Live Updates</p>
            </div>
            <div class="glass rounded-2xl p-4 border border-white/20">
              <p class="text-xs text-slate-300">Shops</p>
              <p class="text-lg font-semibold">Multi-shop Ready</p>
            </div>
          </div>

          <div class="mt-6">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xl font-semibold text-white">Products</h3>
              <p id="menuMeta" class="text-sm text-slate-200"></p>
            </div>
            <div id="menuGrid" class="grid sm:grid-cols-2 gap-4"></div>
          </div>
        </div>

        <aside class="lg:col-span-4 glass rounded-2xl border border-white/30 p-5 lg:sticky lg:top-6">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-xl font-semibold text-white brand-heading">Checkout</h2>
            <span id="cartCount" class="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-800">0 items</span>
          </div>
          <div class="mb-3">
            <label class="block text-sm font-medium mb-1 text-slate-100">Customer Name</label>
            <input id="customerName" class="w-full border border-white/30 bg-white/10 text-white placeholder:text-slate-300 rounded px-3 py-2" placeholder="Enter your name" />
          </div>
          <div class="mb-3">
            <label class="block text-sm font-medium mb-1 text-slate-100">Payment Method</label>
            <select id="paymentMethod" class="w-full border border-white/30 bg-white/10 text-white rounded px-3 py-2">
              <option value="upi" class="text-slate-900">UPI</option>
              <option value="card" class="text-slate-900">Card</option>
              <option value="cod" class="text-slate-900">Cash on Delivery</option>
            </select>
          </div>
          <div id="cartItems" class="space-y-2 mb-4 max-h-[320px] overflow-y-auto pr-1"></div>
          <div class="border-t border-white/20 pt-3">
            <p class="font-semibold mb-3 flex justify-between"><span>Total</span><span>Rs. <span id="cartTotal">0</span></span></p>
            <button id="placeOrderBtn" class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">
              Pay & Place Order
            </button>
            <p id="orderMessage" class="mt-3 text-sm"></p>
          </div>
        </aside>
      </div>
    </section>
  `;

  const script = `
    const introOverlay = document.getElementById("introOverlay");
    setTimeout(() => { introOverlay.style.opacity = "0"; introOverlay.style.transition = "opacity 900ms ease"; }, 1200);
    setTimeout(() => { introOverlay.style.display = "none"; }, 2200);

    const shopSelectEl = document.getElementById("shopSelect");
    const menuGrid = document.getElementById("menuGrid");
    const cartItemsEl = document.getElementById("cartItems");
    const cartTotalEl = document.getElementById("cartTotal");
    const orderMessageEl = document.getElementById("orderMessage");
    const customerNameEl = document.getElementById("customerName");
    const placeOrderBtn = document.getElementById("placeOrderBtn");
    const paymentMethodEl = document.getElementById("paymentMethod");
    const cartCountEl = document.getElementById("cartCount");
    const searchInputEl = document.getElementById("searchInput");
    const menuMetaEl = document.getElementById("menuMeta");

    let activeShopId = null;
    let menuItems = [];
    let searchTerm = "";

    function storageKey() {
      return "jeeavan_cart_" + (activeShopId || "none");
    }

    function loadCart() {
      return JSON.parse(localStorage.getItem(storageKey()) || "{}");
    }

    function saveCart(cart) {
      localStorage.setItem(storageKey(), JSON.stringify(cart));
    }

    function visibleItems() {
      const term = searchTerm.trim().toLowerCase();
      return menuItems.filter((i) => {
        if (!term) return true;
        const v = (i.name + " " + (i.description || "") + " " + i.category).toLowerCase();
        return v.includes(term);
      });
    }

    function renderMenu() {
      const list = visibleItems();
      menuMetaEl.textContent = activeShopId ? (list.length + " items") : "Select a shop";

      if (!activeShopId) {
        menuGrid.innerHTML = '<div class="glass rounded-2xl p-6 border border-white/20 text-slate-200">Select a shop to view products.</div>';
        return;
      }

      if (!list.length) {
        menuGrid.innerHTML = '<div class="glass rounded-2xl p-6 border border-white/20 text-slate-200">No products found.</div>';
        return;
      }

      const cart = loadCart();
      menuGrid.innerHTML = list.map((item) => {
        const out = item.stock === 0;
        const low = item.stock <= 10;
        const qty = cart[item.id] || 0;
        return \`
          <div class="glass rounded-2xl border border-white/20 overflow-hidden">
            <div class="grid grid-cols-5 gap-3 p-3">
              <div class="col-span-3">
                <p class="text-xs uppercase tracking-wide text-orange-200 font-semibold mb-1">\${item.category}</p>
                <h3 class="font-semibold text-lg text-white">\${item.name}</h3>
                <p class="text-sm text-slate-200 mt-1 min-h-[42px]">\${item.description || ""}</p>
                <p class="mt-2 font-semibold text-white">Rs. \${Number(item.price).toFixed(2)}</p>
                <p class="text-sm mt-1 \${out ? "text-red-300" : low ? "text-amber-200" : "text-emerald-200"}">Stock: \${item.stock}</p>
              </div>
              <div class="col-span-2">
                <img src="\${item.image_url || ""}" alt="\${item.name}" class="h-32 w-full rounded-xl object-cover border border-white/10" />
                <div class="mt-3 flex gap-2">
                  <button \${out ? "disabled" : ""} onclick="addToCart(\${item.id})" class="flex-1 py-2 rounded-xl font-medium text-white \${out ? "bg-white/10 cursor-not-allowed" : "bg-blue-600/80 hover:bg-blue-600"}">\${out ? "Out" : "ADD"}</button>
                  <div class="w-16 text-center text-xs text-slate-200 border border-white/20 rounded-xl py-2">\${qty}</div>
                </div>
              </div>
            </div>
          </div>\`;
      }).join("");
    }

    function renderCart() {
      const cart = loadCart();
      const entries = Object.entries(cart);
      const count = entries.reduce((acc, [, q]) => acc + Number(q), 0);
      cartCountEl.textContent = count + (count === 1 ? " item" : " items");

      if (!entries.length) {
        cartItemsEl.innerHTML = '<p class="text-sm text-slate-200">Cart is empty.</p>';
        cartTotalEl.textContent = "0";
        return;
      }

      let total = 0;
      cartItemsEl.innerHTML = entries.map(([id, qty]) => {
        const item = menuItems.find((m) => m.id === Number(id));
        if (!item) return "";
        const line = item.price * qty;
        total += line;
        return \`
          <div class="border border-white/15 rounded-xl p-2 bg-white/5">
            <div class="flex justify-between gap-2">
              <p class="font-medium text-white">\${item.name}</p>
              <p class="text-white">Rs. \${line.toFixed(2)}</p>
            </div>
            <div class="flex items-center gap-2 mt-2">
              <button class="px-2 py-1 bg-white/10 rounded" onclick="updateQuantity(\${item.id}, \${qty - 1})">-</button>
              <span class="min-w-8 text-center text-slate-100">\${qty}</span>
              <button class="px-2 py-1 bg-white/10 rounded" onclick="updateQuantity(\${item.id}, \${qty + 1})">+</button>
            </div>
          </div>\`;
      }).join("");
      cartTotalEl.textContent = total.toFixed(2);
    }

    function addToCart(itemId) {
      const cart = loadCart();
      const item = menuItems.find((m) => m.id === itemId);
      if (!item) return;
      const current = cart[itemId] || 0;
      if (current >= item.stock) return;
      cart[itemId] = current + 1;
      saveCart(cart);
      renderCart();
      renderMenu();
    }

    function updateQuantity(itemId, qty) {
      const cart = loadCart();
      const item = menuItems.find((m) => m.id === itemId);
      if (!item) return;
      if (qty <= 0) delete cart[itemId];
      else cart[itemId] = Math.min(qty, item.stock);
      saveCart(cart);
      renderCart();
      renderMenu();
    }

    async function loadShops() {
      const res = await fetch("/api/public/shops");
      const shops = await res.json();
      shopSelectEl.innerHTML = '<option value="" class="text-slate-900">Select shop…</option>' + shops.map((s) => \`<option value="\${s.id}" class="text-slate-900">\${s.name} \${s.location ? ("— " + s.location) : ""}</option>\`).join("");
    }

    async function loadMenu() {
      if (!activeShopId) { menuItems = []; renderMenu(); renderCart(); return; }
      const res = await fetch("/api/public/menu?shopId=" + encodeURIComponent(activeShopId));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load menu");
      menuItems = data;
      renderMenu();
      renderCart();
    }

    shopSelectEl.addEventListener("change", async (e) => {
      activeShopId = e.target.value ? Number(e.target.value) : null;
      await loadMenu();
    });

    searchInputEl.addEventListener("input", (e) => {
      searchTerm = e.target.value;
      renderMenu();
    });

    placeOrderBtn.addEventListener("click", async () => {
      orderMessageEl.textContent = "";
      if (!activeShopId) {
        orderMessageEl.textContent = "Please select a shop.";
        orderMessageEl.className = "mt-3 text-sm text-red-300";
        return;
      }

      const customerName = customerNameEl.value.trim();
      const cart = loadCart();
      const orderItems = Object.entries(cart).map(([id, qty]) => ({ menuItemId: Number(id), quantity: Number(qty) })).filter((i) => i.quantity > 0);
      if (!customerName) {
        orderMessageEl.textContent = "Please enter customer name.";
        orderMessageEl.className = "mt-3 text-sm text-red-300";
        return;
      }
      if (!orderItems.length) {
        orderMessageEl.textContent = "Cart is empty.";
        orderMessageEl.className = "mt-3 text-sm text-red-300";
        return;
      }

      try {
        placeOrderBtn.disabled = true;
        placeOrderBtn.textContent = "Processing payment...";
        const amount = Number(cartTotalEl.textContent || "0");
        const payRes = await fetch("/api/payment/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, method: paymentMethodEl.value })
        });
        const pay = await payRes.json();
        if (!payRes.ok) throw new Error(pay.error || "Payment failed.");

        placeOrderBtn.textContent = "Placing order...";
        const res = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerName, items: orderItems, shopId: activeShopId, paymentMethod: paymentMethodEl.value, paymentTxn: pay.transactionId })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to place order.");

        localStorage.removeItem(storageKey());
        orderMessageEl.textContent = "Payment " + pay.transactionId + " | Order ID: " + result.orderId + " (track in Order Status)";
        orderMessageEl.className = "mt-3 text-sm text-emerald-200";
        await loadMenu();
      } catch (err) {
        orderMessageEl.textContent = err.message;
        orderMessageEl.className = "mt-3 text-sm text-red-300";
      } finally {
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = "Pay & Place Order";
      }
    });

    loadShops().then(() => renderMenu()).catch(() => {});
    window.addToCart = addToCart;
    window.updateQuantity = updateQuantity;
  `;

  res.send(layout("Mealqueue", body, script, "/", req.user));
});

app.get("/design", (_req, res) => {
  res.sendFile(path.join(designPath, "index.html"));
});

app.get("/order-status", (req, res) => {
  const body = `
    <section class="glass rounded-3xl p-6 md:p-10 border border-white/30">
      <h2 class="text-3xl brand-heading font-bold text-white">Track Your Order</h2>
      <p class="text-slate-200 mt-2">Enter your Order ID to see live status updates.</p>
      <div class="mt-6 grid md:grid-cols-3 gap-4 items-start">
        <div class="md:col-span-1 glass rounded-2xl p-4 border border-white/20">
          <label class="block text-sm text-slate-200 mb-2">Order ID</label>
          <input id="orderIdInput" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="e.g. 12" />
          <button id="trackBtn" class="mt-3 w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">Track</button>
          <p class="text-xs text-slate-300 mt-3">Tip: after payment, you get an Order ID.</p>
        </div>
        <div class="md:col-span-2 glass rounded-2xl p-4 border border-white/20">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-semibold text-white">Status</h3>
            <span id="statusBadge" class="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-200">—</span>
          </div>
          <div id="orderDetails" class="mt-4 text-slate-200">
            <p>Enter an order ID to view details.</p>
          </div>
        </div>
      </div>
    </section>
  `;

  const script = `
    const orderIdInput = document.getElementById("orderIdInput");
    const trackBtn = document.getElementById("trackBtn");
    const statusBadge = document.getElementById("statusBadge");
    const orderDetails = document.getElementById("orderDetails");
    let pollTimer = null;

    function badge(status) {
      if (status === "pending") return "bg-amber-100 text-amber-800";
      if (status === "accepted") return "bg-blue-100 text-blue-800";
      if (status === "preparing") return "bg-purple-100 text-purple-800";
      if (status === "ready") return "bg-emerald-100 text-emerald-800";
      if (status === "completed") return "bg-slate-200 text-slate-800";
      if (status === "cancelled") return "bg-rose-100 text-rose-800";
      return "bg-white/10 text-slate-200";
    }

    async function fetchOrder(id) {
      const res = await fetch("/api/public/order/" + id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Not found");
      statusBadge.className = "text-xs px-2 py-1 rounded-full " + badge(data.status);
      statusBadge.textContent = data.status;
      orderDetails.innerHTML = \`
        <div class="grid sm:grid-cols-2 gap-3">
          <div class="glass rounded-xl p-3 border border-white/15">
            <p class="text-xs text-slate-300">Customer</p>
            <p class="text-white font-semibold">\${data.customer_name}</p>
          </div>
          <div class="glass rounded-xl p-3 border border-white/15">
            <p class="text-xs text-slate-300">Total</p>
            <p class="text-white font-semibold">Rs. \${Number(data.total_amount).toFixed(2)}</p>
          </div>
          <div class="glass rounded-xl p-3 border border-white/15">
            <p class="text-xs text-slate-300">Payment</p>
            <p class="text-white font-semibold">\${data.payment_method} — \${data.payment_txn}</p>
          </div>
          <div class="glass rounded-xl p-3 border border-white/15">
            <p class="text-xs text-slate-300">Created</p>
            <p class="text-white font-semibold">\${new Date(data.created_at).toLocaleString()}</p>
          </div>
        </div>
      \`;
    }

    function startPolling(id) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        fetchOrder(id).catch(() => {});
      }, 4000);
    }

    trackBtn.addEventListener("click", async () => {
      const id = Number(orderIdInput.value);
      if (!Number.isInteger(id) || id <= 0) {
        orderDetails.innerHTML = '<p class="text-red-300">Enter a valid order id.</p>';
        return;
      }
      try {
        await fetchOrder(id);
        startPolling(id);
      } catch (err) {
        statusBadge.className = "text-xs px-2 py-1 rounded-full bg-rose-100 text-rose-800";
        statusBadge.textContent = "not found";
        orderDetails.innerHTML = '<p class="text-red-300">' + err.message + "</p>";
      }
    });
  `;

  res.send(layout("Order Status", body, script, "/order-status", req.user));
});

app.get("/login", (req, res) => {
  const next = req.query.next ? String(req.query.next) : "/";
  const body = `
    <section class="glass rounded-3xl p-6 md:p-10 border border-white/30 max-w-xl mx-auto">
      <h2 class="text-3xl brand-heading font-bold text-white">Staff Login</h2>
      <p class="text-slate-200 mt-2">Admin, Kitchen, and Owner access only.</p>
      <form id="loginForm" class="mt-6 space-y-3">
        <input name="username" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Username" required />
        <input name="password" type="password" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Password" required />
        <input type="hidden" name="next" value="${next.replace(/"/g, "&quot;")}" />
        <button class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">Login</button>
      </form>
      <div class="mt-5 text-sm text-slate-200">
        <p class="font-semibold text-white">Demo credentials:</p>
        <ul class="mt-2 space-y-1">
          <li><span class="text-orange-200">admin</span> / admin123</li>
          <li><span class="text-orange-200">owner</span> / owner123</li>
          <li><span class="text-orange-200">kitchen</span> / kitchen123</li>
        </ul>
      </div>
      <p id="loginMsg" class="mt-4 text-sm"></p>
    </section>
  `;

  const script = `
    const form = document.getElementById("loginForm");
    const msg = document.getElementById("loginMsg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "";
      const data = Object.fromEntries(new FormData(form).entries());
      const res = await fetch("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const out = await res.json();
      if (!res.ok) {
        msg.textContent = out.error || "Login failed";
        msg.className = "mt-4 text-sm text-red-300";
        return;
      }
      window.location.href = out.redirect || "/";
    });
  `;

  res.send(layout("Login", body, script, "/login", req.user));
});

app.post("/login", async (req, res) => {
  const { username, password, next } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required." });
    return;
  }
  try {
    const user = await get(
      "SELECT id, username, role, password_hash, password_salt, assigned_shop_id FROM users WHERE username = ?",
      [String(username)]
    );
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    if (!verifyPassword(String(password), user.password_salt, user.password_hash)) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    const sid = crypto.randomBytes(18).toString("hex");
    sessions.set(sid, {
      id: user.id,
      username: user.username,
      role: user.role,
      assignedShopId: user.assigned_shop_id || null
    });
    setCookie(res, "sid", sid, { maxAgeSeconds: 60 * 60 * 8 });
    const redirect =
      user.role === "admin" ? "/admin" :
      user.role === "owner" ? "/owner" :
      "/kitchen";
    res.json({ message: "Logged in.", redirect: next && String(next).startsWith("/") ? String(next) : redirect });
  } catch (error) {
    res.status(500).json({ error: "Login error." });
  }
});

app.get("/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.sid) sessions.delete(cookies.sid);
  clearCookie(res, "sid");
  res.redirect("/");
});

app.get("/kitchen", requireRole("kitchen", "admin"), (req, res) => {
  const body = `
    <section class="glass rounded-2xl p-5 border border-white/30">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-2xl font-semibold brand-heading text-white">Kitchen Orders</h2>
        <p class="text-sm text-slate-200">Auto-refreshes every 5 seconds</p>
      </div>
      <div id="kitchenOrders" class="grid md:grid-cols-2 xl:grid-cols-3 gap-4"></div>
    </section>
  `;

  const script = `
    const kitchenOrdersEl = document.getElementById("kitchenOrders");
    const statusOrder = ["pending", "accepted", "preparing", "ready"];
    const nextStatusMap = {
      pending: "accepted",
      accepted: "preparing",
      preparing: "ready"
    };

    function statusClass(status) {
      if (status === "pending") return "bg-amber-100 text-amber-800";
      if (status === "accepted") return "bg-blue-100 text-blue-800";
      if (status === "preparing") return "bg-purple-100 text-purple-800";
      if (status === "ready") return "bg-emerald-100 text-emerald-800";
      return "bg-slate-100 text-slate-700";
    }

    async function updateStatus(orderId, status) {
      try {
        const response = await fetch("/api/order/" + orderId + "/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Status update failed");
        await loadOrders();
      } catch (error) {
        alert(error.message);
      }
    }

    async function loadOrders() {
      const response = await fetch("/api/kitchen/orders");
      if (!response.ok) throw new Error("Failed to fetch orders");
      const orders = await response.json();
      const filtered = orders.filter((order) => statusOrder.includes(order.status));

      if (!filtered.length) {
        kitchenOrdersEl.innerHTML = '<p class="text-slate-500">No active kitchen orders.</p>';
        return;
      }

      kitchenOrdersEl.innerHTML = filtered.map((order) => {
        const next = nextStatusMap[order.status];
        return \`
          <article class="glass rounded-lg shadow p-4 border border-white/30">
            <div class="flex justify-between items-center mb-2">
              <h3 class="font-bold text-lg text-white">Order #\${order.id}</h3>
              <span class="text-xs px-2 py-1 rounded-full \${statusClass(order.status)}">\${order.status}</span>
            </div>
            <p class="text-sm text-slate-200">Customer: <strong>\${order.customer_name}</strong></p>
            <p class="text-sm text-slate-200">Total: Rs. \${Number(order.total_amount).toFixed(2)}</p>
            <p class="text-xs text-slate-300 mt-1">\${new Date(order.created_at).toLocaleString()}</p>
            <div class="mt-3">
              \${next ? \`<button onclick="updateStatus(\${order.id}, '\${next}')" class="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white py-2 rounded">Mark as \${next}</button>\` : ""}
            </div>
          </article>
        \`;
      }).join("");
    }

    loadOrders().catch((error) => {
      kitchenOrdersEl.innerHTML = '<p class="text-red-600">' + error.message + "</p>";
    });

    setInterval(() => {
      loadOrders().catch(() => {});
    }, 5000);

    window.updateStatus = updateStatus;
  `;

  res.send(layout("Kitchen Display", body, script, "/kitchen", req.user));
});

app.get("/inventory", requireRole("admin", "owner"), (req, res) => {
  const body = `
    <section class="glass rounded-2xl shadow p-4 border border-white/30">
      <h2 class="text-2xl font-semibold brand-heading text-white mb-4">Inventory Management</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full text-sm text-slate-100">
          <thead>
            <tr class="text-left border-b">
              <th class="py-2 pr-4">Item</th>
              <th class="py-2 pr-4">Category</th>
              <th class="py-2 pr-4">Current Stock</th>
              <th class="py-2 pr-4">Update Stock</th>
              <th class="py-2 pr-4">Action</th>
            </tr>
          </thead>
          <tbody id="inventoryRows"></tbody>
        </table>
      </div>
      <p id="inventoryMessage" class="text-sm mt-4 text-slate-200"></p>
    </section>
  `;

  const script = `
    const inventoryRowsEl = document.getElementById("inventoryRows");
    const inventoryMessageEl = document.getElementById("inventoryMessage");

    async function loadInventory() {
      const response = await fetch("/api/owner/menu");
      if (!response.ok) throw new Error("Failed to load inventory");
      const items = await response.json();
      inventoryRowsEl.innerHTML = items.map((item) => \`
        <tr class="border-b border-white/20">
          <td class="py-2 pr-4 font-medium">\${item.name}</td>
          <td class="py-2 pr-4">\${item.category}</td>
          <td class="py-2 pr-4 \${item.stock <= 10 ? "text-amber-300 font-semibold" : "text-emerald-300"}">\${item.stock}</td>
          <td class="py-2 pr-4">
            <input id="stock-\${item.id}" type="number" min="0" value="\${item.stock}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-24" />
          </td>
          <td class="py-2 pr-4">
            <button onclick="saveStock(\${item.id})" class="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white px-3 py-1 rounded">
              Save
            </button>
          </td>
        </tr>
      \`).join("");
    }

    async function saveStock(menuItemId) {
      const input = document.getElementById("stock-" + menuItemId);
      const stock = Number(input.value);

      if (!Number.isInteger(stock) || stock < 0) {
        inventoryMessageEl.textContent = "Please enter a valid non-negative stock value.";
        inventoryMessageEl.className = "text-sm mt-4 text-red-600";
        return;
      }

      const response = await fetch("/api/inventory/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuItemId, stock })
      });
      const result = await response.json();
      if (!response.ok) {
        inventoryMessageEl.textContent = result.error || "Stock update failed.";
        inventoryMessageEl.className = "text-sm mt-4 text-red-600";
        return;
      }

      inventoryMessageEl.textContent = "Stock updated successfully.";
      inventoryMessageEl.className = "text-sm mt-4 text-emerald-600";
      await loadInventory();
    }

    loadInventory().catch((error) => {
      inventoryRowsEl.innerHTML = '<tr><td class="py-2 text-red-600" colspan="5">' + error.message + "</td></tr>";
    });

    window.saveStock = saveStock;
  `;

  res.send(layout("Inventory", body, script, "/inventory", req.user));
});

app.get("/owner", requireRole("owner", "admin"), (req, res) => {
  const body = `
    <section class="glass rounded-3xl p-6 md:p-10 border border-white/30 space-y-6">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h2 class="text-3xl brand-heading font-bold text-white">Shop Owner Panel</h2>
          <p class="text-slate-200 mt-1">Add shops, add products, and manage stock.</p>
        </div>
      </div>

      <div class="grid lg:grid-cols-12 gap-6">
        <div class="lg:col-span-4 glass rounded-2xl p-4 border border-white/20">
          <h3 class="text-xl font-semibold text-white mb-3">Your Shops</h3>
          <form id="createOwnerShopForm" class="space-y-3">
            <input name="name" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Shop name" required />
            <input name="location" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Location" />
            <button class="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white py-2 rounded-xl font-medium">Create Shop</button>
          </form>
          <div id="ownerShopList" class="mt-4 space-y-2"></div>
        </div>

        <div class="lg:col-span-8 space-y-6">
          <div class="glass rounded-2xl p-4 border border-white/20">
            <div class="flex items-center justify-between gap-3 mb-3">
              <h3 class="text-xl font-semibold text-white">Products</h3>
              <select id="ownerShopSelect" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2"></select>
            </div>
            <form id="ownerCreateProductForm" class="grid md:grid-cols-2 gap-3">
              <input name="name" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Item name" required />
              <input name="category" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Category" required />
              <input name="price" type="number" min="1" step="0.01" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Price" required />
              <input name="stock" type="number" min="0" step="1" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Stock" required />
              <input name="imageUrl" class="md:col-span-2 border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Image URL" />
              <textarea name="description" class="md:col-span-2 border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" rows="2" placeholder="Description"></textarea>
              <button class="md:col-span-2 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">Add Product</button>
            </form>
          </div>

          <div class="glass rounded-2xl p-4 border border-white/20 overflow-x-auto">
            <table class="min-w-full text-sm text-slate-100">
              <thead>
                <tr class="text-left border-b border-white/15">
                  <th class="py-2 pr-4">Item</th>
                  <th class="py-2 pr-4">Category</th>
                  <th class="py-2 pr-4">Price</th>
                  <th class="py-2 pr-4">Stock</th>
                  <th class="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody id="ownerMenuRows"></tbody>
            </table>
          </div>

          <p id="ownerMsg" class="text-sm text-slate-200"></p>
        </div>
      </div>
    </section>
  `;

  const script = `
    const ownerShopSelectEl = document.getElementById("ownerShopSelect");
    const ownerShopListEl = document.getElementById("ownerShopList");
    const ownerMenuRowsEl = document.getElementById("ownerMenuRows");
    const ownerMsgEl = document.getElementById("ownerMsg");
    const createOwnerShopForm = document.getElementById("createOwnerShopForm");
    const ownerCreateProductForm = document.getElementById("ownerCreateProductForm");

    function flash(text, ok=true){ ownerMsgEl.textContent = text; ownerMsgEl.className = "text-sm " + (ok ? "text-emerald-200" : "text-red-300"); }

    async function loadOwnerShops() {
      const res = await fetch("/api/owner/shops");
      const shops = await res.json();
      ownerShopListEl.innerHTML = shops.map((s) => \`
        <div class="border border-white/15 rounded-xl px-3 py-2 bg-white/5">
          <p class="text-white font-semibold">\${s.name}</p>
          <p class="text-xs text-slate-300">\${s.location || ""}</p>
        </div>\`
      ).join("");
      ownerShopSelectEl.innerHTML = shops.map((s) => \`<option value="\${s.id}" class="text-slate-900">\${s.name}</option>\`).join("");
      return shops;
    }

    async function loadOwnerMenu() {
      const shopId = Number(ownerShopSelectEl.value);
      const res = await fetch("/api/owner/menu?shopId=" + encodeURIComponent(shopId));
      const items = await res.json();
      ownerMenuRowsEl.innerHTML = items.map((i) => \`
        <tr class="border-b border-white/15">
          <td class="py-2 pr-4 font-medium"><input id="oname-\${i.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-44" value="\${i.name}" /></td>
          <td class="py-2 pr-4"><input id="ocat-\${i.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-28" value="\${i.category}" /></td>
          <td class="py-2 pr-4"><input id="oprice-\${i.id}" type="number" step="0.01" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-24" value="\${i.price}" /></td>
          <td class="py-2 pr-4"><input id="ostock-\${i.id}" type="number" step="1" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-20" value="\${i.stock}" /></td>
          <td class="py-2 pr-4">
            <div class="flex gap-2">
              <button class="bg-white/10 hover:bg-white/15 text-white px-3 py-1 rounded" onclick="saveOwnerItem(\${i.id})">Save</button>
              <button class="bg-rose-600/80 hover:bg-rose-600 text-white px-3 py-1 rounded" onclick="deleteOwnerItem(\${i.id})">Delete</button>
            </div>
          </td>
        </tr>\`
      ).join("");
    }

    async function saveOwnerItem(id) {
      const shopId = Number(ownerShopSelectEl.value);
      const payload = {
        shopId,
        name: document.getElementById("oname-" + id).value.trim(),
        category: document.getElementById("ocat-" + id).value.trim(),
        price: Number(document.getElementById("oprice-" + id).value),
        stock: Number(document.getElementById("ostock-" + id).value),
        description: "",
        imageUrl: ""
      };
      const res = await fetch("/api/menu/" + id + "/update", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) { flash(out.error || "Update failed", false); return; }
      flash("Updated.");
      await loadOwnerMenu();
    }

    async function deleteOwnerItem(id) {
      const res = await fetch("/api/menu/" + id + "/delete", { method:"POST", headers:{ "Content-Type":"application/json" } });
      const out = await res.json();
      if (!res.ok) { flash(out.error || "Delete failed", false); return; }
      flash("Deleted.");
      await loadOwnerMenu();
    }

    createOwnerShopForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(createOwnerShopForm).entries());
      const res = await fetch("/api/owner/shops", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) { flash(out.error || "Create failed", false); return; }
      flash("Shop created.");
      createOwnerShopForm.reset();
      await loadOwnerShops();
      await loadOwnerMenu();
    });

    ownerCreateProductForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const shopId = Number(ownerShopSelectEl.value);
      const payload = Object.fromEntries(new FormData(ownerCreateProductForm).entries());
      payload.shopId = shopId;
      payload.price = Number(payload.price);
      payload.stock = Number(payload.stock);
      const res = await fetch("/api/menu", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) { flash(out.error || "Create failed", false); return; }
      flash("Product created.");
      ownerCreateProductForm.reset();
      await loadOwnerMenu();
    });

    ownerShopSelectEl.addEventListener("change", () => { loadOwnerMenu().catch(() => {}); });

    loadOwnerShops().then(() => loadOwnerMenu()).catch(() => {});
    window.saveOwnerItem = saveOwnerItem;
    window.deleteOwnerItem = deleteOwnerItem;
  `;

  res.send(layout("Owner", body, script, "/owner", req.user));
});

app.get("/api/admin/orders", requireRole("admin"), async (_req, res) => {
  try {
    const orders = await all(
      `
      SELECT o.id, o.customer_name, o.total_amount, o.status, o.created_at, s.name as shop_name
      FROM orders o
      INNER JOIN shops s ON s.id = o.shop_id
      ORDER BY datetime(o.created_at) DESC, o.id DESC
      `
    );
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch admin orders." });
  }
});

app.get("/api/kitchen/orders", requireRole("kitchen", "admin"), async (req, res) => {
  try {
    if (req.user.role === "admin") {
      const orders = await all(
        "SELECT id, customer_name, total_amount, status, created_at FROM orders ORDER BY datetime(created_at) DESC, id DESC"
      );
      res.json(orders);
      return;
    }
    const orders = await all(
      `
      SELECT id, customer_name, total_amount, status, created_at
      FROM orders
      WHERE shop_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      `,
      [req.user.assignedShopId]
    );
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch kitchen orders." });
  }
});

app.get("/api/admin/shops", requireRole("admin"), async (_req, res) => {
  try {
    const shops = await all(
      `
      SELECT s.id, s.name, s.location, s.owner_user_id, u.username as owner_username
      FROM shops s
      LEFT JOIN users u ON u.id = s.owner_user_id
      ORDER BY s.id DESC
      `
    );
    res.json(shops);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch shops." });
  }
});

app.post("/api/admin/shops", requireRole("admin"), async (req, res) => {
  const { name, location, ownerUserId } = req.body;
  const ownerId = Number(ownerUserId);
  if (!name || !Number.isInteger(ownerId) || ownerId <= 0) {
    res.status(400).json({ error: "Name and ownerUserId are required." });
    return;
  }
  try {
    const owner = await get("SELECT id FROM users WHERE id = ? AND role = 'owner'", [ownerId]);
    if (!owner) {
      res.status(400).json({ error: "Invalid owner." });
      return;
    }
    const result = await run("INSERT INTO shops (name, location, owner_user_id) VALUES (?, ?, ?)", [
      String(name).trim(),
      location ? String(location).trim() : "",
      ownerId
    ]);
    res.status(201).json({ message: "Shop created.", id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: "Failed to create shop." });
  }
});

app.get("/api/admin/menu", requireRole("admin"), async (req, res) => {
  try {
    const shopId = req.query.shopId ? Number(req.query.shopId) : null;
    const rows = shopId
      ? await all(
          "SELECT id, shop_id, name, price, stock, category, description, image_url FROM menu_items WHERE shop_id = ? ORDER BY category, name",
          [shopId]
        )
      : await all(
          "SELECT id, shop_id, name, price, stock, category, description, image_url FROM menu_items ORDER BY shop_id, category, name"
        );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch menu items." });
  }
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

app.get("/api/admin/users", requireRole("admin"), async (_req, res) => {
  try {
    const users = await all("SELECT id, username, role, assigned_shop_id FROM users ORDER BY id DESC");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users." });
  }
});

app.post("/api/admin/users", requireRole("admin"), async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !["admin", "owner", "kitchen"].includes(String(role))) {
    res.status(400).json({ error: "username, password, and valid role are required." });
    return;
  }
  try {
    const pw = hashPassword(String(password));
    const result = await run(
      "INSERT INTO users (username, role, password_hash, password_salt) VALUES (?, ?, ?, ?)",
      [String(username).trim(), String(role), pw.hash, pw.salt]
    );
    res.status(201).json({ message: "User created.", id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: "Failed to create user (username may already exist)." });
  }
});

app.post("/api/admin/users/:id/delete", requireRole("admin"), async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid user id." });
    return;
  }
  if (req.user.id === userId) {
    res.status(400).json({ error: "Cannot delete yourself." });
    return;
  }
  try {
    const result = await run("DELETE FROM users WHERE id = ?", [userId]);
    if (result.changes === 0) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ message: "User deleted." });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete user." });
  }
});

app.get("/api/owner/shops", requireRole("owner", "admin"), async (req, res) => {
  try {
    const rows =
      req.user.role === "admin"
        ? await all("SELECT id, name, location FROM shops ORDER BY id DESC")
        : await all("SELECT id, name, location FROM shops WHERE owner_user_id = ? ORDER BY id DESC", [
            req.user.id
          ]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch owner shops." });
  }
});

app.post("/api/owner/shops", requireRole("owner", "admin"), async (req, res) => {
  const { name, location } = req.body;
  if (!name) {
    res.status(400).json({ error: "Shop name is required." });
    return;
  }
  try {
    const ownerId = req.user.role === "admin" ? req.user.id : req.user.id;
    const result = await run("INSERT INTO shops (name, location, owner_user_id) VALUES (?, ?, ?)", [
      String(name).trim(),
      location ? String(location).trim() : "",
      ownerId
    ]);
    res.status(201).json({ message: "Shop created.", id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: "Failed to create shop." });
  }
});

app.get("/api/owner/menu", requireRole("owner", "admin"), async (req, res) => {
  try {
    const shopId = req.query.shopId ? Number(req.query.shopId) : null;
    if (!shopId) {
      // used by inventory page fallback - return all owner items
      const rows =
        req.user.role === "admin"
          ? await all("SELECT id, shop_id, name, price, stock, category, description, image_url FROM menu_items")
          : await all(
              `
            SELECT mi.id, mi.shop_id, mi.name, mi.price, mi.stock, mi.category, mi.description, mi.image_url
            FROM menu_items mi
            INNER JOIN shops s ON s.id = mi.shop_id
            WHERE s.owner_user_id = ?
            `,
              [req.user.id]
            );
      res.json(rows);
      return;
    }

    if (req.user.role === "owner") {
      const owns = await get("SELECT id FROM shops WHERE id = ? AND owner_user_id = ?", [shopId, req.user.id]);
      if (!owns) {
        res.status(403).json({ error: "Not allowed." });
        return;
      }
    }
    const rows = await all(
      "SELECT id, shop_id, name, price, stock, category, description, image_url FROM menu_items WHERE shop_id = ? ORDER BY category, name",
      [shopId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch owner menu." });
  }
});

app.get("/admin", requireRole("admin"), (req, res) => {
  const body = `
    <section class="space-y-6">
      <div class="bg-gradient-to-r from-orange-500/90 via-blue-900 to-green-700/90 rounded-2xl p-6 text-white border border-white/30">
        <h2 class="text-3xl font-bold brand-heading">Admin Control Center</h2>
        <p class="text-slate-200 mt-1">Manage users, shops, orders, and products.</p>
      </div>

      <div class="grid lg:grid-cols-12 gap-6">
        <div class="lg:col-span-8 space-y-6">
          <article class="glass rounded-xl border border-white/25 shadow-sm p-4">
            <h3 class="text-lg font-semibold mb-4 text-white">Order Management</h3>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm text-slate-100">
                <thead>
                  <tr class="text-left border-b">
                    <th class="py-2 pr-4">Order</th>
                    <th class="py-2 pr-4">Shop</th>
                    <th class="py-2 pr-4">Customer</th>
                    <th class="py-2 pr-4">Total</th>
                    <th class="py-2 pr-4">Status</th>
                    <th class="py-2 pr-4">Created</th>
                    <th class="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody id="adminOrderRows"></tbody>
              </table>
            </div>
          </article>

          <article class="glass rounded-xl border border-white/25 shadow-sm p-4">
            <div class="flex items-center justify-between gap-3 mb-3">
              <h3 class="text-lg font-semibold text-white">Products</h3>
              <select id="adminShopSelect" class="border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2">
                <option value="" class="text-slate-900">All shops</option>
              </select>
            </div>
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm text-slate-100">
                <thead>
                  <tr class="text-left border-b">
                    <th class="py-2 pr-4">Item</th>
                    <th class="py-2 pr-4">Category</th>
                    <th class="py-2 pr-4">Price</th>
                    <th class="py-2 pr-4">Stock</th>
                    <th class="py-2 pr-4">Shop</th>
                    <th class="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody id="adminMenuRows"></tbody>
              </table>
            </div>
          </article>

          <article class="glass rounded-xl border border-white/25 shadow-sm p-4">
            <h3 class="text-lg font-semibold mb-4 text-white">User Management</h3>
            <div class="grid md:grid-cols-2 gap-4">
              <div class="glass rounded-xl border border-white/15 p-3">
                <h4 class="font-semibold text-white mb-2">Create User</h4>
                <form id="createUserForm" class="space-y-2">
                  <input name="username" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Username" required />
                  <input name="password" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Password" required />
                  <select name="role" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2">
                    <option value="owner" class="text-slate-900">Owner</option>
                    <option value="kitchen" class="text-slate-900">Kitchen</option>
                    <option value="admin" class="text-slate-900">Admin</option>
                  </select>
                  <button class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">Create</button>
                </form>
              </div>
              <div class="glass rounded-xl border border-white/15 p-3">
                <h4 class="font-semibold text-white mb-2">Users</h4>
                <div id="userList" class="space-y-2 max-h-[220px] overflow-y-auto pr-1"></div>
              </div>
            </div>
          </article>
        </div>

        <aside class="lg:col-span-4 space-y-6">
          <article class="glass rounded-xl border border-white/25 shadow-sm p-4">
            <h3 class="text-lg font-semibold mb-3 text-white">Add Shop</h3>
            <form id="createShopForm" class="space-y-3">
              <input name="name" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Shop name" required />
              <input name="location" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Location" />
              <select name="ownerUserId" id="shopOwnerSelect" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2"></select>
              <button class="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white py-2 rounded-xl font-medium">Create Shop</button>
            </form>
          </article>

          <article class="glass rounded-xl border border-white/25 shadow-sm p-4">
            <h3 class="text-lg font-semibold mb-3 text-white">Add Product</h3>
            <form id="createMenuForm" class="space-y-3">
              <select name="shopId" id="createMenuShopSelect" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2"></select>
              <input name="name" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Item name" required />
              <input name="category" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Category" required />
              <div class="grid grid-cols-2 gap-2">
                <input name="price" type="number" min="1" step="0.01" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Price" required />
                <input name="stock" type="number" min="0" step="1" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Stock" required />
              </div>
              <textarea name="description" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" rows="3" placeholder="Description"></textarea>
              <input name="imageUrl" class="w-full border border-white/30 bg-white/10 text-white rounded-xl px-3 py-2" placeholder="Image URL" />
              <button class="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white py-2 rounded-xl font-medium">Create Product</button>
            </form>
          </article>
        </aside>
      </div>

      <p id="adminMessage" class="text-sm text-slate-200"></p>
    </section>
  `;

  const script = `
    const adminOrderRowsEl = document.getElementById("adminOrderRows");
    const adminMenuRowsEl = document.getElementById("adminMenuRows");
    const createMenuFormEl = document.getElementById("createMenuForm");
    const adminMessageEl = document.getElementById("adminMessage");
    const adminShopSelectEl = document.getElementById("adminShopSelect");
    const createShopFormEl = document.getElementById("createShopForm");
    const shopOwnerSelectEl = document.getElementById("shopOwnerSelect");
    const createMenuShopSelectEl = document.getElementById("createMenuShopSelect");
    const createUserFormEl = document.getElementById("createUserForm");
    const userListEl = document.getElementById("userList");
    const statusOptions = ["pending", "accepted", "preparing", "ready", "completed", "cancelled"];

    function badgeClass(status) {
      if (status === "pending") return "bg-amber-100 text-amber-800";
      if (status === "accepted") return "bg-blue-100 text-blue-800";
      if (status === "preparing") return "bg-purple-100 text-purple-800";
      if (status === "ready") return "bg-emerald-100 text-emerald-800";
      if (status === "completed") return "bg-slate-200 text-slate-800";
      if (status === "cancelled") return "bg-rose-100 text-rose-800";
      return "bg-slate-100 text-slate-700";
    }

    function flashMessage(text, ok = true) {
      adminMessageEl.textContent = text;
      adminMessageEl.className = "text-sm " + (ok ? "text-emerald-200" : "text-red-300");
    }

    async function loadOrders() {
      const response = await fetch("/api/admin/orders");
      if (!response.ok) throw new Error("Failed to load orders");
      const orders = await response.json();

      if (!orders.length) {
        adminOrderRowsEl.innerHTML = '<tr><td colspan="6" class="py-2 text-slate-500">No orders found.</td></tr>';
        return;
      }

      adminOrderRowsEl.innerHTML = orders.map((order) => \`
        <tr class="border-b border-white/15">
          <td class="py-2 pr-4 font-medium">#\${order.id}</td>
          <td class="py-2 pr-4">\${order.shop_name || "-"}</td>
          <td class="py-2 pr-4">\${order.customer_name}</td>
          <td class="py-2 pr-4">Rs. \${Number(order.total_amount).toFixed(2)}</td>
          <td class="py-2 pr-4">
            <span class="px-2 py-1 rounded-full text-xs \${badgeClass(order.status)}">\${order.status}</span>
          </td>
          <td class="py-2 pr-4">\${new Date(order.created_at).toLocaleString()}</td>
          <td class="py-2 pr-4">
            <div class="flex gap-2 items-center">
              <select id="status-\${order.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1">
                \${statusOptions.map((status) => \`<option value="\${status}" \${status === order.status ? "selected" : ""}>\${status}</option>\`).join("")}
              </select>
              <button onclick="saveStatus(\${order.id})" class="bg-white/10 hover:bg-white/15 text-white px-3 py-1 rounded">
                Update
              </button>
            </div>
          </td>
        </tr>
      \`).join("");
    }

    async function loadMenu() {
      const shopId = adminShopSelectEl.value;
      const response = await fetch("/api/admin/menu" + (shopId ? ("?shopId=" + encodeURIComponent(shopId)) : ""));
      if (!response.ok) throw new Error("Failed to load menu items");
      const items = await response.json();

      if (!items.length) {
        adminMenuRowsEl.innerHTML = '<tr><td colspan="5" class="py-2 text-slate-500">No menu items found.</td></tr>';
        return;
      }

      adminMenuRowsEl.innerHTML = items.map((item) => \`
        <tr class="border-b border-white/15 align-top">
          <td class="py-2 pr-4 font-medium">
            <input id="name-\${item.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-44" value="\${item.name}" />
            <textarea id="desc-\${item.id}" class="mt-1 border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-44" rows="2">\${item.description || ""}</textarea>
            <input id="img-\${item.id}" class="mt-1 border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-44" value="\${item.image_url || ""}" placeholder="Image URL" />
          </td>
          <td class="py-2 pr-4"><input id="cat-\${item.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-28" value="\${item.category}" /></td>
          <td class="py-2 pr-4"><input id="price-\${item.id}" type="number" min="1" step="0.01" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-24" value="\${item.price}" /></td>
          <td class="py-2 pr-4"><input id="stock-\${item.id}" type="number" min="0" step="1" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-20" value="\${item.stock}" /></td>
          <td class="py-2 pr-4">
            <select id="shop-\${item.id}" class="border border-white/30 bg-white/10 text-white rounded px-2 py-1 w-40"></select>
          </td>
          <td class="py-2 pr-4">
            <div class="flex flex-col gap-2">
              <button onclick="updateMenuItem(\${item.id})" class="bg-white/10 hover:bg-white/15 text-white px-3 py-1 rounded">Save</button>
              <button onclick="deleteMenuItem(\${item.id})" class="bg-rose-600/80 hover:bg-rose-600 text-white px-3 py-1 rounded">Delete</button>
            </div>
          </td>
        </tr>
      \`).join("");

      // Populate per-row shop selects
      const shops = await fetch("/api/admin/shops").then((r) => r.json());
      items.forEach((item) => {
        const sel = document.getElementById("shop-" + item.id);
        if (!sel) return;
        sel.innerHTML = shops.map((s) => \`<option value="\${s.id}" \${Number(s.id) === Number(item.shop_id) ? "selected" : ""}>\${s.name}</option>\`).join("");
      });
    }

    async function saveStatus(orderId) {
      const status = document.getElementById("status-" + orderId).value;
      const response = await fetch("/api/order/" + orderId + "/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const result = await response.json();
      if (!response.ok) {
        flashMessage(result.error || "Failed to update status.", false);
        return;
      }
      flashMessage("Order status updated.");
      await loadOrders();
    }

    async function updateStockQuick(menuItemId) {
      // kept for backward compatibility (unused in new admin UI)
    }

    async function updateMenuItem(menuItemId) {
      const payload = {
        name: document.getElementById("name-" + menuItemId).value.trim(),
        category: document.getElementById("cat-" + menuItemId).value.trim(),
        price: Number(document.getElementById("price-" + menuItemId).value),
        stock: Number(document.getElementById("stock-" + menuItemId).value),
        description: document.getElementById("desc-" + menuItemId).value.trim(),
        imageUrl: document.getElementById("img-" + menuItemId).value.trim(),
        shopId: Number(document.getElementById("shop-" + menuItemId).value)
      };
      const response = await fetch("/api/menu/" + menuItemId + "/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        flashMessage(result.error || "Failed to update menu item.", false);
        return;
      }
      flashMessage("Menu item updated.");
      await loadMenu();
    }

    async function deleteMenuItem(menuItemId) {
      const confirmed = window.confirm("Delete this menu item?");
      if (!confirmed) return;
      const response = await fetch("/api/menu/" + menuItemId + "/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const result = await response.json();
      if (!response.ok) {
        flashMessage(result.error || "Failed to delete menu item.", false);
        return;
      }
      flashMessage("Menu item deleted.");
      await loadMenu();
    }

    createMenuFormEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(createMenuFormEl);
      const payload = Object.fromEntries(formData.entries());
      payload.price = Number(payload.price);
      payload.stock = Number(payload.stock);
      payload.shopId = Number(payload.shopId);

      const response = await fetch("/api/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) {
        flashMessage(result.error || "Failed to create menu item.", false);
        return;
      }

      createMenuFormEl.reset();
      flashMessage("Menu item created.");
      await loadMenu();
    });

    async function loadUsers() {
      const res = await fetch("/api/admin/users");
      const users = await res.json();
      userListEl.innerHTML = users.map((u) => \`
        <div class="flex items-center justify-between gap-2 border border-white/15 rounded-xl px-3 py-2 bg-white/5">
          <div>
            <p class="text-white font-semibold">\${u.username}</p>
            <p class="text-xs text-slate-300">\${u.role}</p>
          </div>
          \${u.username === "admin" ? "" : \`<button class="text-xs px-2 py-1 rounded bg-rose-600/80 hover:bg-rose-600" onclick="deleteUser(\${u.id})">Delete</button>\`}
        </div>
      \`).join("");

      // owners for shop creation
      const owners = users.filter((u) => u.role === "owner");
      shopOwnerSelectEl.innerHTML = owners.map((o) => \`<option value="\${o.id}" class="text-slate-900">\${o.username}</option>\`).join("");
    }

    async function loadShops() {
      const res = await fetch("/api/admin/shops");
      const shops = await res.json();
      adminShopSelectEl.innerHTML = '<option value="" class="text-slate-900">All shops</option>' + shops.map((s) => \`<option value="\${s.id}" class="text-slate-900">\${s.name}</option>\`).join("");
      createMenuShopSelectEl.innerHTML = shops.map((s) => \`<option value="\${s.id}" class="text-slate-900">\${s.name}</option>\`).join("");
    }

    async function deleteUser(userId) {
      const res = await fetch("/api/admin/users/" + userId + "/delete", { method: "POST", headers: { "Content-Type": "application/json" } });
      const out = await res.json();
      if (!res.ok) { flashMessage(out.error || "Delete failed", false); return; }
      flashMessage("User deleted.");
      await loadUsers();
    }

    createUserFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(createUserFormEl).entries());
      const res = await fetch("/api/admin/users", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) { flashMessage(out.error || "Create failed", false); return; }
      flashMessage("User created.");
      createUserFormEl.reset();
      await loadUsers();
      await loadShops();
    });

    createShopFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(createShopFormEl).entries());
      payload.ownerUserId = Number(payload.ownerUserId);
      const res = await fetch("/api/admin/shops", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });
      const out = await res.json();
      if (!res.ok) { flashMessage(out.error || "Create shop failed", false); return; }
      flashMessage("Shop created.");
      createShopFormEl.reset();
      await loadShops();
      await loadMenu();
    });

    adminShopSelectEl.addEventListener("change", () => { loadMenu().catch(() => {}); });

    Promise.all([loadUsers(), loadShops(), loadOrders(), loadMenu()]).catch((error) => {
      adminOrderRowsEl.innerHTML = '<tr><td colspan="6" class="py-2 text-red-600">' + error.message + "</td></tr>";
      adminMenuRowsEl.innerHTML = '<tr><td colspan="5" class="py-2 text-red-600">' + error.message + "</td></tr>";
    });

    window.saveStatus = saveStatus;
    window.updateStockQuick = updateStockQuick;
    window.updateMenuItem = updateMenuItem;
    window.deleteMenuItem = deleteMenuItem;
    window.deleteUser = deleteUser;
  `;

  res.send(layout("Admin", body, script, "/admin", req.user));
});

app.use((error, _req, res, _next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

async function startServer() {
  try {
    await ensureTables();
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
