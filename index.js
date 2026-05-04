const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");

const app = express();

app.use(cors());
app.use(express.json());

// ================= DB =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🔒" });
});

// ================= AUTH =================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (user.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    if (user.rows[0].password !== password)
      return res.status(401).json({ error: "Invalid password" });

    const token = jwt.sign(
      { id: user.rows[0].id },
      process.env.JWT_SECRET
    );

    res.json({ user: user.rows[0], token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= WALLET =================
app.get("/wallets/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [req.params.user_id]
    );

    res.json({ wallets: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSACTIONS =================
app.get("/transactions/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.params.user_id]
    );

    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSFER =================
app.post("/transfer", auth, async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
    const wallet = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (!wallet.rows.length)
      return res.status(404).json({ error: "Wallet not found" });

    const w = wallet.rows[0];

    const allowed = ["main", "savings", "business"];

    if (!allowed.includes(from) || !allowed.includes(to))
      return res.status(400).json({ error: "Invalid wallet type" });

    if (w[from] < amount)
      return res.status(400).json({ error: "Insufficient balance" });

    const newFrom = w[from] - amount;
    const newTo = w[to] + amount;

    await pool.query(
      `UPDATE wallets SET ${from} = $1 WHERE user_id = $2`,
      [newFrom, user_id]
    );

    await pool.query(
      `UPDATE wallets SET ${to} = $1 WHERE user_id = $2`,
      [newTo, user_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, note)
       VALUES ($1, $2, $3, $4)`,
      [user_id, "transfer", amount, `${from} → ${to}`]
    );

    res.json({
      message: "Transfer successful",
      wallets: { ...w, [from]: newFrom, [to]: newTo },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= PAYSTACK INIT (ADD MONEY) =================
app.post("/paystack/init", auth, async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          amount: amount * 100,
        }),
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= ANALYTICS =================
app.get("/analytics/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        SUM(amount) FILTER (WHERE type='income') AS income,
        SUM(amount) FILTER (WHERE type='transfer') AS spent
      FROM transactions
      WHERE user_id = $1`,
      [req.params.user_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Trackra running on port", PORT);
});
